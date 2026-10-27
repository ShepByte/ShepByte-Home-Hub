"""Small standard-library HTTPS server, suitable for a private Pi LAN."""
import argparse
import json
import os
from pathlib import Path
import ssl
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from .core import Hub, Error
from .updater import Updater

ROOT = Path(__file__).resolve().parent.parent


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, *_):
        pass  # Never log request bodies, bearer tokens or invitations.

    def respond(self, status, data, kind='application/json'):
        raw = json.dumps(data, allow_nan=False).encode() if kind == 'application/json' else data
        self.send_response(status)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        self.dispatch()

    def do_POST(self):
        self.dispatch()

    def dispatch(self):
        try:
            # Browser writes must be same-origin; device clients do not send Origin.
            origin = self.headers.get('Origin')
            scheme = 'https' if isinstance(self.connection, ssl.SSLSocket) else 'http'
            if origin and origin != scheme+'://'+self.headers.get('Host',''):
                raise Error(403, 'Cross-origin request rejected')
            static = {'/':'web/index.html','/app.js':'web/app.js','/style.css':'web/style.css',
                      '/prototype/':'prototype/index.html','/prototype/css/style.css':'prototype/css/style.css','/prototype/js/app.js':'prototype/js/app.js'}
            if self.command == 'GET' and self.path in static:
                file = ROOT/static[self.path]
                kind = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'}[file.suffix]
                return self.respond(200,file.read_bytes(),kind)
            body = None
            if self.command == 'POST':
                if self.headers.get('Content-Type','').split(';')[0] != 'application/json' or self.headers.get('Transfer-Encoding'):
                    raise Error(400,'JSON body required')
                try:
                    size = int(self.headers.get('Content-Length','0'))
                except ValueError:
                    raise Error(400,'Invalid content length') from None
                if not 0 < size <= 32768:
                    raise Error(413,'Body too large or empty')
                try:
                    body = json.loads(self.rfile.read(size), parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
                except (ValueError, UnicodeError):
                    raise Error(400,'Invalid JSON') from None
            auth = self.headers.get('Authorization','')
            bearer = auth[7:] if auth.startswith('Bearer ') else ''
            if self.path == '/api/v1/admin/update':
                # Reuse the existing administrator authentication boundary.
                self.server.hub.request('GET', '/api/v1/admin/devices', None, bearer)
                if self.command == 'POST' and body != {}:
                    raise Error(400, 'Update accepts an empty JSON object only')
                result = self.server.updater.start() if self.command == 'POST' else self.server.updater.status()
                return self.respond(200, result)
            result = self.server.hub.request(self.command,self.path,body,bearer,self.headers.get('X-Hub-ID',''))
            self.respond(200,result)
        except Error as error:
            self.respond(error.status,dict(error=error.message))
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            return
        except Exception:
            self.respond(500,dict(error='Internal error'))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host',default='127.0.0.1')
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--data',default='data')
    parser.add_argument('--cert'); parser.add_argument('--key')
    args = parser.parse_args()
    if args.host not in ('127.0.0.1','localhost') and not (args.cert and args.key):
        parser.error('LAN listeners require --cert and --key (HTTPS)')
    os.umask(0o077)
    folder = Path(args.data); folder.mkdir(parents=True,exist_ok=True,mode=0o700)
    admin = os.environ.get('HOME_HUB_ADMIN_TOKEN','')
    if len(admin) < 43:
        parser.error('Set HOME_HUB_ADMIN_TOKEN to a token generated with secrets.token_urlsafe(32)')
    server = ThreadingHTTPServer((args.host,args.port),Handler)
    server.hub = Hub(str(folder/'hub.sqlite3'),admin)
    enabled = os.environ.get('HOME_HUB_ALLOW_UPDATE') == '1'
    # Exit with failure so the existing systemd Restart=on-failure restarts us.
    restart = (lambda: os._exit(1)) if os.environ.get('HOME_HUB_UPDATE_RESTART') == '1' else None
    server.updater = Updater(ROOT, enabled, restart)
    if args.cert and args.key:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(args.cert,args.key)
        server.socket = context.wrap_socket(server.socket,server_side=True)
    stop = threading.Event()
    def sweep():
        while not stop.wait(5):
            with server.hub.lock:
                server.hub.sweep(); server.hub.db.commit()
    threading.Thread(target=sweep,daemon=True).start()
    print('Home Hub identity:',server.hub.id,flush=True)
    print('Open dashboard on port',args.port,flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set(); server.server_close()


if __name__ == '__main__':
    main()
