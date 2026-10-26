# ShepByte observation protocol v1

Status: implemented in Home Hub; simulator included. The real Market Monitor agent is **not implemented**. This contract supersedes earlier design suggestions about device commands for this integration. No pause, refresh, update, broker or trading commands exist in v1.

## Trust and independence

- Configure one HTTPS hub origin and its hub UUID on the device out of band. Copy the UUID from the trusted administrator dashboard. Validate the TLS certificate using the system trust store or a locally provisioned CA. Never accept a newly discovered hub automatically, disable certificate checking, or follow redirects carrying credentials.
- Hub UUID is an identity label, not a cryptographic substitute for verified HTTPS. The certificate authenticates the endpoint; the UUID detects accidental replacement/restoration of another hub database.
- A device stores that origin, UUID and a freshly generated 256-bit token locally with owner-only permissions. Changing hubs requires explicit local removal of its pairing state and a new device ID/token. The old hub pairing should be revoked. Home Hub cannot remotely reset that binding. Binding enforcement on the real device is part of the future agent implementation, demonstrated by the simulator.
- The owner authenticates with a separate high-entropy administrator bearer token, creates a one-use 10-minute invitation, transfers it privately to the intended device, then approves its pending device ID. Pending approval expires after 10 minutes. Device IDs are not reusable, including after rejection/revocation; reset creates a new ID.
- Only SHA-256 hashes of invitations and device tokens are stored. No plaintext tokens are returned by device-list/status APIs. Protect the data folder and administrator token. Restarting with a different admin token rotates administrator access without changing the hub identity or device credentials.
- TLS is mandatory for LAN listeners. Plain HTTP is allowed only on loopback for development. Use a trusted private LAN/VPN; do not expose this small Python server to the public Internet. Network-level resource/rate limiting is not implemented.
- The future agent must run independently from research and trading: a separate worker, short network timeouts, bounded exponential retry with jitter, a bounded durable event outbox, and coalesced latest-only heartbeats. Failure, revocation or a full outbox must never block device operation. No dependency on hub approval for starting Market Monitor itself.
- Device tokens only authorise their own observations and pairing-status reads. No endpoint authorises trades or enables execution. Home Hub never calls the device dashboard or a broker; the dashboard URL is a browser link only.

## Transport and compatibility

JSON over HTTPS, paths `/api/v1/...`, `Content-Type: application/json` for POST. Successful responses use HTTP 200, errors `{ "error": "..." }`: 400 invalid schema, 401 invalid credentials/invitation, 403 unapproved device or forbidden sharing, 404 unsupported endpoint, 409 identity/state/sequence conflict, 413 oversized body. No CORS. Bodies are limited to 32 KiB; event batches to 50. Unknown fields are rejected at every defined object level; never forward raw Market Monitor or broker objects. Breaking schema changes require `/api/v2`; coordinate nonbreaking extensions before sending new fields.

All device endpoints after pairing require:

```http
Authorization: Bearer <device-token>
X-Hub-ID: <pinned-hub-uuid>
```

Administrator endpoints require `Authorization: Bearer <admin-token>`. Do not place secrets in URLs, browser storage, log output or shell history. Admin token lives only in dashboard page memory until reload/lock.

## Pairing and registration

1. `GET /api/v1/info` (public):

```json
{"protocol_version":1,"hub_id":"<hub-uuid>","heartbeat_seconds":30,"offline_after_seconds":90}
```

Compare identity to the operator-provided UUID; never adopt it without verification.

2. Owner: `POST /api/v1/admin/invites`, body `{}`:

```json
{"invitation":"<one-use-secret>","hub_id":"<hub-uuid>","expires_in":600}
```

3. Device: generate and persist its token **before** registration; `POST /api/v1/pairings`:

```json
{
  "protocol_version":1,
  "hub_id":"<hub-uuid>",
  "invitation":"<one-use-secret>",
  "device_id":"market-monitor-unique-uuid",
  "name":"Market Monitor",
  "software_version":"1.0.0",
  "dashboard_url":"https://market-monitor.local:8443",
  "device_token":"<fresh-256-bit-base64url-secret>"
}
```

Response: `{"status":"pending","hub_id":"<hub-uuid>"}`. Invitation consumption and registration are atomic. IDs use 1–80 ASCII letters/digits/underscores/hyphens. Name/version are at most 80 characters. URL is HTTP(S), at most 300 characters, no credentials, query or fragment. Device token and invitation are 43–128 base64url characters; generate with `secrets.token_urlsafe(32)`.

4. Owner verifies ID displayed on the device, then POSTs `{}` to `/api/v1/admin/devices/{id}/approve` (or `/reject`). Response `{"status":"approved"}`. Later `/revoke` immediately blocks further reports and clears live readings.

5. Device polls `GET /api/v1/devices/{id}/status`:

```json
{"status":"approved","hub_id":"<hub-uuid>","share_financial":false,"last_sequence":0}
```

Statuses: pending, approved, expired, rejected, revoked. Status remains readable with the device credential after revocation so the agent can stop retrying. If registration's response is lost, try status using the already-persisted ID/token before requesting another invitation.

## Heartbeat

`POST /api/v1/devices/{id}/heartbeat` every 30 seconds:

```json
{
  "sequence":1,
  "observed_at":"2026-10-26T20:00:00Z",
  "hardware":{
    "cpu_percent":12.5,
    "cpu_temp_c":43.2,
    "ram_used_bytes":240000000,
    "ram_total_bytes":1000000000,
    "storage_used_bytes":5000000000,
    "storage_total_bytes":64000000000,
    "uptime_seconds":3600
  },
  "research":{"state":"completed","last_completed_at":"2026-10-26T19:55:00Z"}
}
```

Response: `{"accepted":true,"hub_id":"<hub-uuid>","share_financial":false}`.

Sequence is a strictly increasing positive signed 64-bit integer, persisted by hub. The agent persists before sending; after a lost response/restart read `last_sequence` and send a new sequence above both local and remote values. Never resend old heartbeat payloads: current telemetry replaces them. No wall-clock dependence for replay protection.

Dates are ISO 8601 with timezone, no more than five minutes in the future. Historical event dates may be old for offline replay. Hardware fields must all be present; unknown sensors are JSON `null`, never invented. CPU percentage 0–100; temperature -50–150°C; other values nonnegative and at most 10^16. Used capacity cannot exceed total. RAM/storage are bytes; uptime seconds. Research state: idle, running, completed, failed, unavailable; last completion nullable. Sample time is shown separately from receipt time.

Only an accepted heartbeat makes a device online. After 90 seconds without one it becomes offline and live readings clear; the server checks every five seconds and on requests. Pairing and events do not keep a device online. Hub restart means offline/unknown until a new heartbeat; no stale snapshot is reloaded. Online/offline transitions are stored when observed; no fabricated disconnect time is generated for hub downtime.

## Financial summaries: two independent opt-ins

Default: the agent does not send a `financial` field, and the hub rejects it. Owner can enable acceptance through Settings or POST `/api/v1/admin/devices/{id}/settings`:

```json
{"share_financial":true}
```

Response echoes the preference. The future Market Monitor agent also needs its own local opt-in, default false. Poll status before assembling a report; include summaries only when **both** permit it. Disabling at the hub clears the visible financial snapshot immediately and rejects future financial reports; handle a 403 race by refreshing status and retrying a fresh heartbeat without summaries. Agent-side disabling should send the next heartbeat without the field. Preferences do not constitute trading consent.

Optional heartbeat field:

```json
"financial":{
  "live":{"currency":"GBP","observed_at":"2026-10-26T20:00:00Z","state":"current","total":"300.00","available":"100.00","invested":"200.00"},
  "practice":{"currency":"GBP","observed_at":"2026-10-26T19:45:00Z","state":"stale","total":"10000.00","available":"4000.00","invested":"6000.00"}
}
```

Both mode keys required; either value can be null. Each non-null value has exactly these six fields. Currency: three uppercase letters. State: current, stale, degraded, unavailable. Monetary values: decimal strings (up to 16 integer and 8 fractional digits), not binary floats. Keep Live and Practice separate; never sum them. Snapshot age and state belong to the original observation, not the heartbeat. No account IDs, holdings, histories, API keys, tokens, raw errors or broker payloads.

## Events / History

`POST /api/v1/devices/{id}/events`:

```json
{"events":[{"event_id":"unique-event-uuid","kind":"research.completed","occurred_at":"2026-10-26T19:55:00Z"}]}
```

Response: `{"accepted":["unique-event-uuid"],"hub_id":"<hub-uuid>"}`. Persist IDs before sending; remove only acknowledged outbox entries. Replay is idempotent per device+event ID; reusing an ID never overwrites original history. All events are validated before the batch is inserted. IDs at most 80 characters. Hub adds its own UTC `received_at` and cursor. Events cannot include free text or arbitrary metadata, avoiding accidental broker/credential/error leakage. Codes:

- `research.completed`, `research.failed`
- `warning.cpu_hot`, `warning.ram_high`, `warning.storage_high`, `warning.data_stale`
- `service.started`, `service.failed`

Hub-generated history additionally includes pairing.requested/approved/rejected/revoked, sharing.enabled/disabled and device.online/offline. Pending expiration appears in device status. V1 deliberately excludes trade/deposit events and detailed research reports.

## Owner views and storage

`GET /api/v1/admin/devices` returns `{"devices":[...]}`. Each device includes device_id, name, software_version, dashboard_url, status, share_financial, online, last_seen (Unix seconds or null), snapshot (last heartbeat or null).

`GET /api/v1/admin/devices/{id}/history` returns `{"events":[...]}` with cursor, event_id, kind, occurred_at, received_at. Latest 200, newest first. Older events remain in SQLite; pagination and retention policy are not implemented in v1. Back up data directory securely when server is stopped; restoring an old database can roll back sequence/dedup state, so revoke/reset pairings after a rollback restore.

SQLite stores hub identity, invitation hashes, device registration/credential hashes, consent, last sequence and timestamped events. Live hardware/research/financial snapshots are memory-only. The dashboard offers Overview, History and Settings plus a link to the device dashboard. Changing dashboard URL/name/version requires re-pairing in v1.

## Mapping for the future Market Monitor agent

Inspect existing `market_monitor/hardware.py` readings, research scheduler status and `funds.snapshot('live'|'practice')`; adapt explicitly to the above schema. Read cached summaries without triggering broker refresh. Map only currency, observed_at, state and values.total/available/invested; do not send the complete snapshot. Determine actual hardware keys in the agent implementation. Do not invent a RAM temperature. Research exceptions map to fixed event codes, not exception text.

Acceptance before real deployment: pin trusted origin/certificate/UUID; require owner approval; reboot both ends; stop hub for several minutes while research continues; restore connection and confirm bounded event replay; confirm both sharing switches; revoke; attempt a different hub and verify refusal. Physical Pi performance and certificate setup remain on-device acceptance work.
