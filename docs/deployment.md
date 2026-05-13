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
for f in apps/api/prisma/migrations/manual/*.sql; do
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
