import subprocess
import unittest
from unittest.mock import Mock
from home_hub.updater import Updater
from home_hub.core import Error

class UpdateTests(unittest.TestCase):
    def test_disabled(self):
        with self.assertRaises(Error):
            Updater('.').start()

    def test_current(self):
        u = Updater('.', True)
        u.git = Mock(side_effect=['main', '', 'abc', '', 'abc'])
        u.run()
        self.assertEqual(u.status()['status'], 'current')

    def test_dirty_refused(self):
        u = Updater('.', True)
        u.git = Mock(side_effect=['main', ' M web/app.js'])
        u.run()
        self.assertEqual(u.status()['status'], 'failed')
        self.assertEqual(u.git.call_count, 2)

    def test_diverged_refused(self):
        u = Updater('.', True)
        u.git = Mock(side_effect=['main', '', 'abc', '', 'def', subprocess.CalledProcessError(1, 'git')])
        u.run()
        self.assertEqual(u.status()['status'], 'failed')
        self.assertFalse(any(c.args[0] == 'merge' for c in u.git.call_args_list))

    def test_fast_forward(self):
        u = Updater('.', True)
        u.git = Mock(side_effect=['main', '', 'abc', '', 'def', '', ''])
        u.run()
        self.assertEqual(u.status()['status'], 'installed')
        u.git.assert_called_with('merge', '--ff-only', 'def')

    def test_concurrent_refused(self):
        u = Updater('.', True)
        u.state['status'] = 'running'
        with self.assertRaises(Error):
            u.start()
