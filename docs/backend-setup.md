# Run and test Home Hub

Python 3.9+ standard library only, no pip dependencies. The existing node prototype is preserved at `/prototype/`; the working monitoring dashboard is `/`.

## Local test before the Pi arrives

From the repository root:

```bash
export HOME_HUB_ADMIN_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
python3 -m home_hub.server
```

Keep this shell open. To see the generated admin token locally, `printf '%s\n' "$HOME_HUB_ADMIN_TOKEN"`. Open http://127.0.0.1:8765 and paste it into Unlock dashboard. The environment variable is not printed or saved by the server. Use a password manager or protected environment file to retain it across restarts; changing it rotates admin access.

1. Create pairing invitation in the dashboard. Copy its hub ID and invitation privately.
2. In another terminal run (replace the UUID):

```bash
python3 simulator/market_monitor.py --hub http://127.0.0.1:8765 --hub-id YOUR-HUB-UUID --interval 5
```

3. Paste the invitation at the hidden prompt. Compare the printed simulator device ID with the pending request; approve it in Home Hub.
4. Open the device: Overview shows synthetic CPU/RAM/storage/uptime and research; History receives completion/failure/warning events; Settings defaults to financial sharing disabled.
5. Stop the simulator. After 90–95 seconds the device goes offline and readings clear. Restart the same command using its saved state: no new approval required.
6. Stop Home Hub while simulator runs. Its synthetic workload continues and events queue (maximum 100; oldest dropped when full). Restart Home Hub with the same data directory and admin token; simulator reconnects with bounded backoff and delivers pending events without duplicates. Simulator uses a synchronous synthetic loop; the real agent must use an independent worker so network delays cannot stall actual research/trading.
7. Enable financial acceptance in device Settings and restart simulator with `--share-financial`. Separate invented Live/Practice summaries appear. Turn sharing off: they disappear immediately. These are fake values, never a broker connection.
8. Revoke the device in Settings: reports stop. Re-pair only by explicitly deleting that simulator's state file, creating a new invitation and approving its new ID. Do not reset automatically on connection failure.

The simulator dashboard link points to a placeholder localhost:8080, not a supplied Market Monitor dashboard. It is deliberately labelled SIMULATED. No Market Monitor source changes are included.

## Pi / LAN HTTPS

Default server binds only loopback. For LAN use, provision a certificate covering your chosen hub DNS name/IP and trust its issuing CA on your browser and device. Do not bypass TLS verification. Then:

```bash
python3 -m home_hub.server --host 0.0.0.0 --port 8765 --cert /secure/hub-cert.pem --key /secure/hub-key.pem --data /var/lib/shepbyte-home-hub
python3 simulator/market_monitor.py --hub https://homehub.local:8765 --hub-id YOUR-HUB-UUID --ca /secure/home-ca.pem
```

HTTPS and the hub identity must be verified before entering an invitation. Use your private LAN or private VPN. This version does not provision certificates, discover hubs with mDNS or provide public Internet hosting.

Optional systemd template: `deploy/shepbyte-home-hub.service`. Create a dedicated `homehub` user, install the repository at `/opt/shepbyte-home-hub`, provide the trusted certificate/key and owner-readable `/etc/shepbyte-home-hub/environment` with `HOME_HUB_ADMIN_TOKEN=...`, then adjust paths in the unit before installation. Restrict the environment/key to the service account. Systemd creates the persistent state directory. Do not run the service as root.

## Checks

```bash
python3 -m unittest discover -s tests -v
node --check web/app.js
```

No real hardware/broker is required. Tests exercise the security/state contract and HTTP boundary. Protocol and sample requests: [protocol-v1.md](protocol-v1.md). Do not publish data folders, state files, invitations, certificates' private keys or admin tokens.

## One-button hub updates

The authenticated dashboard's Updates island now has **Update Home Hub**. It fetches only the official repository's `main`, refuses dirty worktrees and divergent history, and never forces a reset. Progress/errors appear in the panel. Device credentials and the database are not changed by the updater. Devices remain independent during the brief restart. This installs repository code, not operating-system packages or Python dependencies; failed application startup still requires manual recovery.

One-time setup for the supplied systemd installation (adjust paths/user if your installation differs):

```sh
sudo chown -R homehub:homehub /opt/shepbyte-home-hub
sudo mkdir -p /etc/systemd/system/shepbyte-home-hub.service.d
sudo cp /opt/shepbyte-home-hub/deploy/updater.conf /etc/systemd/system/shepbyte-home-hub.service.d/updater.conf
sudo systemctl daemon-reload
sudo systemctl restart shepbyte-home-hub
```

Pull this update manually once before installing the drop-in. The service gains write access only to its own checkout in addition to its existing data directory. No sudo command is run from the browser. The service account needs Git installed and network access to GitHub. Keep the checkout on `main` with no local edits. The page reloads after restart; enter your existing admin token again.

A `python3 -m http.server --directory prototype` server cannot perform updates: it serves static files only. Use the backend dashboard with its existing HTTPS/authentication setup. For a manually managed backend, `HOME_HUB_ALLOW_UPDATE=1` enables installation but leaves restart manual; set `HOME_HUB_UPDATE_RESTART=1` only under the restarting systemd service.
