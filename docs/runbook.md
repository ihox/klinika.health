# Klinika — Operational Runbook

> Living document. Procedures here are concrete; if you find yourself
> writing prose, link to `architecture.md` or an ADR instead.

This runbook covers operational procedures for the platform tenant
(klinika.health) and its installed tenants (cloud-hosted and
on-premise). All steps assume the on-call operator is signed in to the
platform admin app and has Tailscale SSH access (per
[ADR-002](decisions/002-deployment-topology.md)).

---

## Setting up a new clinic

A new tenant is created by a platform admin from the founder console
(see [the admin tenants flow](../apps/web/app/admin/tenants/new/)) and
the clinic admin completes setup from `/cilesimet` on the tenant
subdomain. This section captures the end-to-end procedure.

### 1. Platform admin: create the tenant

1. Sign in to `https://admin.klinika.health` and open **Klinikat → +
   Krijo klinikë**.
2. Fill in the form. The subdomain field live-checks against
   `subdomain-availability` — wait for the ✓ before submitting.
3. Submit. The platform writes the `clinics` row with default
   `hours_config` (Mon–Fri 09:00–17:00, Sat/Sun closed; 10/15/20/30/45
   minute durations) and `payment_codes` (E=€0 Falas, A=€15, B=€10,
   C=€5, D=€20). The endpoint also creates a `clinic_admin` user and
   sends them a setup email with a temporary password.
4. Confirm the audit row was written: in the platform admin console
   open the tenant detail; **Krijuar** lists the action. The
   `platform_audit_log` table has the persisted entry.

The temporary password is **not** stored anywhere after the email
sends. If the recipient loses it, send a password-reset link from
`/admin/tenants/<id>` or use the clinic-side
**Reset fjalëkalimin** action once any clinic admin can sign in.

### 2. Clinic admin: first-login walkthrough

After the clinic admin redeems the temporary password and clears MFA
they land on `/cilesimet` (mapped in [`auth-client.ts`](../apps/web/lib/auth-client.ts)).
The "first day" checklist:

1. **Përgjithshme tab.**
   - Verify name, short name, address, city, phones, contact email.
     Phones accept multi-input (Add / Remove).
   - Upload a **logo** (PNG or SVG, max 2 MB). SVGs are sanitized
     server-side; uploads with `<script>`, event handlers, or
     external URL references are rejected with an Albanian error.
   - Upload a **scanned signature** (PNG, transparent background,
     max 1 MB) for the responsible doctor. Signatures are encrypted
     at rest with `STORAGE_ENCRYPTION_KEY` (AES-256-GCM); the on-disk
     blob is `[12B IV][ciphertext][16B GCM tag]`.
   - Note the prominent reminder: **vula fizike duhet të vendoset
     manualisht në çdo dokument të printuar — vulat digjitale nuk
     janë të lejuara në Kosovë.** Per CLAUDE.md §1.1 we never
     generate, store, or render digital stamps.

2. **Orari dhe terminet tab.**
   - Toggle each weekday open/closed and set a single time range
     (split shifts are intentionally not supported — see
     `clinic-settings.html` notes).
   - Use **"Apliko orarin e së hënës për të gjitha ditët"** to copy
     Monday's range to every other open day.
   - Pick appointment durations (multi-select 10/15/20/30/45/60 min,
     or a custom value 1–120 minutes). The default must be one of
     the selected durations — the dropdown enforces this.
   - Saved as JSONB in `clinics.hours_config`. The schema lives in
     [`clinic-settings.dto.ts`](../apps/api/src/modules/clinic-settings/clinic-settings.dto.ts).

3. **Përdoruesit tab.**
   - Use **Shto staf** to invite doctors and receptionists. The
     backend creates the user with a random base64url password
     (12 bytes) and sends a `user-invite` email with the temporary
     password and login URL.
   - Doctors can have a per-user encrypted signature uploaded from
     the **Edit user** drawer.
   - **Çaktivizo** sets `is_active = false` and revokes every active
     session for that user. Users are never hard-deleted (audit log
     integrity). The last active `clinic_admin` cannot be
     deactivated or demoted — the API returns 400.

4. **Pagesa tab.**
   - Inline-edit code labels and amounts (cents are computed from
     euros). Codes are stable identifiers (E/A/B/C/D); only labels
     and amounts mutate. Adding new codes (F, G, …) is supported but
     rare.
   - Changes apply to **new** visits only; existing visits keep their
     captured amount for financial integrity.

5. **Email tab.**
   - Default sends every transactional email (MFA codes, password
     resets, user invites, etc.) via the platform-wide Resend
     account. Recommended for cloud-hosted tenants.
   - Switching to **Konfiguro SMTP-në tuaj** enables host / port /
     username / password / from name / from address fields. The
     password is encrypted at rest using the same AES-256-GCM key as
     signatures. **Test the connection** before saving: the test
     endpoint dials the configured host, runs AUTH LOGIN, and
     attempts to send a 1-line email to the address typed into
     "Email i testit". Failures surface a structured reason
     (`connect_failed`, `auth_failed`, `tls_failed`, etc.).
   - Both the test and any subsequent SMTP config update write rows
     into `audit_log` (`settings.email.tested`,
     `settings.email.test_failed`, `settings.email.updated`).

6. **Auditimi tab.**
   - Read-only view of every clinic-scoped audit row. Filter by date
     range, user, and action prefix (auth / settings / visits /
     terminet). Expand a row to see field-level diffs.
   - **Eksporto CSV** streams up to 10 000 matching rows as a UTF-8
     CSV with a `Content-Disposition` filename of
     `auditimi-<YYYY-MM-DD>.csv`.

### 3. Storage and key rotation

- Logos and signatures live under `/storage/<clinic_id>/...` on the
  host. The `STORAGE_ROOT` env var overrides the default
  (`<repo>/storage` in dev, `/storage` in containers). The Caddy
  config never exposes this path directly — every read goes through
  the authenticated proxy endpoints (`GET /api/clinic/logo`,
  `GET /api/clinic/signature`, `GET /api/clinic/users/:id/signature`).
- Rotating `STORAGE_ENCRYPTION_KEY` requires re-encrypting every
  signature. There is no in-place re-key in v1; the procedure is:
  1. Schedule a maintenance window.
  2. With the old key still in place, `pnpm cli signatures:dump
     <clinic_id> --to /tmp/sigs` (a follow-up slice will add this).
  3. Swap the key in `.env`.
  4. `pnpm cli signatures:reupload <clinic_id> --from /tmp/sigs` re-
     encrypts with the new key.
  5. `shred /tmp/sigs/*` afterwards.

### 4. Verifying the setup

After completing steps 1–2 the platform admin can spot-check:

```sql
-- Heartbeat received? (5 min after the agent starts)
SELECT tenant_id, received_at FROM telemetry_heartbeats
 WHERE tenant_id = 'aurora-ped' ORDER BY received_at DESC LIMIT 1;

-- Initial audit rows from the first admin login + settings touches
SELECT action, timestamp FROM audit_log
 WHERE clinic_id = '<id>' ORDER BY timestamp DESC LIMIT 20;
```

If the user invite email never arrived, the `Resend dashboard
(klinika.health domain)` will show the delivery — or, when running
locally, the `CapturingEmailSender` inbox in the test setup mirrors
what would have been sent.

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
