"""Script management service: create/list/execute/generate/upload"""
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from typing import List, Optional, Set

from sqlalchemy.orm import Session

from backend.models import Script

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPTS_DIR = os.path.join(PROJECT_ROOT, "scripts")
os.makedirs(SCRIPTS_DIR, exist_ok=True)


STDLIB_MODULES = {
    "abc", "aifc", "argparse", "array", "ast", "asynchat", "asyncio",
    "asyncore", "atexit", "audioop", "base64", "bdb", "binascii", "binhex",
    "bisect", "builtins", "bz2", "calendar", "cgi", "cgitb", "chunk", "cmath",
    "cmd", "code", "codecs", "codeop", "collections", "colorsys", "compileall",
    "concurrent", "configparser", "contextlib", "contextvars", "copy",
    "copyreg", "cProfile", "crypt", "csv", "ctypes", "curses", "dataclasses",
    "datetime", "dbm", "decimal", "difflib", "dis", "distutils", "doctest",
    "email", "encodings", "enum", "errno", "faulthandler", "fcntl", "filecmp",
    "fileinput", "fnmatch", "formatter", "fractions", "ftplib", "functools",
    "gc", "getopt", "getpass", "gettext", "glob", "grp", "gzip", "hashlib",
    "heapq", "hmac", "html", "http", "imaplib", "imghdr", "imp", "importlib",
    "inspect", "io", "ipaddress", "itertools", "json", "keyword", "lib2to3",
    "linecache", "locale", "logging", "lzma", "mailbox", "mailcap", "marshal",
    "math", "mimetypes", "mmap", "modulefinder", "multiprocessing", "netrc",
    "nis", "nntplib", "numbers", "operator", "optparse", "os", "ossaudiodev",
    "parser", "pathlib", "pdb", "pickle", "pickletools", "pipes", "pkgutil",
    "platform", "plistlib", "poplib", "posix", "posixpath", "pprint", "profile",
    "pstats", "pty", "pwd", "py_compile", "pyclbr", "pydoc", "queue",
    "quopri", "random", "re", "readline", "reprlib", "resource", "rlcompleter",
    "runpy", "sched", "secrets", "select", "selectors", "shelve", "shlex",
    "shutil", "signal", "site", "smtpd", "smtplib", "sndhdr", "socket",
    "socketserver", "spwd", "sqlite3", "sre_compile", "sre_constants",
    "sre_parse", "ssl", "stat", "statistics", "string", "stringprep", "struct",
    "subprocess", "sunau", "symtable", "sys", "sysconfig", "syslog", "tabnanny",
    "tarfile", "telnetlib", "tempfile", "termios", "test", "textwrap",
    "threading", "time", "timeit", "tkinter", "token", "tokenize", "trace",
    "traceback", "tracemalloc", "tty", "turtle", "types", "typing", "unicodedata",
    "unittest", "urllib", "uu", "uuid", "venv", "warnings", "wave", "weakref",
    "webbrowser", "winreg", "winsound", "wsgiref", "xdrlib", "xml", "xmlrpc",
    "zipapp", "zipfile", "zipimport", "zlib",
}


PACKAGE_NAME_MAP = {
    "bs4": "beautifulsoup4",
    "PIL": "Pillow",
    "cv2": "opencv-python",
    "yaml": "PyYAML",
    "sklearn": "scikit-learn",
    "dateutil": "python-dateutil",
    "pytz": "pytz",
    "OpenSSL": "pyOpenSSL",
    "Crypto": "pycryptodome",
    "MySQLdb": "mysqlclient",
    "psycopg2": "psycopg2-binary",
    "sqlite3": "",
    "pkg_resources": "setuptools",
    "setuptools": "setuptools",
    "dotenv": "python-dotenv",
    "jwt": "PyJWT",
}

EXTRA_PACKAGES_MAP = {
    "bs4": ["lxml"],
    "selenium": ["webdriver-manager"],
}


def parse_imports(content: str) -> Set[str]:
    imports = set()
    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^\s*import\s+([a-zA-Z_][a-zA-Z0-9_]*)", line)
        if m:
            imports.add(m.group(1))
            continue
        m = re.match(r"^\s*from\s+([a-zA-Z_][a-zA-Z0-9_]*)", line)
        if m:
            imports.add(m.group(1))
    return imports


def is_package_installed(package: str) -> bool:
    try:
        __import__(package)
        return True
    except ImportError:
        return False


def get_pip_package_name(module_name: str) -> Optional[str]:
    if module_name in PACKAGE_NAME_MAP:
        return PACKAGE_NAME_MAP[module_name]
    if module_name in STDLIB_MODULES:
        return None
    return module_name


def install_missing_dependencies(script_content: str) -> List[str]:
    imports = parse_imports(script_content)
    missing = []
    installed = []
    
    for mod in imports:
        if mod in STDLIB_MODULES:
            continue
        if not is_package_installed(mod):
            pkg = get_pip_package_name(mod)
            if pkg:
                missing.append(pkg)
        else:
            installed.append(mod)
    
    for mod in imports:
        extra_pkgs = EXTRA_PACKAGES_MAP.get(mod, [])
        for extra_pkg in extra_pkgs:
            if extra_pkg not in missing:
                try:
                    __import__(extra_pkg.replace("-", "_"))
                except ImportError:
                    missing.append(extra_pkg)
    
    if missing:
        try:
            subprocess.check_call(
                [sys.executable, "-m", "pip", "install", "--no-cache-dir"] + missing,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=120,
            )
        except Exception:
            pass
    
    return missing


SCRIPT_TEMPLATE = """#!/usr/bin/env python3
\"\"\"{name} - {description}\"\"\"
import os
import sys
import json
import time
from datetime import datetime


def send_progress(message: str, progress: int = None, **kwargs):
    \"\"\"Send progress to frontend via stdout\"\"\"
    data = {{
        "type": "progress",
        "message": message,
        "timestamp": datetime.now().isoformat(),
    }}
    if progress is not None:
        data["progress"] = progress
    data.update(kwargs)
    print(f"[PROGRESS] {{json.dumps(data)}}", flush=True)


def send_log(message: str, level: str = "info"):
    \"\"\"Send log to frontend\"\"\"
    data = {{
        "type": "log",
        "message": message,
        "level": level,
        "timestamp": datetime.now().isoformat(),
    }}
    print(f"[PROGRESS] {{json.dumps(data)}}", flush=True)


def main():
    send_log("Script started", "info")
    
    try:
        send_progress("Initializing...", 0)
        time.sleep(1)
        
        send_progress("Processing...", 50)
        time.sleep(1)
        
        send_progress("Completed", 100)
        
        send_log("Execution successful!", "success")
        
    except Exception as e:
        send_log(f"Execution failed: {{str(e)}}", "error")
        raise


if __name__ == "__main__":
    main()
"""

SCRAPE_TEMPLATE = """#!/usr/bin/env python3
\"\"\"{name} - Scrape Script\"\"\"
import os
import sys
import json
import time
import re
from datetime import datetime

try:
    import requests
except ImportError:
    os.system("pip install requests")
    import requests


def send_progress(message: str, progress: int = None, **kwargs):
    data = {{
        "type": "progress",
        "message": message,
        "timestamp": datetime.now().isoformat(),
    }}
    if progress is not None:
        data["progress"] = progress
    data.update(kwargs)
    print(f"[PROGRESS] {{json.dumps(data)}}", flush=True)


def send_log(message: str, level: str = "info"):
    data = {{
        "type": "log",
        "message": message,
        "level": level,
        "timestamp": datetime.now().isoformat(),
    }}
    print(f"[PROGRESS] {{json.dumps(data)}}", flush=True)


def scrape_video_urls(urls):
    \"\"\"Scrape video URLs\"\"\"
    results = []
    for idx, url in enumerate(urls):
        send_progress(f"Processing: {{url}}", int((idx + 1) / len(urls) * 100))
        try:
            headers = {{
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }}
            resp = requests.get(url, headers=headers, timeout=30)
            resp.encoding = resp.apparent_encoding
            
            video_urls = re.findall(r'https?://[^s"<>]+\\.(mp4|m3u8|flv|webm)', resp.text)
            for vurl in video_urls:
                results.append({{"url": vurl, "source": url}})
                
            send_log(f"Extracted {{len(video_urls)}} video links from {{url}}", "success")
        except Exception as e:
            send_log(f"Failed to scrape {{url}}: {{str(e)}}", "error")
        time.sleep(0.5)
    return results


def main():
    send_log("Scrape script started", "info")
    
    try:
        if len(sys.argv) > 1:
            urls = sys.argv[1:]
        else:
            urls = []
        
        send_progress("Starting scrape...", 0)
        
        results = scrape_video_urls(urls)
        
        send_progress(f"Scrape completed, {{len(results)}} videos", 100)
        
        for r in results:
            print(f"[VIDEO] {{json.dumps(r)}}")
        
        send_log(f"Execution successful, extracted {{len(results)}} video URLs", "success")
        
    except Exception as e:
        send_log(f"Execution failed: {{str(e)}}", "error")
        raise


if __name__ == "__main__":
    main()
"""


def generate_script_content(name: str, description: str = "", script_type: str = "general") -> str:
    if script_type == "scrape":
        return SCRAPE_TEMPLATE.format(name=name, description=description)
    return SCRIPT_TEMPLATE.format(name=name, description=description)


def get_scripts(db: Session) -> List[Script]:
    return db.query(Script).order_by(Script.updated_at.desc()).all()


def get_script(db: Session, script_id: int) -> Optional[Script]:
    return db.query(Script).filter(Script.id == script_id).first()


def get_script_by_filename(db: Session, filename: str) -> Optional[Script]:
    return db.query(Script).filter(Script.filename == filename).first()


def create_script(db: Session, name: str, description: str = "", script_type: str = "general") -> Script:
    filename = f"{re.sub(r'[^a-zA-Z0-9_-]', '_', name)}.py"
    
    existing = get_script_by_filename(db, filename)
    if existing:
        filename = f"{re.sub(r'[^a-zA-Z0-9_-]', '_', name)}_{int(time.time())}.py"
    
    content = generate_script_content(name, description, script_type)
    
    script = Script(
        name=name,
        filename=filename,
        content=content,
        description=description,
        status="active",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    
    db.add(script)
    db.commit()
    db.refresh(script)
    
    save_script_to_disk(script)
    
    return script


def upload_script(db: Session, filename: str, content: str, description: str = "") -> Script:
    clean_name = re.sub(r'[^a-zA-Z0-9_-]', '_', filename.replace(".py", ""))
    final_filename = f"{clean_name}.py"
    
    existing = get_script_by_filename(db, final_filename)
    if existing:
        final_filename = f"{clean_name}_{int(time.time())}.py"
    
    script = Script(
        name=clean_name,
        filename=final_filename,
        content=content,
        description=description,
        status="active",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    
    db.add(script)
    db.commit()
    db.refresh(script)
    
    save_script_to_disk(script)
    
    return script


def update_script(db: Session, script_id: int, content: str, description: str = "") -> Optional[Script]:
    script = get_script(db, script_id)
    if not script:
        return None
    
    script.content = content
    if description:
        script.description = description
    script.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(script)
    
    save_script_to_disk(script)
    
    return script


def delete_script(db: Session, script_id: int) -> bool:
    script = get_script(db, script_id)
    if not script:
        return False
    
    delete_script_from_disk(script.filename)
    
    db.delete(script)
    db.commit()
    return True


def save_script_to_disk(script: Script):
    filepath = os.path.join(SCRIPTS_DIR, script.filename)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(script.content)


def delete_script_from_disk(filename: str):
    filepath = os.path.join(SCRIPTS_DIR, filename)
    if os.path.exists(filepath):
        os.remove(filepath)


def get_script_path(filename: str) -> str:
    return os.path.join(SCRIPTS_DIR, filename)


def list_script_files() -> List[dict]:
    files = []
    if os.path.exists(SCRIPTS_DIR):
        for f in sorted(os.listdir(SCRIPTS_DIR)):
            if f.endswith(".py"):
                filepath = os.path.join(SCRIPTS_DIR, f)
                stat = os.stat(filepath)
                files.append({
                    "filename": f,
                    "name": f.replace(".py", ""),
                    "size": stat.st_size,
                    "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                })
    return files
