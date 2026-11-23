"""Launcher checks use mocks and disposable files, never the user's running stack."""
import importlib.util
from pathlib import Path
import sqlite3
import sys
from unittest.mock import MagicMock, Mock

import pytest

spec = importlib.util.spec_from_file_location('integration_launcher', Path(__file__).resolve().parents[1] / 'run_dev.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


def test_missing_database_check_does_not_create_a_file(tmp_path):
    target = tmp_path / 'new.db'
    launcher.check_database(target)
    assert not target.exists()


def test_old_database_is_rejected_without_changing_it(tmp_path):
    target = tmp_path / 'old.db'
    con = sqlite3.connect(target)
    try:
        con.execute('CREATE TABLE products(id INTEGER PRIMARY KEY,name TEXT,price INTEGER,stock INTEGER)')
        con.commit()
    finally:
        con.close()
    original = target.read_bytes()
    with pytest.raises(ValueError, match='incompatible schema'):
        launcher.check_database(target)
    assert target.read_bytes() == original


def test_compatible_database_is_read_only(tmp_path):
    target = tmp_path / 'current.db'
    con = sqlite3.connect(target)
    try:
        for table, columns in launcher.SCHEMA.items():
            con.execute(f'CREATE TABLE {table} (' + ','.join(name+' TEXT' for name in columns) + ')')
        con.commit()
    finally:
        con.close()
    before = target.read_bytes()
    launcher.check_database(target)
    assert target.read_bytes() == before


def test_unreadable_database_is_reported_without_replacing_it(tmp_path):
    target = tmp_path / 'bad.db'
    target.write_bytes(b'not a database')
    with pytest.raises(ValueError, match='could not be read'):
        launcher.check_database(target)
    assert target.read_bytes() == b'not a database'


def test_service_envs_remain_separate_and_existing_environment_wins(tmp_path, monkeypatch):
    monkeypatch.setattr(launcher, 'ROOT', tmp_path)
    monkeypatch.setattr(launcher.os, 'environ', {'SHARED':'inherited'})
    for folder, key in [('store-api','store-test'),('control-api','control-test')]:
        (tmp_path / folder).mkdir()
        (tmp_path / folder / '.env').write_text(f'STORE_API_KEY={key}\nSHARED=file\n')
    assert launcher.service_environment('store-api')['STORE_API_KEY'] == 'store-test'
    assert launcher.service_environment('control-api')['STORE_API_KEY'] == 'control-test'
    assert launcher.service_environment('store-api')['SHARED'] == 'inherited'
    assert 'STORE_API_KEY' not in launcher.os.environ


def test_busy_ports_reported_without_stopping_processes(monkeypatch):
    socket_factory = MagicMock()
    socket_factory.return_value.__enter__.return_value.bind.side_effect = OSError('busy')
    monkeypatch.setattr(launcher.socket, 'socket', socket_factory)
    with pytest.raises(ValueError, match='8001, 8002, 5173, 5174'):
        launcher.check_ports()


def test_check_only_starts_nothing(monkeypatch):
    monkeypatch.setattr(launcher, 'preflight', Mock(return_value=('npm',{},{})))
    spawn = Mock()
    monkeypatch.setattr(launcher.subprocess, 'Popen', spawn)
    assert launcher.run(check_only=True) == 0
    spawn.assert_not_called()


def test_failed_preflight_starts_nothing(monkeypatch):
    monkeypatch.setattr(launcher, 'preflight', Mock(side_effect=ValueError('occupied')))
    spawn = Mock()
    monkeypatch.setattr(launcher.subprocess, 'Popen', spawn)
    assert launcher.run() == 1
    spawn.assert_not_called()


def test_child_failure_cleans_up_only_the_launched_children(monkeypatch):
    monkeypatch.setattr(launcher, 'preflight', Mock(return_value=('npm',{},{})))
    processes = [Mock() for _ in range(4)]
    processes[0].poll.return_value = 1
    monkeypatch.setattr(launcher.subprocess, 'Popen', Mock(side_effect=processes))
    stop = Mock()
    monkeypatch.setattr(launcher, 'stop_children', stop)
    assert launcher.run() == 1
    stop.assert_called_once_with(processes)


def test_ctrl_c_after_ready_cleans_up_children(monkeypatch):
    monkeypatch.setattr(launcher, 'preflight', Mock(return_value=('npm',{},{})))
    processes = [Mock() for _ in range(4)]
    for process in processes:
        process.poll.return_value = None
    monkeypatch.setattr(launcher.subprocess, 'Popen', Mock(side_effect=processes))
    response = MagicMock()
    response.__enter__.return_value.status = 200
    monkeypatch.setattr(launcher, 'urlopen', Mock(return_value=response))
    monkeypatch.setattr(launcher.time, 'sleep', Mock(side_effect=KeyboardInterrupt))
    stop = Mock()
    monkeypatch.setattr(launcher, 'stop_children', stop)
    assert launcher.run() == 0
    stop.assert_called_once_with(processes)


@pytest.fixture
def ready_setup(tmp_path, monkeypatch):
    monkeypatch.setattr(launcher, 'ROOT', tmp_path)
    monkeypatch.setattr(launcher.importlib.util, 'find_spec', lambda name: object())
    monkeypatch.setattr(launcher.shutil, 'which', lambda name: name)
    monkeypatch.setattr(launcher.subprocess, 'check_output', lambda *a,**k: 'v24.13.0')
    envs = {'store-api':{}, 'control-api':{}}
    monkeypatch.setattr(launcher, 'service_environment', lambda folder: envs[folder])
    for folder, modules in [('store-web',('react','react-dom','vite','typescript')),('control-web',('react','react-dom','vite'))]:
        for module in modules:
            path = tmp_path / folder / 'node_modules' / module / 'package.json'
            path.parent.mkdir(parents=True,exist_ok=True)
            path.write_text('{}')
    database, ports = Mock(), Mock()
    monkeypatch.setattr(launcher, 'check_database', database)
    monkeypatch.setattr(launcher, 'check_ports', ports)
    return envs, database, ports


def test_preflight_resolves_relative_db_under_store_api(ready_setup, tmp_path):
    envs, database, ports = ready_setup
    envs['store-api']['STORE_DB_PATH'] = 'integration-demo.db'
    launcher.preflight()
    database.assert_called_once_with(tmp_path / 'store-api' / 'integration-demo.db')
    ports.assert_called_once()


@pytest.mark.parametrize('setting',['mismatched-key','blank-key','blank-db','other-store'])
def test_invalid_configuration_does_not_probe_or_start_services(ready_setup, setting):
    envs, database, ports = ready_setup
    if setting == 'mismatched-key': envs['control-api']['STORE_API_KEY'] = 'different-test-key'
    elif setting == 'blank-key': envs['store-api']['STORE_API_KEY'] = ''
    elif setting == 'blank-db': envs['store-api']['STORE_DB_PATH'] = ''
    else: envs['control-api']['STORE_API_URL'] = 'https://other.example.test'
    with pytest.raises(ValueError): launcher.preflight()
    database.assert_not_called()
    ports.assert_not_called()
