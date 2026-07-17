"""终端 API 路由"""
import asyncio
import json
import uuid
import logging
import subprocess
import os
import pty
import fcntl
import termios
import struct
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.services import screen_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/terminal", tags=["terminal"])

_active_terminals: dict = {}


def _set_pty_size(fd: int, rows: int = 40, cols: int = 80):
    try:
        size = struct.pack('HHHH', rows, cols, 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, size)
    except Exception as e:
        logger.error(f"Failed to set PTY size: {e}")


async def _create_screen_session(name: str):
    """确保screen会话存在"""
    try:
        env = os.environ.copy()
        env['TERM'] = 'xterm-256color'
        env['SCREENDIR'] = '/app/screen_sockets'
        await asyncio.create_subprocess_exec("screen", "-dmS", name, "/bin/bash", "-i", env=env)
        await asyncio.sleep(0.5)
        logger.info(f"Created screen session: {name}")
        return True
    except Exception as e:
        logger.error(f"Failed to create screen session {name}: {e}")
        return False


@router.websocket("/screen/{name}")
async def screen_terminal_ws(ws: WebSocket, name: str):
    """WebSocket PTY终端连接 - 连接到screen会话"""
    await ws.accept()
    logger.info(f"Screen terminal connection requested: {name}")
    
    screens = await screen_service.list_screens()
    screen_exists = any(s["name"] == name for s in screens)
    logger.info(f"Screen exists: {screen_exists}, screens: {[s['name'] for s in screens]}")
    
    if not screen_exists:
        await ws.send_text("Screen会话不存在，正在创建...\r\n")
        await _create_screen_session(name)
        await asyncio.sleep(1)
    
    terminal_id = f"screen_{name}"
    master_fd = None
    proc = None
    
    try:
        master_fd, slave_fd = pty.openpty()
        logger.info(f"Created PTY: master={master_fd}, slave={slave_fd}")
        
        env = os.environ.copy()
        env['TERM'] = 'xterm-256color'
        env['COLUMNS'] = '80'
        env['LINES'] = '40'
        
        cmd_parts = ["screen", "-x", name]
        proc = subprocess.Popen(
            cmd_parts,
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            env=env,
            preexec_fn=os.setsid,
            cwd='/app',
        )
        logger.info(f"Started screen -x process: {name}, PID={proc.pid}")
        
        os.close(slave_fd)
        _set_pty_size(master_fd, 40, 80)
        
        _active_terminals[terminal_id] = {
            'proc': proc,
            'master_fd': master_fd,
            'ws': ws,
        }
        
        loop = asyncio.get_event_loop()
        
        async def read_output():
            nonlocal master_fd, proc
            try:
                while proc.poll() is None:
                    try:
                        data = await loop.run_in_executor(None, os.read, master_fd, 4096)
                        if data:
                            try:
                                await ws.send_bytes(data)
                            except Exception as e:
                                logger.error(f"Failed to send data: {e}")
                                break
                        else:
                            await asyncio.sleep(0.05)
                    except OSError as e:
                        await asyncio.sleep(0.1)
                    except Exception as e:
                        logger.error(f"PTY read error: {e}")
                        break
            except Exception as e:
                logger.error(f"Read output error: {e}")
            finally:
                logger.info(f"Closing terminal read loop: {terminal_id}")
        
        asyncio.create_task(read_output())
        
        logger.info(f"Ready to receive data for: {name}")
        
        while True:
            try:
                data = await ws.receive_text()
                logger.debug(f"Received text: {repr(data[:50])}")
                os.write(master_fd, data.encode('utf-8'))
            except Exception:
                try:
                    data = await ws.receive_bytes()
                    logger.debug(f"Received bytes: {len(data)} bytes")
                    os.write(master_fd, data)
                except Exception as e:
                    logger.error(f"Receive data error: {e}")
                    break
    except WebSocketDisconnect:
        logger.info(f"Screen terminal disconnected: {name}")
    except Exception as e:
        logger.error(f"Screen terminal error: {e}", exc_info=True)
        try:
            await ws.send_text(f"\r\nError: {str(e)}\r\n")
        except:
            pass
    finally:
        if proc:
            try:
                proc.terminate()
                proc.wait(timeout=2)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        if master_fd:
            try:
                os.close(master_fd)
            except Exception:
                pass
        if terminal_id in _active_terminals:
            del _active_terminals[terminal_id]
        logger.info(f"Terminal stopped: {terminal_id}")


@router.websocket("/bash")
async def bash_terminal_ws(ws: WebSocket):
    """WebSocket PTY终端连接 - 独立bash终端"""
    await ws.accept()
    logger.info("Bash terminal connection requested")
    
    terminal_id = str(uuid.uuid4())[:8]
    master_fd = None
    proc = None
    
    try:
        master_fd, slave_fd = pty.openpty()
        logger.info(f"Created PTY: master={master_fd}, slave={slave_fd}")
        
        env = os.environ.copy()
        env['TERM'] = 'xterm-256color'
        env['COLUMNS'] = '80'
        env['LINES'] = '40'
        
        proc = subprocess.Popen(
            ["bash"],
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            env=env,
            preexec_fn=os.setsid,
            cwd='/app',
        )
        logger.info(f"Started bash process: PID={proc.pid}")
        
        os.close(slave_fd)
        _set_pty_size(master_fd, 40, 80)
        
        _active_terminals[terminal_id] = {
            'proc': proc,
            'master_fd': master_fd,
            'ws': ws,
        }
        
        loop = asyncio.get_event_loop()
        
        async def read_output():
            nonlocal master_fd, proc
            try:
                while proc.poll() is None:
                    try:
                        data = await loop.run_in_executor(None, os.read, master_fd, 4096)
                        if data:
                            try:
                                await ws.send_bytes(data)
                            except Exception as e:
                                logger.error(f"Failed to send data: {e}")
                                break
                        else:
                            await asyncio.sleep(0.05)
                    except OSError as e:
                        await asyncio.sleep(0.1)
                    except Exception as e:
                        logger.error(f"PTY read error: {e}")
                        break
            except Exception as e:
                logger.error(f"Read output error: {e}")
        
        asyncio.create_task(read_output())
        
        while True:
            try:
                data = await ws.receive_text()
                os.write(master_fd, data.encode('utf-8'))
            except Exception:
                try:
                    data = await ws.receive_bytes()
                    os.write(master_fd, data)
                except Exception as e:
                    logger.error(f"Receive data error: {e}")
                    break
    except WebSocketDisconnect:
        logger.info(f"Bash terminal disconnected: {terminal_id}")
    except Exception as e:
        logger.error(f"Bash terminal error: {e}", exc_info=True)
        try:
            await ws.send_text(f"\r\nError: {str(e)}\r\n")
        except:
            pass
    finally:
        if proc:
            try:
                proc.terminate()
                proc.wait(timeout=2)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        if master_fd:
            try:
                os.close(master_fd)
            except Exception:
                pass
        if terminal_id in _active_terminals:
            del _active_terminals[terminal_id]
        logger.info(f"Bash terminal stopped: {terminal_id}")