import os
import pty
import subprocess
import asyncio
import struct
import fcntl
import termios
import logging
from typing import Optional

logger = logging.getLogger(__name__)

SCREEN_SOCK_DIR = "/app/screen_sockets"
os.makedirs(SCREEN_SOCK_DIR, exist_ok=True)
os.chmod(SCREEN_SOCK_DIR, 0o700)
os.environ['SCREENDIR'] = SCREEN_SOCK_DIR

_active_pty_processes: dict = {}


def _set_pty_size(fd: int, rows: int, cols: int):
    try:
        size = struct.pack('HHHH', rows, cols, 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, size)
    except Exception as e:
        logger.error(f"Failed to set PTY size: {e}")


async def start_terminal(terminal_id: str, ws, command: str = 'bash') -> Optional[subprocess.Popen]:
    try:
        master_fd, slave_fd = pty.openpty()
        logger.info(f"Created PTY: master={master_fd}, slave={slave_fd}")
        
        env = os.environ.copy()
        env['TERM'] = 'xterm-256color'
        env['COLUMNS'] = '80'
        env['LINES'] = '40'
        
        cmd_parts = command.split()
        proc = subprocess.Popen(
            cmd_parts,
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            env=env,
            preexec_fn=os.setsid,
            cwd='/app',
        )
        logger.info(f"Started process: {command}, PID={proc.pid}")
        
        os.close(slave_fd)
        
        _active_pty_processes[terminal_id] = {
            'proc': proc,
            'master_fd': master_fd,
            'ws': ws,
        }
        
        _set_pty_size(master_fd, 40, 80)
        
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
                            await asyncio.sleep(0.1)
                    except OSError as e:
                        await asyncio.sleep(0.1)
                    except Exception as e:
                        logger.error(f"PTY read error: {e}")
                        break
            except Exception as e:
                logger.error(f"Read output error: {e}")
            finally:
                logger.info(f"Closing terminal: {terminal_id}")
                stop_terminal(terminal_id)
        
        asyncio.create_task(read_output())
        
        return proc
    except Exception as e:
        logger.error(f"Failed to start terminal: {e}")
        return None


def write_to_terminal(terminal_id: str, data: bytes):
    info = _active_pty_processes.get(terminal_id)
    if info and info['proc'].poll() is None:
        try:
            os.write(info['master_fd'], data)
            return True
        except Exception as e:
            logger.error(f"Failed to write to terminal: {e}")
            return False
    return False


def resize_terminal(terminal_id: str, rows: int, cols: int):
    info = _active_pty_processes.get(terminal_id)
    if info:
        _set_pty_size(info['master_fd'], rows, cols)


def stop_terminal(terminal_id: str):
    info = _active_pty_processes.get(terminal_id)
    if info:
        try:
            info['proc'].terminate()
            info['proc'].wait(timeout=2)
        except Exception:
            try:
                info['proc'].kill()
            except Exception:
                pass
        try:
            os.close(info['master_fd'])
        except Exception:
            pass
        if terminal_id in _active_pty_processes:
            del _active_pty_processes[terminal_id]
        logger.info(f"Terminal stopped: {terminal_id}")