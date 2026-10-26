"""End-to-end simulator against a real HTTP listener, no broker or real Pi."""
import json
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from home_hub.core import Hub
from home_hub.server import Handler


class SimulatorTest(unittest.TestCase):
    def test_registration_approval_reporting_and_pinned_hub(self):
        with tempfile.TemporaryDirectory() as folder:
            admin=secrets.token_urlsafe(32)
            hub=Hub(str(Path(folder)/'hub.db'),admin)
            server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.hub=hub
            threading.Thread(target=server.serve_forever,daemon=True).start()
            def owner(path,body=None):
                return hub.request('GET' if body is None else 'POST','/api/v1/admin/'+path,body,admin)
            invite=owner('invites',{})
            state=Path(folder)/'sim.json'
            command=[sys.executable,'simulator/market_monitor.py','--hub',f'http://127.0.0.1:{server.server_port}','--hub-id',hub.id,'--interval','1','--state',str(state),'--share-financial']
            process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            try:
                process.stdin.write(invite['invitation']+'\n');process.stdin.flush()
                def until(predicate):
                    deadline=time.monotonic()+8
                    while time.monotonic()<deadline:
                        result=predicate()
                        if result:return result
                        time.sleep(.05)
                    self.fail('Simulator timed out')
                rows=until(lambda:owner('devices')['devices']);device=rows[0]['device_id']
                self.assertEqual('pending',rows[0]['status']);self.assertFalse(rows[0]['online'])
                owner('devices/'+device+'/approve',{})
                until(lambda:owner('devices')['devices'][0]['online'])
                self.assertNotIn('financial',owner('devices')['devices'][0]['snapshot'])
                owner('devices/'+device+'/settings',{'share_financial':True})
                until(lambda:owner('devices')['devices'][0]['snapshot'].get('financial'))
                self.assertEqual('300.00',owner('devices')['devices'][0]['snapshot']['financial']['live']['total'])
                until(lambda:any(e['kind']=='research.completed' for e in owner('devices/'+device+'/history')['events']))
                owner('devices/'+device+'/revoke',{})
                process.wait(timeout=5)
                self.assertEqual(0,process.returncode)
                self.assertEqual(0o600,state.stat().st_mode & 0o777)
                command[command.index('--hub-id')+1]='different-hub'
                rejected=subprocess.run(command,capture_output=True,text=True,timeout=5)
                self.assertNotEqual(0,rejected.returncode)
                self.assertIn('Bound to another hub',rejected.stderr)
            finally:
                if process.poll() is None:process.terminate()
                process.communicate(timeout=5)
                server.shutdown();server.server_close();hub.db.close()

if __name__=='__main__':unittest.main()
