"""Owner-triggered, fast-forward-only updates of the installed checkout."""
import os
import subprocess
import threading
import time
from .core import Error

SOURCE = 'https://github.com/ShepByte/ShepByte-Home-Hub.git'


class Updater:
    def __init__(self, root, enabled=False, restart=None):
        self.root = root
        self.enabled = enabled
        self.restart = restart
        self.lock = threading.Lock()
        self.state = dict(status='idle', message='Ready' if enabled else 'One-time updater service setup required.')

    def status(self):
        with self.lock:
            return dict(self.state, enabled=self.enabled)

    def git(self, *args):
        return subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', *args],
                              cwd=self.root, env=dict(os.environ, GIT_TERMINAL_PROMPT='0'),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              text=True, timeout=120, check=True).stdout.strip()

    def start(self):
        with self.lock:
            if not self.enabled:
                raise Error(409, 'Updater is not enabled. Complete the service setup first.')
            if self.state['status'] in ('running', 'restarting'):
                raise Error(409, 'An update is already running.')
            self.state = dict(status='running', message='Checking the checkout and fetching main…')
            threading.Thread(target=self.run, daemon=True).start()
            return dict(self.state, enabled=True)

    def set_state(self, status, message):
        with self.lock:
            self.state = dict(status=status, message=message)

    def run(self):
        try:
            if self.git('symbolic-ref', '--short', 'HEAD') != 'main':
                raise ValueError('Switch the checkout to main before updating.')
            if self.git('status', '--porcelain'):
                raise ValueError('Local changes found. Save or resolve them before updating; nothing was overwritten.')
            before = self.git('rev-parse', 'HEAD')
            self.git('fetch', '--no-tags', SOURCE, 'refs/heads/main')
            target = self.git('rev-parse', 'FETCH_HEAD')
            if before == target:
                self.set_state('current', 'Home Hub is already up to date.')
                return
            # Reject divergence and local commits; never reset, stash, or force.
            try:
                self.git('merge-base', '--is-ancestor', before, target)
            except subprocess.CalledProcessError:
                raise ValueError('Local history differs from main. Resolve it manually before updating.')
            self.git('merge', '--ff-only', target)
            if self.restart:
                self.set_state('restarting', 'Update installed. Restarting Home Hub; this page will reload.')
                time.sleep(3)
                self.restart()
            else:
                self.set_state('installed', 'Update installed. Restart the backend to load the new code.')
        except ValueError as error:
            self.set_state('failed', str(error))
        except (subprocess.SubprocessError, OSError):
            self.set_state('failed', 'Update failed. Check network, Git and checkout permissions. No forced reset was performed.')
