#!/usr/bin/env python3
"""Synthetic observations only. Never imports Market Monitor or contacts a broker."""
import argparse
from datetime import datetime, timezone
import getpass
import json
import os
from pathlib import Path
import secrets
import ssl
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit
import uuid


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError('Redirect rejected; configured hub endpoint is pinned')


def now():
    return datetime.now(timezone.utc).isoformat()


def save(path, state):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(state));temp.chmod(0o600);temp.replace(path)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--hub',required=True,help='Explicit hub origin, e.g. https://homehub.local:8765')
    parser.add_argument('--hub-id',required=True,help='Copy from trusted hub dashboard')
    parser.add_argument('--ca',help='Trusted CA/certificate file; never disables TLS verification')
    parser.add_argument('--state',default='simulator-state.json')
    parser.add_argument('--share-financial',action='store_true',help='Local consent; hub must also opt in')
    parser.add_argument('--interval',type=float,default=30)
    args=parser.parse_args()
    if args.interval < 1: parser.error('Interval must be at least 1 second')
    origin=args.hub.rstrip('/');u=urlsplit(origin)
    if u.scheme not in ('http','https') or not u.hostname or u.username or u.password or u.path or u.query or u.fragment:
        parser.error('Use a plain hub origin')
    if u.scheme!='https' and u.hostname not in ('127.0.0.1','localhost'):
        parser.error('HTTPS required except loopback development')
    os.umask(0o077)
    path=Path(args.state)
    if path.exists():
        state=json.loads(path.read_text())
        if state['hub']!=origin or state['hub_id']!=args.hub_id:
            parser.error('Bound to another hub; explicit local removal of state and fresh pairing required')
    else:
        state=dict(hub=origin,hub_id=args.hub_id,device_id='market-sim-'+str(uuid.uuid4()),token=secrets.token_urlsafe(32),registered=False,sequence=0,pending=[])
        save(path,state)
    context=ssl.create_default_context(cafile=args.ca)
    opener=urllib.request.build_opener(NoRedirect(),urllib.request.HTTPSHandler(context=context))
    def request(endpoint,body=None):
        req=urllib.request.Request(origin+'/api/v1/'+endpoint,data=None if body is None else json.dumps(body).encode(),
            headers={'Content-Type':'application/json','Authorization':'Bearer '+state['token'],'X-Hub-ID':state['hub_id']})
        with opener.open(req,timeout=5) as response:
            data=json.load(response)
        if data.get('hub_id',state['hub_id'])!=state['hub_id']:
            raise RuntimeError('Hub identity changed; refusing communication')
        return data
    # Hub identity is checked against the operator-provided value, never blindly adopted.
    request('info')
    prefix='devices/'+state['device_id']+'/'
    if not state['registered']:
        try:
            request(prefix+'status')  # recover a lost pairing response without another invitation
        except urllib.error.HTTPError as e:
            if e.code!=401: raise
            invite=getpass.getpass('Pairing invitation: ')
            request('pairings',dict(protocol_version=1,hub_id=state['hub_id'],invitation=invite,
                device_id=state['device_id'],name='Market Monitor (SIMULATED)',software_version='sim-1.0',
                dashboard_url='http://127.0.0.1:8080',device_token=state['token']))
        state['registered']=True;save(path,state)
    print('Approve this device ID in Home Hub:',state['device_id'],flush=True)
    print('Synthetic local workload continues if the hub is unavailable. Ctrl+C to stop.',flush=True)
    start=time.monotonic();cycle=0;backoff=args.interval
    while True:
        cycle+=1
        # Model independent work before any optional networking. Bounded durable event outbox.
        kind=['research.completed','warning.data_stale','research.failed'][((cycle-1)//3)%3]
        if cycle%3==1:
            state['pending']=(state['pending']+[dict(event_id=str(uuid.uuid4()),kind=kind,occurred_at=now())])[-100:]
            save(path,state)
        print('Synthetic workload tick',cycle,flush=True)
        try:
            status=request(prefix+'status')
            if status['status'] in ('rejected','revoked','expired'):
                print('Pairing '+status['status']+'; reporting stopped. Device work is independent.');return
            if status['status']!='approved':
                print('Awaiting owner approval.',flush=True);time.sleep(args.interval);continue
            state['sequence']=max(state['sequence'],status['last_sequence'])+1;save(path,state)
            payload=dict(sequence=state['sequence'],observed_at=now(),
                hardware=dict(cpu_percent=12+cycle%20,cpu_temp_c=43.2,ram_used_bytes=240000000,ram_total_bytes=1000000000,
                              storage_used_bytes=5000000000,storage_total_bytes=64000000000,uptime_seconds=int(time.monotonic()-start)),
                research=dict(state='running' if cycle%3==0 else 'completed',last_completed_at=now()))
            if args.share_financial and status['share_financial']:
                def fund(total):
                    return dict(currency='GBP',observed_at=now(),state='current',total=total,available='100.00',invested='200.00')
                payload['financial']=dict(live=fund('300.00'),practice=fund('10000.00'))
            request(prefix+'heartbeat',payload)
            if state['pending']:
                ack=request(prefix+'events',dict(events=state['pending'][:50]))
                accepted=set(ack['accepted']);state['pending']=[e for e in state['pending'] if e['event_id'] not in accepted];save(path,state)
            print('Heartbeat delivered; queued events:',len(state['pending']),flush=True);backoff=args.interval
        except (OSError,ValueError,RuntimeError,urllib.error.URLError):
            # Do not expose arbitrary remote responses or credentials in logs.
            print('Hub unavailable or report rejected; local workload continues; events retained.',flush=True)
            backoff=min(max(args.interval,backoff*2),120)
        time.sleep(backoff)


if __name__=='__main__':
    try:main()
    except KeyboardInterrupt:pass
