import copy
from datetime import datetime,timezone
import json
from pathlib import Path
import secrets
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer
from home_hub.core import Hub,Error
from home_hub.server import Handler

class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.path=str(Path(self.temp.name)/'hub.db');self.admin=secrets.token_urlsafe(32);self.key=secrets.token_urlsafe(32)
        self.clock=[1770000000.0];self.hub=Hub(self.path,self.admin,lambda:self.clock[0]);self.addCleanup(self.hub.db.close)
        self.device='market-test';self.base='/api/v1/devices/'+self.device+'/'
        self.body=dict(sequence=1,observed_at='2026-01-01T00:00:00Z',hardware=dict(cpu_percent=10,cpu_temp_c=None,ram_used_bytes=20,ram_total_bytes=100,storage_used_bytes=10,storage_total_bytes=100,uptime_seconds=10),research=dict(state='completed',last_completed_at=None))
    def admin_call(self,action,body=None):
        return self.hub.request('GET' if body is None else 'POST','/api/v1/admin/'+action,body,self.admin)
    def device_call(self,action,body=None):
        return self.hub.request('GET' if body is None else 'POST',self.base+action,body,self.key,self.hub.id)
    def pair(self,approve=True):
        invite=self.admin_call('invites',{})
        body=dict(protocol_version=1,hub_id=self.hub.id,invitation=invite['invitation'],device_id=self.device,name='Market Monitor',software_version='test',dashboard_url='http://localhost:8080',device_token=self.key)
        self.hub.request('POST','/api/v1/pairings',body)
        if approve:self.admin_call('devices/'+self.device+'/approve',{})
        return body
    def assert_error(self,status,fn):
        with self.assertRaises(Error) as e:fn()
        self.assertEqual(status,e.exception.status)
    def test_owner_approval_required(self):
        self.pair(False);self.assertEqual('pending',self.device_call('status')['status'])
        self.assert_error(403,lambda:self.device_call('heartbeat',self.body))
        self.assert_error(401,lambda:self.hub.request('POST','/api/v1/admin/devices/market-test/approve',{},self.key))
        self.admin_call('devices/'+self.device+'/approve',{});self.device_call('heartbeat',self.body)
    def test_invitation_single_use_expiry_and_identity_collision(self):
        original=self.pair();self.assert_error(401,lambda:self.hub.request('POST','/api/v1/pairings',original))
        original['invitation']=self.admin_call('invites',{})['invitation']
        self.assert_error(409,lambda:self.hub.request('POST','/api/v1/pairings',original))
        original['device_id']='other';self.clock[0]+=601
        self.assert_error(401,lambda:self.hub.request('POST','/api/v1/pairings',original))
    def test_pending_expires(self):
        self.pair(False);self.clock[0]+=601
        self.assertEqual('expired',self.device_call('status')['status'])
        self.assert_error(409,lambda:self.admin_call('devices/'+self.device+'/approve',{}))
    def test_wrong_hub_wrong_token_and_revoke(self):
        self.pair()
        self.assert_error(409,lambda:self.hub.request('POST',self.base+'heartbeat',self.body,self.key,'rogue'))
        self.assert_error(401,lambda:self.hub.request('POST',self.base+'heartbeat',self.body,'bad',self.hub.id))
        self.admin_call('devices/'+self.device+'/revoke',{})
        self.assert_error(403,lambda:self.device_call('heartbeat',self.body))
    def test_replay_restart_and_volatile_telemetry(self):
        self.pair();self.device_call('heartbeat',self.body)
        self.assert_error(409,lambda:self.device_call('heartbeat',self.body))
        other=Hub(self.path,self.admin);self.addCleanup(other.db.close)
        self.assertEqual(self.hub.id,other.id)
        self.assertFalse(other.request('GET','/api/v1/admin/devices',bearer=self.admin)['devices'][0]['online'])
        self.assert_error(409,lambda:other.request('POST',self.base+'heartbeat',self.body,self.key,other.id))
        self.assertNotIn('cpu_percent',Path(self.path).read_bytes().decode(errors='ignore'))
    def test_offline_boundary_recovery(self):
        self.pair();self.device_call('heartbeat',self.body);self.clock[0]+=89
        self.assertTrue(self.admin_call('devices')['devices'][0]['online']);self.clock[0]+=1
        view=self.admin_call('devices')['devices'][0];self.assertFalse(view['online']);self.assertIsNone(view['snapshot'])
        self.body['sequence']=2;self.device_call('heartbeat',self.body)
        events=self.admin_call('devices/'+self.device+'/history')['events']
        self.assertEqual(1,sum(e['kind']=='device.offline' for e in events));self.assertEqual(2,sum(e['kind']=='device.online' for e in events))
    def test_financial_dual_mode_opt_in_and_clear(self):
        self.pair();f=dict(currency='GBP',observed_at='2026-01-01T00:00:00Z',state='current',total='10.00',available='2.00',invested='8.00')
        self.body['financial']=dict(live=f,practice={**f,'total':'1000.00'})
        self.assert_error(403,lambda:self.device_call('heartbeat',self.body))
        self.admin_call('devices/'+self.device+'/settings',dict(share_financial=True));self.device_call('heartbeat',self.body)
        s=self.admin_call('devices')['devices'][0]['snapshot'];self.assertEqual('1000.00',s['financial']['practice']['total'])
        self.admin_call('devices/'+self.device+'/settings',dict(share_financial=False))
        self.assertNotIn('financial',self.admin_call('devices')['devices'][0]['snapshot'])
        self.body['sequence']=2;self.assert_error(403,lambda:self.device_call('heartbeat',self.body))
    def test_events_deduplicated_atomic_and_no_free_text(self):
        self.pair();e=dict(event_id='abc',kind='research.completed',occurred_at='2026-01-01T00:00:00Z')
        for _ in range(2):self.device_call('events',dict(events=[e]))
        events=self.admin_call('devices/'+self.device+'/history')['events'];self.assertEqual(1,sum(x['event_id']=='abc' for x in events))
        self.assert_error(400,lambda:self.device_call('events',dict(events=[{**e,'event_id':'new'},{**e,'message':'broker secret'}])))
        self.assertFalse(any(x['event_id']=='new' for x in self.admin_call('devices/'+self.device+'/history')['events']))
    def test_unknown_fields_values_and_trade_endpoints_rejected(self):
        self.pair()
        for bad in [{**self.body,'broker_credentials':'secret'},{**self.body,'hardware':{**self.body['hardware'],'cpu_percent':float('nan')}},{**self.body,'research':{**self.body['research'],'state':'enable_trading'}}]:
            self.assert_error(400,lambda:self.device_call('heartbeat',bad))
        self.assert_error(404,lambda:self.device_call('trade',{}))
    def test_http_auth_origin_static_and_limits(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.hub=self.hub
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        self.addCleanup(server.server_close);self.addCleanup(server.shutdown)
        root='http://127.0.0.1:'+str(server.server_port)
        with urllib.request.urlopen(root+'/') as r:self.assertIn(b'ShepByte',r.read());self.assertEqual('no-store',r.headers['Cache-Control'])
        for path,data,headers,status in [('/api/v1/admin/devices',None,{},401),('/api/v1/admin/invites',b'{}',{'Content-Type':'application/json','Authorization':'Bearer '+self.admin,'Origin':'https://evil.example'},403),('/api/v1/pairings',b'x'*32769,{'Content-Type':'application/json'},413)]:
            req=urllib.request.Request(root+path,data=data,headers=headers)
            with self.assertRaises(urllib.error.HTTPError) as e:urllib.request.urlopen(req)
            self.assertEqual(status,e.exception.code)

if __name__=='__main__':unittest.main()
