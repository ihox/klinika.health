# Klinika — Operational Runbook

> Living document. Procedures here are concrete; if you find yourself
> writing prose, link to `architecture.md` or an ADR instead.

This runbook covers operational procedures for the platform tenant
(klinika.health) and its installed tenants (cloud-hosted and
on-premise). All steps assume the on-call operator is signed in to the
platform admin app and has Tailscale SSH access (per
[ADR-002](decisions/002-deployment-topology.md)).

---

## Telemetry overview

Every install (cloud-hosted, on-premise, and the platform tenant itself)
runs the telemetry agent. The agent collects host, DB, Orthanc, queue,
and error-rate metadata every 60 seconds and POSTs it to
`https://klinika.health/api/telemetry/heartbeat`. The platform side
stores rows in `telemetry_heartbeats` (90-day retention), evaluates
each one against the rules in [`alert-engine.service.ts`](../apps/api/src/modules/telemetry/alert-engine.service.ts),
and writes derived alerts to `telemetry_alerts`. Critical alerts
notify immediately (email + SMS hook for v1.5); warnings batch into
the 9am daily digest.

Payloads carry **no PHI**. The receiver re-checks payload keys against
the redaction list before persisting; unexpected free-text fields are
dropped. See [`telemetry-collector.service.spec.ts`](../apps/api/src/modules/telemetry/telemetry-collector.service.spec.ts)
and [`heartbeat-receiver.integration.spec.ts`](../apps/api/src/modules/telemetry/heartbeat-receiver.integration.spec.ts)
for the contract enforced in CI.

---

## Tenant offline alert procedure

**Trigger:** Critical alert `tenant_offline` for a single tenant **or**
the grouped `Multi-tenant outage` alert when ≥3 tenants stop reporting
within 5 minutes.

### Single-tenant offline

1. **Confirm the outage.**
   - Open the platform admin "Tenants" view; the affected tenant shows
     `Last heartbeat: NNm ago`.
   - From a clinic-network or VPN: `curl -fsS https://<tenant>.klinika.health/health` —
     a 200 means the API is up and the alert is stale (proceed to "False
     positive" below).
2. **Check Cloudflare Tunnel.**
   - `cloudflared tunnel info <tenant>` (run from the platform server) —
     `inactive` connections suggest the on-premise box is offline.
3. **Page the clinic contact.**
   - Cloud-hosted: skip (Phase 2 VPS is platform-managed).
   - On-premise: use the contact in the `clinics.phones` JSON. For
     DonetaMED that's 045 83 00 83 / 043 543 123. Ask the receptionist
     to verify the mini-PC has power and the network LEDs are lit.
4. **If the box is up but the API isn't responding,** SSH via Tailscale
   and `docker compose -f /opt/klinika/compose/docker-compose.prod.yml ps`.
   Restart the `api` service if needed:
   `docker compose restart api`.
5. **If the DB is down,** check disk first (`df -h /var/lib/postgresql`) —
   most on-premise outages we expect are disk-full caused by Orthanc
   image growth. See "Disk full procedure" below.
6. **Resolve the alert.** When the tenant resumes heartbeats, the next
   `telemetry.offline-sweep` job (every minute) records the recovery
   automatically. To suppress repeat notifications during a known
   outage, insert a row into `telemetry_alerts` with
   `kind='tenant_offline'` and `dedupeKey='tenant_offline:<id>:<window>'`.

### False positive (heartbeat arriving but alert still firing)

1. Check the network path from agent → platform. Common cause: the
   tenant's `TELEMETRY_HEARTBEAT_URL` was set to an internal hostname
   that no longer resolves.
2. SSH into the tenant box and tail the API logs:
   `docker compose logs api --tail=100 | grep heartbeat`.
   Look for `Heartbeat POST failed` warnings — they include the reason
   (network, http, no_url).
3. Fix the env var in `/opt/klinika/.env` and `docker compose restart api`.

### Multi-tenant outage

If the grouped alert fires (3+ tenants offline simultaneously):

1. **Assume platform-side fault first.** Check klinika.health status
   page (Cloudflare dashboard → klinika.health zone → analytics) for
   recent 5xx spikes.
2. Check the VPS:
   - `ssh klinika.health "uptime; systemctl status caddy postgresql"`
   - `curl -fsS https://klinika.health/api/telemetry/heartbeat -I` (expect 405; if connection refused, the API is down)
3. If the platform is up, check Cloudflare's global status — a CF
   incident affecting Tunnels would explain on-premise tenants
   disappearing in lockstep.
4. **Restore order, then per-tenant.** Once the platform is healthy,
   each tenant should re-heartbeat within 60s. If any do not, follow
   the single-tenant procedure for that tenant.

---

## Backup failure procedure

**Trigger:** Critical alert `backup_failed` (last successful restic
run > 30 hours ago) **or** warning alert in the daily digest noting
two consecutive failures.

1. **Inspect the restic wrapper log on the affected install.**
   ```bash
   ssh <tenant> sudo journalctl -u klinika-backup --since '36h ago' -n 200
   ```
   Common failures: B2 credential rotation (auth errors), full B2
   bucket quota, restic repo lock from a crashed previous run.
2. **For lock files left behind by a crash:**
   ```bash
   sudo -u klinika restic -r b2:klinika-<tenant>:/ unlock
   ```
3. **For B2 auth failures,** rotate the application key in the B2 UI,
   update `/opt/klinika/.env.backup` on the install, and trigger a
   manual run: `sudo systemctl start klinika-backup`.
4. **Verify recovery.** On success, the wrapper writes
   `BACKUP_LAST_SUCCESS_AT=<ISO>` to `/opt/klinika/.env.backup`. The
   next heartbeat reads that env var, the alert dedupe window expires
   the next day, and no further alerts fire.
5. **If two failures land before the cause is fixed,** the warning
   alert is promoted to critical by the engine. Don't suppress —
   surface to a second on-call if you are stuck for more than 30
   minutes.

**Never roll back a partial restore on the live volume.** If a
restore is needed, mount the restic repo read-only to a sibling
directory and `pg_restore` from there. See ADR-009 for the DICOM
side of backups.

---

## Disk full procedure

**Trigger:** Critical alert `disk_critical` (>=95%) or warning
`disk_warning` (>=85%). The most common cause is Orthanc image growth.

### Triage

1. SSH to the install and identify the largest consumers:
   ```bash
   sudo du -shx /var/lib/docker/volumes/* | sort -h | tail -10
   ```
2. If the top entry is the `orthanc-storage` volume, proceed to "DICOM
   image growth" below.
3. If the top entry is the `postgres-data` volume, check for runaway
   audit log growth:
   ```bash
   docker compose exec postgres psql -U klinika -c \
     "SELECT pg_size_pretty(pg_total_relation_size('audit_log'));"
   ```
   Audit log should not exceed ~1GB at clinic scale; if it has, escalate
   to engineering (likely a coalescing bug).

### DICOM image growth

Orthanc retains studies indefinitely by default. Pediatric clinics
accumulate ~1GB of ultrasound per quarter. When disk crosses 85%:

1. **Confirm the retention policy applies.** Per ADR-009, studies
   older than 7 years are eligible for archival; younger studies stay
   on the live volume.
2. **Run the archival sweep manually** (later slice will schedule it):
   ```bash
   docker compose exec api pnpm cli orthanc:archive --older-than 7y --dry-run
   docker compose exec api pnpm cli orthanc:archive --older-than 7y --execute
   ```
3. **If no studies are eligible for archival** and the volume is still
   filling, expand the underlying disk:
   - Cloud: resize the VPS volume in the IONOS panel, then
     `sudo resize2fs /dev/sda1` (varies — check the device name).
   - On-premise: physically install the spare 2TB HDD already in the
     mini-PC and move the orthanc-storage volume there. The runbook
     for the physical move lives at `/opt/klinika/docs/disk-expand.md`
     on each on-premise box.
4. **Never delete patient images.** Even soft-deleted DICOM studies
   stay on disk until the archival sweep moves them to cold storage.

### Postgres growing unexpectedly

If `postgres-data` is the culprit and `audit_log` is reasonable, check
for orphaned pgboss state:
```bash
docker compose exec postgres psql -U klinika -c \
  "SELECT pg_size_pretty(pg_total_relation_size('pgboss.job'));"
```
pg-boss archives finished jobs into `pgboss.archive` indefinitely
unless configured otherwise. The default policy runs a 7-day archive,
30-day deletion sweep; tune via `boss.start({ archiveCompletedAfterSeconds, deleteAfterDays })`
if needed.

---

## Quick reference

| Signal | Where | Threshold |
|---|---|---|
| Tenant offline | `telemetry_alerts.kind='tenant_offline'` | No heartbeat for 5 min |
| Disk warning | `disk_warning` | ≥85% |
| Disk critical | `disk_critical` | ≥95% |
| DB down | `db_down` | `dbHealthy=false` on any heartbeat |
| Orthanc down | `orthanc_down` | warning only, doesn't stop the clinic |
| Backup failed | `backup_failed` | Last success > 30h ago |
| Heartbeat retention | `telemetry_heartbeats` | 90 days, pruned daily at 03:30 |

### Common SQL probes

```sql
-- Latest heartbeat per tenant
SELECT tenant_id, MAX(received_at) AS latest
  FROM telemetry_heartbeats
 GROUP BY tenant_id
 ORDER BY latest DESC;

-- Unnotified critical alerts (drives the immediate-notification job)
SELECT * FROM telemetry_alerts
 WHERE severity = 'critical' AND notified_at IS NULL
 ORDER BY created_at DESC;

-- Warning alerts for the 9am digest
SELECT * FROM telemetry_alerts
 WHERE severity = 'warning' AND digested_at IS NULL
 ORDER BY created_at;
```
