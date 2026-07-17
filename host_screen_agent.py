#!/usr/bin/env python3
"""
宿主机 Screen 监控 Agent
运行在宿主机上，暴露 HTTP API 供 Docker 容器调用
用于监控和管理宿主机上的 screen 会话
"""

import os
import re
import json
import subprocess
import socketserver
import http.server
import threading
import time
from datetime import datetime
from urllib.parse import urlparse, parse_qs

HOST = '0.0.0.0'
PORT = 3001

_auto_save_config = {
    'enabled': False,
    'interval': 300,
    'save_dir': os.path.expanduser('~/screen_logs'),
}

_auto_save_threads = {}
_auto_save_lock = threading.Lock()


def run_command(cmd):
    try:
        env = os.environ.copy()
        env['LC_ALL'] = 'en_US.UTF-8'
        env['LANG'] = 'en_US.UTF-8'
        env['LANGUAGE'] = 'en_US.UTF-8'
        
        result = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=False,
            timeout=30,
            env=env
        )
        return {
            'success': result.returncode == 0,
            'stdout': result.stdout.decode('utf-8', errors='replace'),
            'stderr': result.stderr.decode('utf-8', errors='replace'),
            'returncode': result.returncode
        }
    except subprocess.TimeoutExpired:
        return {'success': False, 'stdout': '', 'stderr': 'Command timeout', 'returncode': -1}
    except Exception as e:
        return {'success': False, 'stdout': '', 'stderr': str(e), 'returncode': -1}


def list_screens():
    result = run_command('screen -list')
    screens = []
    
    if result['success'] and 'No Sockets' not in result['stdout']:
        lines = result['stdout'].strip().split('\n')
        for line in lines:
            if 'Sockets in' in line or 'No Sockets' in line:
                continue
            
            line_clean = line.replace('\t', ' ').strip()
            
            if not line_clean or 'Remove dead' in line_clean or 'There are screens' in line_clean:
                continue
            
            m = re.match(r'(\d+)\.(\S+)\s+\([^)]+\)\s+\(([^)]+)\)', line_clean)
            if m:
                pid = m.group(1)
                name = m.group(2)
                status = m.group(3)
                if 'Dead' in status:
                    continue
                if pid.isdigit() and name:
                    screens.append({
                        'pid': pid,
                        'name': name,
                        'status': status
                    })
            else:
                parts = line_clean.split('.', 1)
                if len(parts) >= 2:
                    pid_part = parts[0].strip()
                    name_part = parts[1].split()[0] if ' ' in parts[1] else parts[1]
                    if pid_part.isdigit() and name_part and name_part != '(':
                        screens.append({
                            'pid': pid_part,
                            'name': name_part,
                            'status': 'running'
                        })
    
    return {'success': True, 'data': screens}


_log_cache = {}

import re

_ANSI_ESCAPE = re.compile(r'\x1B(?:[@-Z\\-_]|\[.*?[a-zA-Z])')

def _clean_log_content(content):
    """完整日志清理：去除 ANSI 转义码、规范化换行、去除多余空行"""
    content = content.replace('\r\n', '\n')
    content = content.replace('\r', '\n')
    content = _ANSI_ESCAPE.sub('', content)
    content = re.sub(r'\n{3,}', '\n\n', content)
    return content.strip() + '\n'

def _clean_log_delta(content):
    """增量日志清理：仅去除 ANSI 转义码和规范化换行，不 strip（避免丢失行间内容）"""
    content = content.replace('\r\n', '\n')
    content = content.replace('\r', '\n')
    content = _ANSI_ESCAPE.sub('', content)
    return content

def _decode_bytes(raw):
    """稳健的字节解码：优先 UTF-8，失败则尝试 GBK/GB18030"""
    if not raw:
        return ''
    
    try:
        return raw.decode('utf-8', errors='replace')
    except Exception:
        pass
    
    try:
        return raw.decode('gb18030', errors='replace')
    except Exception:
        pass
    
    return raw.decode('utf-8', errors='replace')

def get_screen_log(name):
    escaped_name = name.replace("'", "'\\''")
    log_file = f'/tmp/screen_log_{escaped_name}.txt'

    if os.path.exists(log_file):
        try:
            with open(log_file, 'rb') as f:
                raw = f.read()
            log_content = _decode_bytes(raw)
            cleaned = _clean_log_content(log_content)
            _log_cache[name] = cleaned
            return {'success': True, 'data': cleaned, 'pos': os.path.getsize(log_file)}
        except Exception as e:
            return {'success': False, 'message': f'Failed to read log: {str(e)}'}
    else:
        result = run_command(f"LC_ALL=en_US.utf8 LANG=en_US.utf8 TERM=xterm-256color screen -S '{escaped_name}' -X hardcopy -h '{log_file}'")
        if not result['success']:
            return {'success': False, 'message': f'Failed to get log: {result["stderr"]}'}
        if os.path.exists(log_file):
            try:
                with open(log_file, 'rb') as f:
                    raw = f.read()
                log_content = _decode_bytes(raw)
                os.remove(log_file)
                cleaned = _clean_log_content(log_content)
                _log_cache[name] = cleaned
                return {'success': True, 'data': cleaned, 'pos': 0}
            except Exception as e:
                return {'success': False, 'message': f'Failed to read log: {str(e)}'}
        return {'success': True, 'data': '', 'pos': 0}


def get_screen_log_delta(name, last_pos=0):
    """基于原始文件字节位置追踪增量，只读取并清理新增部分"""
    escaped_name = name.replace("'", "'\\''")
    log_file = f'/tmp/screen_log_{escaped_name}.txt'

    if os.path.exists(log_file):
        try:
            file_size = os.path.getsize(log_file)
            if file_size <= last_pos:
                return {'success': True, 'data': '', 'pos': file_size, 'has_new': False}

            with open(log_file, 'rb') as f:
                f.seek(last_pos)
                new_raw = f.read()

            new_content = _decode_bytes(new_raw)
            cleaned = _clean_log_delta(new_content)

            return {
                'success': True,
                'data': cleaned,
                'pos': file_size,
                'has_new': len(cleaned.strip()) > 0
            }
        except Exception as e:
            return {'success': False, 'message': f'Failed to read log: {str(e)}'}
    else:
        # 回退：用 hardcopy 获取完整快照（非 script 模式的会话）
        result = run_command(f"LC_ALL=en_US.utf8 LANG=en_US.utf8 TERM=xterm-256color screen -S '{escaped_name}' -X hardcopy -h '{log_file}'")
        if not result['success']:
            return {'success': False, 'message': f'Failed to get log: {result["stderr"]}'}
        if os.path.exists(log_file):
            try:
                with open(log_file, 'rb') as f:
                    raw = f.read()
                log_content = _decode_bytes(raw)
                os.remove(log_file)
                cleaned = _clean_log_content(log_content)
                return {
                    'success': True,
                    'data': cleaned if last_pos == 0 else '',
                    'pos': 0,
                    'has_new': last_pos == 0 and len(cleaned) > 0
                }
            except Exception as e:
                return {'success': False, 'message': f'Failed to read log: {str(e)}'}
        return {'success': True, 'data': '', 'pos': last_pos, 'has_new': False}


def send_command(name, command):
    escaped_name = name.replace("'", "'\\''")
    escaped_cmd = command.replace("'", "'\\''")
    
    result = run_command(f"screen -S '{escaped_name}' -X stuff '{escaped_cmd}\n'")
    if result['success']:
        return {'success': True, 'message': f'Command sent to screen session: {name}'}
    else:
        return {'success': False, 'message': f'Failed to send command: {result["stderr"]}'}


def create_screen(name):
    escaped_name = name.replace("'", "'\\''")
    log_file = f'/tmp/screen_log_{escaped_name}.txt'
    result = run_command(f"LC_ALL=en_US.utf8 LANG=en_US.utf8 TERM=xterm-256color screen -dmS '{escaped_name}' script -f '{log_file}' -c '/bin/bash -i'")
    if result['success']:
        return {'success': True, 'message': f'Screen session created: {name}'}
    else:
        return {'success': False, 'message': f'Failed to create screen: {result["stderr"]}'}


def stop_screen(name):
    escaped_name = name.replace("'", "'\\''")
    result = run_command(f"screen -S '{escaped_name}' -X quit")
    if result['success']:
        _stop_auto_save(name)
        return {'success': True, 'message': f'Screen session stopped: {name}'}
    else:
        return {'success': False, 'message': f'Failed to stop screen: {result["stderr"]}'}


def save_screen_log(name):
    escaped_name = name.replace("'", "'\\''")
    
    save_dir = _auto_save_config['save_dir']
    os.makedirs(save_dir, exist_ok=True)
    
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    save_file = os.path.join(save_dir, f'{name}_{timestamp}.log')
    
    try:
        result = run_command(f"screen -S '{escaped_name}' -X hardcopy /tmp/screen_hardcopy_{escaped_name}.tmp")
        if result['success']:
            time.sleep(0.5)
            tmp_file = f'/tmp/screen_hardcopy_{escaped_name}.tmp'
            if os.path.exists(tmp_file):
                with open(tmp_file, 'r', encoding='utf-8', errors='replace') as src:
                    content = src.read()
                with open(save_file, 'w', encoding='utf-8') as dst:
                    dst.write(content)
                return {'success': True, 'message': f'Log saved to {save_file}', 'file': save_file}
        
        result = run_command(f"screen -S '{escaped_name}' -p 0 -X hardcopy -h /tmp/screen_hardcopy_{escaped_name}.tmp")
        if result['success']:
            time.sleep(0.5)
            tmp_file = f'/tmp/screen_hardcopy_{escaped_name}.tmp'
            if os.path.exists(tmp_file):
                with open(tmp_file, 'r', encoding='utf-8', errors='replace') as src:
                    content = src.read()
                with open(save_file, 'w', encoding='utf-8') as dst:
                    dst.write(content)
                return {'success': True, 'message': f'Log saved to {save_file}', 'file': save_file}
        
        return {'success': False, 'message': 'Failed to capture screen log'}
    except Exception as e:
        return {'success': False, 'message': f'Failed to save log: {str(e)}'}


def _auto_save_worker(name, interval):
    while True:
        with _auto_save_lock:
            if name not in _auto_save_threads or _auto_save_threads[name]['stopped']:
                break
        try:
            save_screen_log(name)
        except Exception:
            pass
        time.sleep(interval)


def start_auto_save(name, interval=None):
    interval = interval or _auto_save_config['interval']
    
    with _auto_save_lock:
        if name in _auto_save_threads and not _auto_save_threads[name]['stopped']:
            return {'success': True, 'message': f'Auto save already running for {name}'}
        
        thread = threading.Thread(target=_auto_save_worker, args=(name, interval), daemon=True)
        _auto_save_threads[name] = {
            'thread': thread,
            'stopped': False,
            'interval': interval,
            'started_at': datetime.now().isoformat()
        }
        thread.start()
    
    return {'success': True, 'message': f'Auto save started for {name} (interval: {interval}s)'}


def stop_auto_save(name):
    _stop_auto_save(name)
    return {'success': True, 'message': f'Auto save stopped for {name}'}


def _stop_auto_save(name):
    with _auto_save_lock:
        if name in _auto_save_threads:
            _auto_save_threads[name]['stopped'] = True


def get_auto_save_status(name):
    with _auto_save_lock:
        if name in _auto_save_threads and not _auto_save_threads[name]['stopped']:
            info = _auto_save_threads[name]
            return {
                'success': True,
                'enabled': True,
                'interval': info['interval'],
                'started_at': info['started_at']
            }
    return {'success': True, 'enabled': False}


def set_auto_save_config(enabled=None, interval=None, save_dir=None):
    if enabled is not None:
        _auto_save_config['enabled'] = enabled
    if interval is not None:
        _auto_save_config['interval'] = int(interval)
    if save_dir is not None:
        _auto_save_config['save_dir'] = os.path.expanduser(save_dir)
        os.makedirs(_auto_save_config['save_dir'], exist_ok=True)
    return {'success': True, 'config': _auto_save_config.copy()}


def get_auto_save_config():
    return {'success': True, 'config': _auto_save_config.copy()}


def get_screen_info(name):
    escaped_name = name.replace("'", "'\\''")
    result = run_command(f"screen -S '{escaped_name}' -Q title")
    if result['success']:
        return {'success': True, 'data': {'title': result['stdout'].strip()}}
    else:
        return {'success': False, 'message': f'Failed to get info: {result["stderr"]}'}


class ScreenHandler(http.server.BaseHTTPRequestHandler):
    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))
    
    def do_OPTIONS(self):
        self.send_json({}, 200)
    
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        
        try:
            if path == '/list':
                self.send_json(list_screens())
            
            elif path.startswith('/log/'):
                name = path[5:]
                self.send_json(get_screen_log(name))
            
            elif path.startswith('/log-delta/'):
                name = path[11:]
                last_pos = int(query.get('pos', ['0'])[0])
                self.send_json(get_screen_log_delta(name, last_pos))
            
            elif path.startswith('/info/'):
                name = path[6:]
                self.send_json(get_screen_info(name))
            
            elif path == '/auto-save/config':
                self.send_json(get_auto_save_config())
            
            elif path.startswith('/auto-save/status/'):
                name = path[17:]
                self.send_json(get_auto_save_status(name))
            
            elif path.startswith('/save/'):
                name = path[6:]
                self.send_json(save_screen_log(name))
            
            else:
                self.send_json({'success': False, 'message': 'Unknown endpoint'}, 404)
        
        except Exception as e:
            self.send_json({'success': False, 'message': str(e)}, 500)
    
    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            
            if path == '/create':
                data = json.loads(body) if body else {}
                name = data.get('name', '')
                self.send_json(create_screen(name))
            
            elif path.startswith('/send/'):
                name = path[6:]
                data = json.loads(body) if body else {}
                command = data.get('command', '')
                self.send_json(send_command(name, command))
            
            elif path.startswith('/stop/'):
                name = path[6:]
                self.send_json(stop_screen(name))
            
            elif path == '/auto-save/config':
                data = json.loads(body) if body else {}
                self.send_json(set_auto_save_config(
                    enabled=data.get('enabled'),
                    interval=data.get('interval'),
                    save_dir=data.get('save_dir')
                ))
            
            elif path.startswith('/auto-save/start/'):
                name = path[17:]
                data = json.loads(body) if body else {}
                interval = data.get('interval')
                self.send_json(start_auto_save(name, interval))
            
            elif path.startswith('/auto-save/stop/'):
                name = path[16:]
                self.send_json(stop_auto_save(name))
            
            elif path.startswith('/save/'):
                name = path[6:]
                self.send_json(save_screen_log(name))
            
            else:
                self.send_json({'success': False, 'message': 'Unknown endpoint'}, 404)
        
        except Exception as e:
            self.send_json({'success': False, 'message': str(e)}, 500)
    
    def log_message(self, format, *args):
        pass


def main():
    print(f"Starting Host Screen Agent on http://{HOST}:{PORT}")
    print("This agent monitors local screen sessions on the host machine")
    
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer((HOST, PORT), ScreenHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopping Host Screen Agent...")
            httpd.shutdown()


if __name__ == '__main__':
    main()