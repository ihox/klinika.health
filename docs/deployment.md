# Klinika — Deployment

> Cloud + on-premise deploy procedures. The deployment topology itself
> is documented in [ADR-002](decisions/002-deployment-topology.md). This
> file is the operational playbook.

## Table of contents

1. [Environments](#environments)
2. [Provisioning a new tenant](#provisioning-a-new-tenant)
3. [Suspending a tenant](#suspending-a-tenant)
4. [Cloudflare Access for /admin](#cloudflare-access-for-admin)
5. [Database migrations](#database-migrations)
6. [TLS and DNS](#tls-and-dns)

---

## Environments

| Environment | URL                                | Host                                   |
|-------------|------------------------------------|----------------------------------------|
| Staging     | `klinika.ihox.net`                 | Founder Proxmox + Cloudflare Tunnel    |
| Production  | `*.klinika.health`, `admin.klinika.health` | IONOS VPS (Frankfurt)            |
| On-premise  | `<tenant>.klinika.health`          | Clinic mini-PC + Cloudflare Tunnel     |

Per [ADR-002](decisions/002-deployment-topology.md), the cloud and
on-premise deploys share code but diverge in operational details (TLS,
DICOM colocation, backup destination).

---

## Provisioning a new tenant

End-to-end, from the moment a clinic signs up to the moment their
doctor can log in. **Each step has a manual operator action — there is
no fully-automated provisioning yet.**

### 1. Reserve the subdomain (5 minutes)

A subdomain is a clinic-friendly identifier (`donetamed`,
`aurora-ped`) and the public hostname (`donetamed.klinika.health`).
Before clicking "Create tenant", confirm:

* It matches `^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$` (a-z, 0-9, hyphens, 2–40 chars).
* It is not in the reserved list (see
  [`subdomain-validation.ts`](../apps/api/src/modules/admin/subdomain-validation.ts)):
  `admin`, `www`, `api`, `mail`, `support`, `app`, `status`, `help`,
  `docs`, `static`, `cdn`, `auth`, `login`, `staging`, `test`, `dev`,
  `internal`, `klinika`.

The Klinika admin UI's live availability indicator runs both checks
plus a uniqueness lookup against `clinics.subdomain`.

### 2. Create the tenant in the admin UI (2 minutes)

Sign in at `https://admin.klinika.health/login` with platform admin
credentials, then:

1. Click **Krijo klinikë** on the tenants list, or navigate to
   `/admin/tenants/new`.
2. Fill in the clinic identity (name, short name, subdomain, city,
   address, phones, contact email).
3. Fill in the first clinic admin (first name, last name, email).
4. Submit. The form posts to `POST /api/admin/tenants`, which:
   * Inserts the clinic row with `status='active'`.
   * Generates a 16-character base64url temporary password (Argon2id
     hashed at rest).
   * Creates the initial `clinic_admin` user.
   * Sends the setup email via Resend (subject: *Mirë se erdhe te
     `<name>` · Klinika*).
   * Writes `tenant.created` to `platform_audit_log`.

If anything in step 4 fails, the entire creation rolls back; the admin
sees an Albanian error message and can retry.

### 3. Provision DNS — **manual step**

DNS automation is out of scope for v1. For each new tenant:

#### Cloud-hosted tenant

Add a Cloudflare DNS record:

```
Type:    CNAME (or A, if Cloudflare proxy disabled)
Name:    <subdomain>          # e.g. aurora-ped
Target:  klinika.health       # the IONOS VPS public hostname
Proxy:   ☁ proxied (orange cloud)
TTL:     Auto
```

TLS is handled by Caddy (Let's Encrypt DNS-01 challenge). The first
request from the new subdomain triggers issuance — expect a ~5-minute
cold start. Subsequent requests are immediate.

#### On-premise tenant

Use Cloudflare Tunnel — the on-premise box does **not** open ports to
the public internet.

```
# On the on-premise mini-PC:
cloudflared tunnel login                  # founder runs this once
cloudflared tunnel create <subdomain>
cloudflared tunnel route dns <subdomain> <subdomain>.klinika.health
```

Inside the clinic LAN, split-horizon DNS resolves
`<subdomain>.klinika.health` directly to the local server IP so traffic
never leaves the building. The same hostname over the public internet
goes through the Cloudflare Tunnel.

### 4. Verify (2 minutes)

* Open `https://<subdomain>.klinika.health` — Caddy should serve a
  Klinika login page (not a TLS error, not a 502).
* Open the admin's email inbox, click the **Hyni në klinikën tuaj**
  link, enter the temporary password.
* The clinic admin should be redirected to the `/clinic` setup page
  with a password-change prompt.

### 5. Hand-off (1 minute)

Tell the clinic admin to:

1. Change the temporary password immediately.
2. Add doctors and receptionists from the `Përdoruesit` section.
3. Configure logo and signature uploads (Slice 09).

The platform admin's job ends here. Subsequent user management is
self-service.

---

## Suspending a tenant

Suspension preserves data — it does not delete the clinic. Use for
non-payment, abuse investigations, or pre-deletion 30-day holds.

1. From `/admin/tenants/<id>`, click **Pezullo**. The confirmation
   dialog warns that all users will be blocked from logging in.
2. The API:
   * Flips `clinics.status` to `suspended`.
   * Revokes every active session for the tenant
     (`revoked_reason = 'tenant_suspended'`).
   * Writes `tenant.suspended` to `platform_audit_log`.
3. Subsequent requests to `<subdomain>.klinika.health` return 403 with
   `reason: clinic_suspended`. The web layer redirects users to
   `/suspended` with an Albanian explanation.

To reactivate, click **Aktivizo** on the same detail page. Sessions are
not resurrected — users log in fresh. Trusted-device cookies remain
valid so MFA isn't required on the first post-resume login.

---

## Cloudflare Access for /admin

`admin.klinika.health` is gated by Cloudflare Access in addition to the
in-app admin session + MFA. Configure once per environment:

1. Cloudflare Dashboard → Zero Trust → Access → Applications.
2. **Add an application** → Self-hosted.
3. Hostname: `admin.klinika.health`.
4. Path: `*` (entire host).
5. Identity providers: One-time PIN (email) + GitHub for the founder.
6. Policy: Allow emails matching `*@klinika.health` and an explicit
   list of platform admin emails.

This is a **second layer** of defence. The in-app `AdminAuthGuard` is
the canonical authorization check; Cloudflare Access reduces the
attack surface so an unauthenticated request to
`admin.klinika.health` never reaches the API at all.

Staging (`klinika.ihox.net`) uses a similar Cloudflare Access policy
gated on the founder's email + the customer doctor's email per
[ADR-002](decisions/002-deployment-topology.md).

---

## Database migrations

Two-step deploy:

```bash
# Prisma-generated tables, columns, indexes
pnpm --filter @klinika/api exec prisma migrate deploy

# Klinika-only extras: RLS, triggers, role grants
for f in apps/api/prisma/sql/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

`make db-migrate` wraps both. The manual files are idempotent — they
can re-run on existing databases without errors.

---

## TLS and DNS

Caddy auto-renews Let's Encrypt certificates via DNS-01 challenge.
Caddyfile excerpts live in [`infra/caddy/`](../infra/caddy/). For
on-premise installs the Cloudflare Tunnel terminates TLS at
Cloudflare; the local Caddy serves plain HTTP on the LAN.

---

## Orthanc (DICOM) — on-premise

Required for clinics using ultrasound (DonetaMED's first install
ships with a GE Versana Balance). See
[ADR-009](decisions/009-dicom-storage.md) for the storage decision
and the rationale behind on-prem-only DICOM.

### Hardware prep

1. Provision a dedicated **2TB HDD** mounted at `/mnt/dicom-storage`.
   RAID 1 mirror is recommended (+€80 hardware; not enforced).
2. Verify the disk is reachable from Docker:
   ```
   docker run --rm -v /mnt/dicom-storage:/test alpine df -h /test
   ```
3. Ensure the partition is at least 2TB free. Klinika reports usage
   hourly via the telemetry agent; alerts fire at 80% (warning) and
   95% (critical) per ADR-009.

### Compose stack

[`infra/compose/docker-compose.onprem.yml`](../infra/compose/docker-compose.onprem.yml)
runs the full stack:

```bash
# From the repo root, on the clinic's mini-PC
docker compose -f infra/compose/docker-compose.onprem.yml --env-file .env up -d
```

Orthanc reads its config from
[`infra/compose/orthanc/orthanc-onprem.json`](../infra/compose/orthanc/orthanc-onprem.json).
TLS for the DICOM C-STORE port (`4242`) is **enabled** in the on-prem
config and must be provisioned before the modality can push studies.

### Orthanc TLS material

Klinika does not ship a CA; each clinic uses an internal CA whose
certificate is loaded onto the ultrasound modality at install time.

```bash
# On the mini-PC, as root:
sudo mkdir -p /etc/orthanc/tls
sudo cp orthanc.crt /etc/orthanc/tls/orthanc.crt
sudo cp orthanc.key /etc/orthanc/tls/orthanc.key
sudo cp ca.crt      /etc/orthanc/tls/trusted.crt
sudo chmod 0600 /etc/orthanc/tls/orthanc.key
sudo chown root:root /etc/orthanc/tls/*
```

The compose file bind-mounts `/etc/orthanc/tls` read-only into the
Orthanc container.

### Modality allowlist

`orthanc-onprem.json` sets `DicomCheckCalledAet: true`. Add each
ultrasound by AET in the `DicomModalities` map. For the GE Versana:

```jsonc
{
  "DicomModalities": {
    "ge-versana": ["VERSANA1", "192.168.1.50", 104, "GenericTLS"]
  }
}
```

Restart Orthanc after every modality-list change:
`docker compose restart orthanc`.

### Webhook secret + image proxy

The on-stored Lua hook
([`infra/compose/orthanc/on-stored.lua`](../infra/compose/orthanc/on-stored.lua))
POSTs every received instance to Klinika's internal endpoint. The
shared secret lives in `.env`:

```
ORTHANC_USERNAME=klinika
ORTHANC_PASSWORD=<long random>
ORTHANC_WEBHOOK_SECRET=<long random>
ORTHANC_URL=http://orthanc:8042
```

`ORTHANC_PASSWORD` and `ORTHANC_WEBHOOK_SECRET` are rotated
quarterly per the runbook. Klinika authenticates to Orthanc using
the password; Orthanc authenticates to Klinika using the webhook
secret (via `X-Klinika-Orthanc-Secret`, constant-time-compared at
the bridge). Orthanc's REST API is **not** published outside the
Docker network — the browser only ever talks to
`/api/dicom/instances/:id/preview.png` on the same origin as the
chart.

### First-receive smoke test

After bringing the stack up:

```bash
# Verify Klinika sees Orthanc
curl -s -u klinika:$ORTHANC_PASSWORD http://localhost:8042/system | jq .

# Send a test DICOM (storescu from the dcmtk package)
storescu --tls-aware -aec KLINIKA -aet TEST 127.0.0.1 4242 sample.dcm

# Within a few seconds, the bridge should log:
#   "DICOM study indexed" orthancStudyId="…"
docker logs klinika-api 2>&1 | grep "DICOM study indexed"
```

If the bridge does not log the ingest, check:

1. `docker logs klinika-orthanc` for the Lua hook's exit status
2. The webhook URL inside the container resolves to the API
   (`docker exec klinika-orthanc curl -v $ORTHANC_WEBHOOK_URL`)
3. `ORTHANC_WEBHOOK_SECRET` matches on both sides of the link

### Backups

Backblaze B2 backups of `/mnt/dicom-storage` are **mandatory** per
ADR-009. The restic wrapper script is installed at provisioning and
runs nightly. After every successful run it updates
`BACKUP_LAST_SUCCESS_AT` in the API container's env — the telemetry
agent reports it; stale backups raise `backup_failed` alerts on the
platform side.

### Cloud-only installs

For tenants without ultrasound, leave `ORTHANC_URL` unset. The
bridge degrades gracefully:

- `OrthancClient.isConfigured()` returns `false`
- `GET /api/dicom/recent` returns `{ studies: [] }`
- Telemetry reports `orthancDiskBytes: null`
- The chart's Ultrazeri panel still mounts; the empty-state copy
  ("Asnjë studim i lidhur me këtë vizitë.") covers the case.
