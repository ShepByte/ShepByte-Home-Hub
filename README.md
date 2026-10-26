# ShepByte Home Hub

Local observation hub for independently operating ShepByte devices.

## v0.2 — Market Monitor integration foundation

- Owner-approved pairing with one-use invitations, pinned hub identity, per-device credentials and revocation.
- Registration, replay-protected heartbeats and online/offline detection.
- Overview, History and Settings; hardware and research status; link to each device dashboard.
- Timestamped, deduplicated events in SQLite; live readings remain memory-only.
- Separate optional Live/Practice summaries, disabled by default, requiring consent at both ends.
- No broker credentials, trade authorisation, execution controls or device commands.
- Python standard-library backend and synthetic Market Monitor simulator; original v0.1 node design preserved.

**The actual Market Monitor communication agent remains the next implementation step.** This repository provides the receiving backend, contract and simulator. No Pi or broker is required for development testing.

Start with [setup and simulator walkthrough](docs/backend-setup.md), then [protocol v1 with request/response examples](docs/protocol-v1.md).

```bash
export HOME_HUB_ADMIN_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
python3 -m home_hub.server
```

Open http://127.0.0.1:8765. LAN access requires HTTPS; see setup instructions. Original UI remains at `/prototype/`.

## Structure

| Path | Purpose |
| --- | --- |
| `home_hub/` | Validated API, persistence, authentication and HTTP(S) server |
| `web/` | Working device dashboard |
| `simulator/` | Synthetic Market Monitor with persistent hub binding and event outbox |
| `tests/` | Protocol, security and HTTP checks |
| `deploy/` | Optional systemd unit template |
| `prototype/` | Original v0.1 node concept |
| `docs/` | Current protocol/setup and earlier design notes |

Target: Raspberry Pi OS, Python 3.9+, including the original Pi 2 Model B v1.1. Physical Pi resource usage, mobile layout and trusted certificate provisioning need acceptance checks on the target devices.
