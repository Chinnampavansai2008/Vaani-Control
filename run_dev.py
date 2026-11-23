"""Start the four local demo services; --check performs read-only preflight only."""
import argparse
import importlib.util
import os
from pathlib import Path
import re
import shutil
import socket
import sqlite3
import subprocess
import sys
import time
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
PORTS = (8001, 8002, 5173, 5174)
SCHEMA = {
    'products': {'id','name','category','description','price','stock','image_url','sizes','colors'},
    'store_actions': {'action_id','product_id','field','old_value','new_value','source','created_at'},
    'orders': {'id','customer_name','email','total','status','created_at'},
    'order_items': {'order_id','product_id','name','quantity','unit_price','size','color'},
}


def service_environment(folder):
    from dotenv import dotenv_values
    env = os.environ.copy()
    for key, value in dotenv_values(ROOT / folder / '.env').items():
        if value is not None and key not in env:
            env[key] = value
    return env


def check_database(location):
    """Inspect existing schemas without creating, changing or deleting a database."""
    path = Path(location)
    if not path.is_file():
        return
    try:
        con = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, timeout=2)
        try:
            tables = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            for table, required in SCHEMA.items():
                if table in tables:
                    columns = {row[1] for row in con.execute(f'PRAGMA table_info({table})')}
                    if not required.issubset(columns):
                        raise ValueError('The existing store database has an older/incompatible schema. See README: Existing databases. Nothing was changed.')
        finally:
            con.close()
    except sqlite3.Error:
        raise ValueError('The existing store database could not be read. Check STORE_DB_PATH; nothing was changed.') from None


def check_ports():
    occupied = []
    for port in PORTS:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            if os.name == 'nt':
                probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            try:
                probe.bind(('127.0.0.1', port))
            except OSError:
                occupied.append(str(port))
    if occupied:
        raise ValueError('Ports already in use: ' + ', '.join(occupied) + '. Stop the old project in its terminal with Ctrl+C, then retry. No processes were stopped.')


def preflight():
    for module in ('fastapi','uvicorn','dotenv','httpx','multipart','pydantic'):
        if importlib.util.find_spec(module) is None:
            raise ValueError('Install Python dependencies using the command in README before starting.')
    try:
        sdk = importlib.util.find_spec('google.genai')
    except ModuleNotFoundError:
        sdk = None
    if sdk is None:
        raise ValueError('Install control-api/requirements.txt to provide the declared Gemini SDK.')
    node, npm = shutil.which('node'), shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
    if not node or not npm:
        raise ValueError('Install Node.js LTS, then reopen your terminal. See README.')
    version = subprocess.check_output([node, '--version'], text=True, timeout=5).strip()
    numbers = re.fullmatch(r'v(\d+)\.(\d+)\.(\d+)', version)
    if not numbers:
        raise ValueError('Could not identify the Node.js version. Use a supported Node.js LTS release.')
    major, minor, _ = map(int, numbers.groups())
    if not ((major == 20 and minor >= 19) or (major == 22 and minor >= 12) or major > 22):
        raise ValueError('The store uses Vite 7. Use Node.js 20.19+, 22.12+, or a newer supported LTS version.')
    for folder in ('store-web','control-web'):
        modules = ROOT / folder / 'node_modules'
        required = ('vite','react','react-dom','typescript') if folder == 'store-web' else ('vite','react','react-dom')
        if any(not (modules / name / 'package.json').is_file() for name in required):
            raise ValueError(f'Frontend dependencies are missing. Run: npm --prefix {folder} ci')
    store_env, control_env = service_environment('store-api'), service_environment('control-api')
    if not store_env.get('STORE_API_KEY', 'local-demo-key') or not store_env.get('STORE_ADMIN_KEY', 'local-admin-key'):
        raise ValueError('Store keys cannot be blank. Use the local-demo examples or enter matching private values locally.')
    if store_env.get('STORE_API_KEY', 'local-demo-key') != control_env.get('STORE_API_KEY', 'local-demo-key'):
        raise ValueError('Store integration keys do not match. Match STORE_API_KEY in the two backend .env files. Keys were not displayed.')
    target = control_env.get('STORE_API_URL', 'http://127.0.0.1:8001').rstrip('/')
    if target not in ('http://localhost:8001', 'http://127.0.0.1:8001'):
        raise ValueError('For this combined local demo, set STORE_API_URL=http://127.0.0.1:8001 in control-api/.env.')
    if 'STORE_DB_PATH' in store_env and not store_env['STORE_DB_PATH'].strip():
        raise ValueError('STORE_DB_PATH is blank. Remove that entry to use the default, or set a database filename.')
    database = Path(store_env.get('STORE_DB_PATH', ROOT / 'store-api' / 'store.db'))
    if not database.is_absolute():
        database = ROOT / 'store-api' / database
    check_database(database)
    check_ports()
    return npm, store_env, control_env


def stop_children(processes):
    for process in reversed(processes):
        if process.poll() is not None:
            continue
        if os.name == 'nt':
            subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'], capture_output=True)
        else:
            import signal
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    for process in processes:
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


def run(check_only=False):
    try:
        npm, store_env, control_env = preflight()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print('Cannot start: ' + str(error), file=sys.stderr)
        return 1
    if check_only:
        print('Preflight passed. No services started; no database or configuration files were changed.')
        return 0
    processes = []
    settings = {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == 'nt' else {'start_new_session': True}
    commands = [
        ('store-api', [sys.executable,'-m','uvicorn','main:app','--host','127.0.0.1','--port','8001'], store_env),
        ('control-api', [sys.executable,'-m','uvicorn','main:app','--host','127.0.0.1','--port','8002'], control_env),
        ('store-web', [npm,'run','dev','--','--host','127.0.0.1','--port','5173','--strictPort'], os.environ.copy()),
        ('control-web', [npm,'run','dev'], os.environ.copy()),
    ]
    try:
        for folder, command, env in commands:
            processes.append(subprocess.Popen(command, cwd=ROOT / folder, env=env, **settings))
        endpoints = {'store-api':'http://127.0.0.1:8001/health', 'control-api':'http://127.0.0.1:8002/api/history',
                     'store-web':'http://127.0.0.1:5173/', 'control-web':'http://127.0.0.1:5174/'}
        deadline = time.monotonic() + 25
        while endpoints:
            if any(process.poll() is not None for process in processes):
                raise RuntimeError('A service exited during startup. Read its error above and retry after fixing it.')
            if time.monotonic() > deadline:
                raise RuntimeError('Startup timed out. Check the service output above.')
            for name, url in list(endpoints.items()):
                try:
                    with urlopen(url, timeout=.5) as response:
                        if response.status == 200:
                            del endpoints[name]
                except OSError:
                    pass
            if endpoints:
                time.sleep(.2)
        print('\nReady: Store http://127.0.0.1:5173/ | VaaniControl http://127.0.0.1:5174/', flush=True)
        print('Keep this terminal open. Press Ctrl+C here to stop this stack.', flush=True)
        while all(process.poll() is None for process in processes):
            time.sleep(.3)
        raise RuntimeError('A service stopped. The remaining services from this launcher are being stopped too.')
    except KeyboardInterrupt:
        print('\nStopping this development stack...')
        return 0
    except (RuntimeError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1
    finally:
        stop_children(processes)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Check setup only; start nothing.')
    sys.exit(run(parser.parse_args().check))
