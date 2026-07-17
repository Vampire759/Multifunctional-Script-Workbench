#!/usr/bin/env python3
import subprocess
import sys
import re
import time

MODULE_TO_PACKAGE = {
    'bs4': 'beautifulsoup4',
    'cv2': 'opencv-python',
    'PIL': 'Pillow',
    'yaml': 'pyyaml',
    'toml': 'toml',
    'pydantic': 'pydantic',
    'requests': 'requests',
    'httpx': 'httpx',
    'sqlalchemy': 'sqlalchemy',
    'aiofiles': 'aiofiles',
    'asyncio': None,
    'os': None,
    'sys': None,
    'json': None,
    're': None,
    'time': None,
    'datetime': None,
    'collections': None,
    'functools': None,
    'typing': None,
    'pathlib': None,
    'logging': None,
    'argparse': None,
    'urllib': None,
    'http': None,
    'socket': None,
    'threading': None,
    'multiprocessing': None,
    'itertools': None,
    'math': None,
    'random': None,
    'hashlib': None,
    'base64': None,
    'pickle': None,
    'csv': None,
    'xml': None,
    'html': None,
    'email': None,
    'tempfile': None,
    'shutil': None,
    'glob': None,
    'fnmatch': None,
    'configparser': None,
    'calendar': None,
    'datetime': None,
    'dateutil': 'python-dateutil',
    'numpy': 'numpy',
    'pandas': 'pandas',
    'scipy': 'scipy',
    'matplotlib': 'matplotlib',
    'seaborn': 'seaborn',
    'sklearn': 'scikit-learn',
    'tensorflow': 'tensorflow',
    'torch': 'torch',
    'keras': 'keras',
    'transformers': 'transformers',
    'torchvision': 'torchvision',
    'tqdm': 'tqdm',
    'selenium': 'selenium',
    'playwright': 'playwright',
    'lxml': 'lxml',
    'cssselect': 'cssselect',
    'redis': 'redis',
    'pymongo': 'pymongo',
    'psycopg2': 'psycopg2-binary',
    'mysql': 'mysql-connector-python',
    'jinja2': 'jinja2',
    'markupsafe': 'markupsafe',
    'flask': 'flask',
    'django': 'django',
    'fastapi': 'fastapi',
    'uvicorn': 'uvicorn',
    'websockets': 'websockets',
    'aiohttp': 'aiohttp',
    'chardet': 'chardet',
    'charset_normalizer': 'charset-normalizer',
    'certifi': 'certifi',
    'idna': 'idna',
    'urllib3': 'urllib3',
    'six': 'six',
    'more-itertools': 'more-itertools',
    'attrs': 'attrs',
    'cattrs': 'cattrs',
    'orjson': 'orjson',
    'ujson': 'ujson',
    'simplejson': 'simplejson',
    'msgpack': 'msgpack',
    'protobuf': 'protobuf',
    'pyarrow': 'pyarrow',
    'fsspec': 'fsspec',
    's3fs': 's3fs',
    'gcsfs': 'gcsfs',
    'boto3': 'boto3',
    'botocore': 'botocore',
    'paramiko': 'paramiko',
    'scp': 'scp',
    'cryptography': 'cryptography',
    'pycryptodome': 'pycryptodome',
    'bcrypt': 'bcrypt',
    'passlib': 'passlib',
    'python-jose': 'python-jose[cryptography]',
    'python-multipart': 'python-multipart',
    'apscheduler': 'apscheduler',
    'schedule': 'schedule',
    'celery': 'celery',
    'rq': 'rq',
    'huey': 'huey',
    'flask-sqlalchemy': 'flask-sqlalchemy',
    'flask-restful': 'flask-restful',
    'flask-cors': 'flask-cors',
    'django-rest-framework': 'djangorestframework',
    'graphql-core': 'graphql-core',
    'graphene': 'graphene',
    'pytest': 'pytest',
    'pytest-asyncio': 'pytest-asyncio',
    'tox': 'tox',
    'coverage': 'coverage',
    'black': 'black',
    'isort': 'isort',
    'flake8': 'flake8',
    'mypy': 'mypy',
    'pre-commit': 'pre-commit',
    'twine': 'twine',
    'wheel': 'wheel',
    'setuptools': 'setuptools',
    'pip': 'pip',
}


def get_pip_package(module_name):
    if module_name in MODULE_TO_PACKAGE:
        return MODULE_TO_PACKAGE[module_name]
    
    package_name = module_name.replace('_', '-').lower()
    
    return package_name


def extract_missing_modules(error_message):
    modules = []
    
    pattern = r"ModuleNotFoundError: No module named '([^']+)'"
    matches = re.findall(pattern, error_message)
    modules.extend(matches)
    
    pattern2 = r"ImportError: No module named ([^\s]+)"
    matches2 = re.findall(pattern2, error_message)
    modules.extend(matches2)
    
    return list(set(modules))


def install_package(package_name):
    print(f"[AUTO-INSTALL] Installing missing package: {package_name}")
    sys.stdout.flush()
    
    try:
        result = subprocess.run(
            [sys.executable, '-m', 'pip', 'install', package_name, '--quiet'],
            capture_output=True,
            text=True,
            timeout=120
        )
        
        if result.returncode == 0:
            print(f"[AUTO-INSTALL] Successfully installed: {package_name}")
            sys.stdout.flush()
            return True
        else:
            print(f"[AUTO-INSTALL] Failed to install {package_name}: {result.stderr}")
            sys.stdout.flush()
            return False
    except subprocess.TimeoutExpired:
        print(f"[AUTO-INSTALL] Timeout installing {package_name}")
        sys.stdout.flush()
        return False
    except Exception as e:
        print(f"[AUTO-INSTALL] Error installing {package_name}: {e}")
        sys.stdout.flush()
        return False


def run_script_with_auto_install(script_path, args):
    max_retries = 5
    
    for attempt in range(max_retries):
        cmd = [sys.executable, script_path] + args
        
        print(f"[AUTO-RUN] Running: {' '.join(cmd)}")
        print(f"[AUTO-RUN] Attempt {attempt + 1}/{max_retries}")
        sys.stdout.flush()
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True
        )
        
        if result.returncode == 0:
            print(result.stdout)
            sys.stdout.flush()
            if result.stderr:
                print(f"STDERR: {result.stderr}")
                sys.stderr.flush()
            return result.returncode
        
        error_output = result.stdout + "\n" + result.stderr
        
        missing_modules = extract_missing_modules(error_output)
        
        if missing_modules:
            print(f"[AUTO-RUN] Missing modules detected: {missing_modules}")
            sys.stdout.flush()
            
            all_installed = True
            for module in missing_modules:
                package = get_pip_package(module)
                if package:
                    if not install_package(package):
                        all_installed = False
                        break
                else:
                    print(f"[AUTO-RUN] Skipping system module: {module}")
                    sys.stdout.flush()
            
            if all_installed:
                print(f"[AUTO-RUN] All dependencies installed, retrying...")
                sys.stdout.flush()
                time.sleep(1)
                continue
            else:
                print(f"[AUTO-RUN] Failed to install some dependencies")
                sys.stdout.flush()
                break
        else:
            print(f"[AUTO-RUN] Script failed with non-dependency error")
            print(f"STDOUT: {result.stdout}")
            print(f"STDERR: {result.stderr}")
            sys.stdout.flush()
            sys.stderr.flush()
            break
    
    print(f"[AUTO-RUN] Maximum retries ({max_retries}) reached")
    sys.stdout.flush()
    return result.returncode if 'result' in dir() else 1


def main():
    if len(sys.argv) < 2:
        print("Usage: python auto_run.py <script_path> [args...]")
        sys.exit(1)
    
    script_path = sys.argv[1]
    args = sys.argv[2:]
    
    exit_code = run_script_with_auto_install(script_path, args)
    sys.exit(exit_code)


if __name__ == '__main__':
    main()