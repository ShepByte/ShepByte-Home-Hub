"""Protocol v1. Only allowlisted observations cross this boundary."""
import hashlib
import hmac
import json
import math
import re
import secrets
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import urlsplit


class Error(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def require(ok, message='Invalid request', status=400):
    if not ok:
        raise Error(status, message)


def shape(value, keys):
    require(isinstance(value, dict) and set(value) == set(keys), 'Unexpected or missing fields')


def text(value, maximum=80):
    require(isinstance(value, str) and 0 < len(value) <= maximum and all(ord(c) >= 32 for c in value))


def stamp(value):
    text(value, 40)
    try:
        dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
        require(dt.tzinfo is not None and dt.timestamp() <= time.time() + 300)
    except (ValueError, OverflowError):
        raise Error(400, 'Invalid timestamp') from None


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def token(value):
    require(isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_-]{43,128}', value) is not None)


def url(value):
    text(value, 300)
    try:
        p = urlsplit(value)
        require(p.scheme in ('http', 'https') and bool(p.hostname) and not p.username and not p.password and not p.query and not p.fragment)
        p.port
    except ValueError:
        raise Error(400, 'Invalid dashboard URL') from None


def number(value, maximum, minimum=0):
    require(value is None or (type(value) in (int, float) and math.isfinite(value) and minimum <= value <= maximum))


def telemetry(data):
    shape(data, ['cpu_percent', 'cpu_temp_c', 'ram_used_bytes', 'ram_total_bytes', 'storage_used_bytes', 'storage_total_bytes', 'uptime_seconds'])
    for k, v in data.items():
        number(v, 100 if k == 'cpu_percent' else 150 if k == 'cpu_temp_c' else 10**16, -50 if k == 'cpu_temp_c' else 0)
    for prefix in ('ram', 'storage'):
        used, total = data[prefix+'_used_bytes'], data[prefix+'_total_bytes']
        require(used is None or total is None or used <= total)


def finances(data):
    shape(data, ['live', 'practice'])
    for item in data.values():
        if item is None:
            continue
        shape(item, ['currency', 'observed_at', 'state', 'total', 'available', 'invested'])
        require(isinstance(item['currency'], str) and re.fullmatch('[A-Z]{3}', item['currency']))
        stamp(item['observed_at'])
        require(item['state'] in ('current', 'stale', 'degraded', 'unavailable'))
        for k in ('total', 'available', 'invested'):
            require(isinstance(item[k], str) and re.fullmatch(r'-?\d{1,16}(\.\d{1,8})?', item[k]))


class Hub:
    def __init__(self, path, admin, clock=time.time):
        token(admin)
        self.admin, self.clock = digest(admin), clock
        self.lock = threading.RLock()
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT);
        CREATE TABLE IF NOT EXISTS invites(hash TEXT PRIMARY KEY,expires REAL);
        CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,name TEXT,version TEXT,url TEXT,credential TEXT,status TEXT,expires REAL,share INTEGER DEFAULT 0,seq INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS events(cursor INTEGER PRIMARY KEY AUTOINCREMENT,device TEXT,event_id TEXT,kind TEXT,occurred_at TEXT,received_at TEXT,UNIQUE(device,event_id));
        ''')
        self.db.execute('INSERT OR IGNORE INTO meta VALUES(?,?)', ('hub_id', str(uuid.uuid4())))
        self.db.commit()
        self.id = self.db.execute('SELECT value FROM meta WHERE key=?', ('hub_id',)).fetchone()[0]
        self.live = {}

    def event(self, device, kind, event_id=None, occurred=None):
        now = datetime.fromtimestamp(self.clock(), timezone.utc).isoformat()
        self.db.execute('INSERT OR IGNORE INTO events(device,event_id,kind,occurred_at,received_at) VALUES(?,?,?,?,?)',
                        (device, event_id or str(uuid.uuid4()), kind, occurred or now, now))

    def sweep(self):
        for device, live in self.live.items():
            if live['online'] and self.clock() - live['received'] >= 90:
                live['online'] = False
                live['snapshot'] = None
                self.event(device, 'device.offline')
        self.db.execute("UPDATE devices SET status='expired' WHERE status='pending' AND expires<=?", (self.clock(),))
        self.db.execute('DELETE FROM invites WHERE expires<=?', (self.clock(),))

    def device_view(self, row):
        live = self.live.get(row['id'], {})
        return dict(device_id=row['id'], name=row['name'], software_version=row['version'], dashboard_url=row['url'],
                    status=row['status'], share_financial=bool(row['share']), online=live.get('online', False),
                    last_seen=live.get('received'), snapshot=live.get('snapshot'))

    def request(self, method, path, body=None, bearer='', hub_id=''):
        with self.lock:
            try:
                self.sweep()
                self.db.commit()
                result = self.route(method, path, body, bearer, hub_id)
                self.db.commit()
                return result
            except Exception:
                self.db.rollback()
                raise

    def route(self, method, path, body, bearer, hub_id):
        if path == '/api/v1/info' and method == 'GET':
            return dict(protocol_version=1, hub_id=self.id, heartbeat_seconds=30, offline_after_seconds=90)
        if path.startswith('/api/v1/admin/'):
            require(hmac.compare_digest(digest(bearer), self.admin), 'Unauthorised', 401)
            base = '/api/v1/admin/'
            action = path[len(base):]
            if action == 'invites' and method == 'POST':
                shape(body, [])
                secret = secrets.token_urlsafe(32)
                self.db.execute('INSERT INTO invites VALUES(?,?)', (digest(secret), self.clock()+600))
                return dict(invitation=secret, hub_id=self.id, expires_in=600)
            if action == 'devices' and method == 'GET':
                return dict(devices=[self.device_view(r) for r in self.db.execute('SELECT * FROM devices')])
            parts = action.split('/')
            if len(parts) == 3 and parts[0] == 'devices':
                device, operation = parts[1:]
                row = self.db.execute('SELECT * FROM devices WHERE id=?', (device,)).fetchone()
                require(row is not None, 'Unknown device', 404)
                if operation == 'history' and method == 'GET':
                    return dict(events=[dict(r) for r in self.db.execute('SELECT cursor,event_id,kind,occurred_at,received_at FROM events WHERE device=? ORDER BY cursor DESC LIMIT 200', (device,))])
                if operation in ('approve', 'reject', 'revoke') and method == 'POST':
                    shape(body, [])
                    require(row['status'] == ('approved' if operation == 'revoke' else 'pending'), 'Invalid pairing state', 409)
                    status = {'approve':'approved', 'reject':'rejected', 'revoke':'revoked'}[operation]
                    self.db.execute('UPDATE devices SET status=? WHERE id=?', (status,device))
                    self.live.pop(device, None)
                    self.event(device, 'pairing.'+status)
                    return dict(status=status)
                if operation == 'settings' and method == 'POST':
                    shape(body, ['share_financial'])
                    require(type(body['share_financial']) is bool and row['status'] == 'approved')
                    self.db.execute('UPDATE devices SET share=? WHERE id=?', (body['share_financial'],device))
                    if self.live.get(device, {}).get('snapshot'):
                        self.live[device]['snapshot'].pop('financial', None)
                    self.event(device, 'sharing.enabled' if body['share_financial'] else 'sharing.disabled')
                    return body
            raise Error(404, 'Unknown endpoint')
        if path == '/api/v1/pairings' and method == 'POST':
            shape(body, ['protocol_version', 'hub_id', 'invitation', 'device_id', 'name', 'software_version', 'dashboard_url', 'device_token'])
            require(body['protocol_version'] == 1 and type(body['protocol_version']) is int, 'Unsupported protocol', 400)
            require(body['hub_id'] == self.id, 'Hub identity mismatch', 409)
            token(body['invitation']); token(body['device_token'])
            text(body['device_id']); require(re.fullmatch(r'[A-Za-z0-9_-]{1,80}',body['device_id']))
            text(body['name']); text(body['software_version']); url(body['dashboard_url'])
            invite = self.db.execute('SELECT * FROM invites WHERE hash=? AND expires>?', (digest(body['invitation']),self.clock())).fetchone()
            require(invite is not None, 'Invalid or expired invitation', 401)
            require(not self.db.execute('SELECT 1 FROM devices WHERE id=?',(body['device_id'],)).fetchone(), 'Identity already registered; explicit local reset and new identity required',409)
            self.db.execute('DELETE FROM invites WHERE hash=?', (digest(body['invitation']),))
            self.db.execute('INSERT INTO devices(id,name,version,url,credential,status,expires) VALUES(?,?,?,?,?,?,?)',
                            (body['device_id'],body['name'],body['software_version'],body['dashboard_url'],digest(body['device_token']),'pending',self.clock()+600))
            self.event(body['device_id'], 'pairing.requested')
            return dict(status='pending', hub_id=self.id)
        parts = path.split('/')
        if len(parts) == 6 and parts[1:4] == ['api','v1','devices']:
            device, action = parts[4:]
            require(hub_id == self.id, 'Hub identity mismatch', 409)
            row = self.db.execute('SELECT * FROM devices WHERE id=?', (device,)).fetchone()
            require(row is not None and hmac.compare_digest(row['credential'],digest(bearer)), 'Unauthorised',401)
            if action == 'status' and method == 'GET':
                return dict(status=row['status'],hub_id=self.id,share_financial=bool(row['share']),last_sequence=row['seq'])
            require(row['status'] == 'approved', 'Device not approved',403)
            if action == 'heartbeat' and method == 'POST':
                require(isinstance(body,dict))
                shape(body, ['sequence','observed_at','hardware','research'] + (['financial'] if 'financial' in body else []))
                require(type(body['sequence']) is int and row['seq'] < body['sequence'] <= 2**63-1, 'Replay or invalid sequence',409)
                stamp(body['observed_at']); telemetry(body['hardware'])
                shape(body['research'], ['state','last_completed_at'])
                require(body['research']['state'] in ('idle','running','completed','failed','unavailable'))
                if body['research']['last_completed_at'] is not None:
                    stamp(body['research']['last_completed_at'])
                if 'financial' in body:
                    require(bool(row['share']), 'Financial sharing disabled',403)
                    finances(body['financial'])
                if not self.live.get(device,{}).get('online'):
                    self.event(device,'device.online')
                self.live[device] = dict(online=True,received=self.clock(),snapshot=json.loads(json.dumps(body)))
                self.db.execute('UPDATE devices SET seq=? WHERE id=?',(body['sequence'],device))
                return dict(accepted=True,hub_id=self.id,share_financial=bool(row['share']))
            if action == 'events' and method == 'POST':
                shape(body,['events'])
                require(isinstance(body['events'],list) and 1 <= len(body['events']) <= 50)
                for event in body['events']:
                    shape(event,['event_id','kind','occurred_at'])
                    text(event['event_id']); stamp(event['occurred_at'])
                    require(event['kind'] in ('research.completed','research.failed','warning.cpu_hot','warning.ram_high','warning.storage_high','warning.data_stale','service.started','service.failed'))
                for event in body['events']:
                    self.event(device,event['kind'],event['event_id'],event['occurred_at'])
                return dict(accepted=[e['event_id'] for e in body['events']],hub_id=self.id)
        raise Error(404, 'Unknown endpoint')
