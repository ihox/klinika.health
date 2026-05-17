# Klinika staging — operational guide

This is the runbook for the staging environment introduced in Slice 18a. Production cloud (Slice 18c) and DonetaMED on-premise (Slice 18b) are separate environments and live in their own runbooks.

If you're new to this environment, read the **Architecture** section first, then **Initial setup** (one-time), then **Day-to-day operations**.

For the design rationale, see [ADR-018](../docs/decisions/018-staging-via-shared-vm-and-npm.md).

---

## Architecture

```
Internet
   │
   ▼
 NPM VM  (sibling on the same Proxmox LAN — runs Nginx Proxy Manager)
   │  forwards: klinika-health.ihox.net + klinika-health-*.ihox.net
   │            → 10.2.1.101:8003
   ▼
 staging-vm  10.2.1.101  (Ubuntu 24.04, Docker 29, the shared host)
   └─ /srv/sites/klinika-health/
       ├─ repo/             ← git checkout, owned by `deploy`
       │   ├─ .env.staging  ← gitignored, secrets only here
       │   └─ infra/compose/docker-compose.staging.yml
       ├─ postgres_data/    ← bind mount, chown 999:999
       └─ storage/          ← bind mount, chown 10001:10001
                              (clinic logos + per-user signatures)

 Compose stack (project name `klinika-staging`):
   ├─ klinika-staging-web        Next.js 15 standalone   :3000 → host 8003
   ├─ klinika-staging-api        NestJS 10               :3001 (internal only)
   └─ klinika-staging-postgres   Postgres 16             :5432 (internal only)

 Two networks:
   - klinika-staging-internal   postgres ↔ api
   - klinika-staging-public     api ↔ web
```

The web container's Next.js process proxies `/api/*` and `/health/*` server-side to `api:3001` (configured via `API_INTERNAL_URL` in compose). The browser only ever talks to the same origin it loaded the page from, so the sibling NPM only needs **one upstream** — port 8003 on this VM.

The tenancy split (apex vs clinic subdomain) is decided in two places, both driven by `CLINIC_HOST_APEX=klinika-health.ihox.net` + `CLINIC_HOST_PREFIX=klinika-health-` (prefix mode; ADR-018). Production keeps the dotted suffix scheme via `CLINIC_HOST_SUFFIX`:

- **API** — [apps/api/src/common/middleware/clinic-resolution.middleware.ts](../apps/api/src/common/middleware/clinic-resolution.middleware.ts)
- **Web** — [apps/web/lib/scope.ts](../apps/web/lib/scope.ts)

---

## Initial setup (one-time per fresh VM)

> Already done for the current VM. This section is a record of what was done plus what to do on a fresh box.

### Prereqs on the VM

- Ubuntu LTS 24.04+ with Docker 24+ and Compose v2
- `deploy` user with `docker` group membership, no sudo, valid `~/.ssh/authorized_keys`
- Operator account (e.g. `ilir`) with NOPASSWD sudo
- LAN reachability from the NPM VM
- Outbound 443 to GitHub for the deploy workflow (`git fetch` over HTTPS)

### Filesystem prep

```bash
# As the operator account
sudo mkdir -p /srv/sites/klinika-health
sudo chown deploy:deploy /srv/sites/klinika-health
sudo -H -u deploy mkdir -p /srv/sites/klinika-health/{postgres_data,storage}
sudo chown -R 999:999 /srv/sites/klinika-health/postgres_data    # postgres:16-alpine runtime uid
sudo chown -R 10001:10001 /srv/sites/klinika-health/storage      # api runtime uid (Dockerfile.api.prod)
```

### Clone the repo as `deploy`

```bash
sudo -H -u deploy git clone https://github.com/ihox/klinika.health.git \
    /srv/sites/klinika-health/repo
```

### Generate the GitHub Actions deploy key

```bash
sudo -H -u deploy ssh-keygen -t ed25519 \
    -f /home/deploy/.ssh/github_actions_deploy \
    -N "" \
    -C "github-actions-deploy@klinika-staging" -q
sudo bash -c 'cat /home/deploy/.ssh/github_actions_deploy.pub >> /home/deploy/.ssh/authorized_keys'
sudo chmod 600 /home/deploy/.ssh/authorized_keys
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
```

The **private key** at `/home/deploy/.ssh/github_actions_deploy` goes into the GitHub repo secret `STAGING_SSH_KEY` (see below). The public key is already authorised on the VM.

### Write `.env.staging`

Generate strong randoms and write the file directly (the values never need to be human-readable except the `SEED_*_PASSWORD`s):

```bash
sudo tee /srv/sites/klinika-health/repo/.env.staging > /dev/null <<ENV
NODE_ENV=production
TZ=Europe/Belgrade
APP_VERSION=staging
LOG_LEVEL=info

POSTGRES_DB=klinika
POSTGRES_USER=klinika
POSTGRES_PASSWORD=$(openssl rand -hex 24)

AUTH_SECRET=$(openssl rand -hex 32)
AUTH_TRUSTED_DEVICE_TTL_DAYS=30

CLINIC_HOST_APEX=klinika-health.ihox.net
CLINIC_HOST_PREFIX=klinika-health-
CLINIC_HOST_SUFFIX=klinika.health
CORS_ORIGIN=https://klinika-health.ihox.net

EMAIL_FROM=no-reply@klinika-health.ihox.net
EMAIL_FROM_NAME=Klinika (staging)
SMTP_HOST=
SMTP_PORT=587
SMTP_USERNAME=
SMTP_PASSWORD=
RESEND_API_KEY=

SEED_PLATFORM_ADMIN_PASSWORD=$(openssl rand -hex 16)
SEED_DOCTOR_PASSWORD=$(openssl rand -hex 16)
SEED_RECEPTIONIST_PASSWORD=$(openssl rand -hex 16)
SEED_CLINIC_ADMIN_PASSWORD=$(openssl rand -hex 16)

JOBS_DISABLED=0
ENV
sudo chown deploy:deploy /srv/sites/klinika-health/repo/.env.staging
sudo chmod 600 /srv/sites/klinika-health/repo/.env.staging
```

Note: heredocs with `$(…)` work fine with `sudo tee`. **Read back the file once** with `sudo cat` and store the `SEED_*_PASSWORD` values in a password manager — those are the only credentials you'll need at the web UI; everything else (AUTH_SECRET, POSTGRES_PASSWORD) lives in the file and on the VM.

---

## GitHub repo configuration

### Secrets (`Settings → Secrets and variables → Actions → Secrets`)

| Name | Value |
|---|---|
| `STAGING_SSH_KEY` | The contents of `/home/deploy/.ssh/github_actions_deploy` from the VM. Paste the entire multi-line block including the `-----BEGIN/END OPENSSH PRIVATE KEY-----` markers. |
| `STAGING_HOST` | The hostname or IP the GitHub-hosted runner uses to SSH in (Tailscale name, public hostname, or LAN-routable IP if the runner shares the LAN). |
| `STAGING_USER` | `deploy` |

### Variables (`Settings → Secrets and variables → Actions → Variables`)

| Name | Value |
|---|---|
| `STAGING_PUBLIC_URL` | `https://klinika-health.ihox.net` — used by the workflow's HTTPS health-check step. Optional; the workflow skips the check if absent. |

---

## NPM proxy host configuration

Done manually in the sibling NPM's web UI. The flat hyphen-joined scheme (ADR-018) means every Klinika host is a level-1 subdomain of `ihox.net` and fits the existing `*.ihox.net` wildcard cert — no DNS-01 challenge or per-host cert issuance required.

Each clinic gets its own proxy host with the SAME forward target. Add one for the apex, plus one per active tenant slug.

**Proxy Host 1 — apex**

| Field | Value |
|---|---|
| Domain Names | `klinika-health.ihox.net` |
| Forward Hostname / IP | `10.2.1.101` |
| Forward Port | `8003` |
| Cache Assets | off |
| Block Common Exploits | on |
| Websockets Support | on |
| SSL — Certificate | The existing `*.ihox.net` wildcard cert |
| Force SSL | on |
| HTTP/2 Support | on |
| HSTS | on (recommended once you've confirmed everything works) |

**Proxy Host 2..N — per clinic slug**

| Field | Value |
|---|---|
| Domain Names | `klinika-health-<slug>.ihox.net` (e.g. `klinika-health-donetamed.ihox.net`) |
| Forward Hostname / IP | `10.2.1.101` |
| Forward Port | `8003` |
| Other settings | identical to Proxy Host 1 (reuse the `*.ihox.net` cert) |

All hosts route to the same Next.js process — Klinika's tenancy middleware handles the apex vs tenant routing internally from the `Host` header (which NPM forwards via `X-Forwarded-Host`).

If you'd rather not add one NPM proxy host per new clinic, you can configure a single `*.ihox.net` proxy host in NPM and let it match every Klinika tenant slug automatically. That makes sense only if no other site stack on the LAN needs to claim a specific `*.ihox.net` host — check with the operator of the sibling NPM before doing it.

---

## DNS configuration

Add to your DNS provider for `ihox.net`. Two equivalent options:

**Option A — per-host A records** (matches the per-clinic NPM proxy hosts above):

| Type | Name | Value |
|---|---|---|
| `A` | `klinika-health` | The public IP of the NPM VM |
| `A` | `klinika-health-donetamed` | The public IP of the NPM VM |
| `A` | `klinika-health-<slug>` | (one per future tenant) |

**Option B — wildcard at `*.ihox.net`** (covers every level-1 subdomain on the same NPM):

| Type | Name | Value |
|---|---|---|
| `A` | `*` | The public IP of the NPM VM |

Most operators already run option B for the wildcard cert — in which case there's nothing to add for Klinika.

---

## Day-to-day operations

### Trigger a deploy

Pushing to `main` triggers `deploy-staging.yml` automatically. To deploy a specific branch or re-run after fixing DNS/NPM, use the GitHub UI:

> Actions → Deploy Staging → Run workflow → main

### Run the staging seed (first deploy only)

The deploy workflow does **not** seed by design. After the first successful deploy, SSH in and run:

```bash
sudo -H -u deploy bash -c '
  cd /srv/sites/klinika-health/repo &&
  docker compose -f infra/compose/docker-compose.staging.yml --env-file .env.staging \
    run --rm api pnpm seed:staging
'
```

This creates the platform admin + the `donetamed` tenant + three users (doctor / receptionist / clinic_admin). No patients — the staging clinic starts empty by design. The slug matches the NPM proxy host the operator pre-configured (`klinika-health-donetamed.ihox.net`).

Login credentials are the `SEED_*_PASSWORD` values from `.env.staging`:

| URL | Email | Password env var |
|---|---|---|
| `https://klinika-health.ihox.net/login` | `admin@klinika-health.ihox.net` | `SEED_PLATFORM_ADMIN_PASSWORD` |
| `https://klinika-health-donetamed.ihox.net/login` | `doctor@klinika-health.ihox.net` | `SEED_DOCTOR_PASSWORD` |
| `https://klinika-health-donetamed.ihox.net/login` | `receptionist@klinika-health.ihox.net` | `SEED_RECEPTIONIST_PASSWORD` |
| `https://klinika-health-donetamed.ihox.net/login` | `clinic-admin@klinika-health.ihox.net` | `SEED_CLINIC_ADMIN_PASSWORD` |

Retrieve the actual passwords with:

```bash
sudo grep '^SEED_' /srv/sites/klinika-health/repo/.env.staging
```

### View logs

```bash
# As deploy
cd /srv/sites/klinika-health/repo
docker compose -f infra/compose/docker-compose.staging.yml --env-file .env.staging logs -f --tail=200

# Single service
docker compose -f infra/compose/docker-compose.staging.yml --env-file .env.staging logs -f api
```

### Service status

```bash
docker compose -f infra/compose/docker-compose.staging.yml --env-file .env.staging ps
```

### Take staging offline

```bash
docker compose -f infra/compose/docker-compose.staging.yml --env-file .env.staging down
```

Bind-mounted data (`postgres_data/`, `storage/`) survives `down`. Bringing it back up with `up -d` resumes from the same state.

### Reset staging to empty

Destructive — only use if you're sure.

```bash
docker compose -f infra/compose/docker-compose.staging.yml --env-file .env.staging down
sudo rm -rf /srv/sites/klinika-health/postgres_data/* /srv/sites/klinika-health/storage/*
# Postgres mount needs the uid back after a wipe
sudo chown -R 999:999 /srv/sites/klinika-health/postgres_data
sudo chown -R 10001:10001 /srv/sites/klinika-health/storage

# Then trigger a deploy (it'll run prisma migrate deploy on the
# empty DB) and re-run the staging seed.
```

### Run a one-off psql

The postgres container has no host-port mapping — use `docker compose exec`:

```bash
docker compose -f infra/compose/docker-compose.staging.yml --env-file .env.staging \
  exec postgres psql -U klinika klinika
```

---

## Troubleshooting

### Deploy workflow fails at "Pull main, build images, …" with permission denied

The deploy keypair isn't authorised. Verify the public key in `/home/deploy/.ssh/authorized_keys` matches what's in the GitHub `STAGING_SSH_KEY` secret (run the keygen step again if unsure).

### Deploy succeeds but `/health/ready` 5xxs

- The api logs are the first stop: `docker compose … logs api --tail=200`. Look for "DB readiness probe failed" or "Schema drift detected."
- Run the schema probe: `curl http://localhost:8003/health/schema` from the VM (works without DNS/NPM). A failing probe identifies which migration didn't apply.
- Most often the `prisma migrate deploy` step succeeded but the api container was still warming up when the workflow checked. Re-trigger the workflow.

### NPM SSL "Cert renewal failed" for the wildcard

Klinika now reuses the existing `*.ihox.net` wildcard cert, so the renewal failure mode is the same as any other site stack on the NPM — check the cert's renewal history in NPM and the DNS-01 token for `_acme-challenge.ihox.net`.

### Port 8003 already in use

```bash
sudo ss -tlnp | grep ':8003'
```

If something else (another site stack) grabbed 8003, change `8003:3000` in `infra/compose/docker-compose.staging.yml` to the next free port AND update the NPM forward port to match. Don't reuse a port from `montelgo` (8002) or `tregu-online` (8001).

### `docker compose build` fails with a Prisma error

The Prisma client postinstall on the deps stage emits a stub when no schema is present — that's expected. The real generate happens in stage 2 (`builder`). If you see "Cannot find module '@prisma/client'" at runtime, the build silently skipped the generate step — try `docker compose build --no-cache api`.

### Clinic subdomain returns 404 with `{"reason":"clinic_not_found"}`

The clinic isn't seeded yet. Run the staging seed (see "Run the staging seed" above).

### Apex hits the platform login but a clinic subdomain hits a 404 page

DNS isn't pointing the tenant host at the NPM. Confirm `dig klinika-health-donetamed.ihox.net` resolves to the NPM IP — either via a per-host A record or via the `*.ihox.net` wildcard.

---

## What lives where

| Concern | Location |
|---|---|
| Tenancy host config | `CLINIC_HOST_APEX` + `CLINIC_HOST_PREFIX` env vars in `.env.staging` (prefix mode); `CLINIC_HOST_SUFFIX` is kept for production parity but unused on staging |
| Public hostnames | NPM (sibling VM) + DNS provider for `ihox.net` |
| TLS termination | NPM |
| Application code | `/srv/sites/klinika-health/repo` on the VM (gitignored `.env.staging` next to it) |
| Database files | `/srv/sites/klinika-health/postgres_data` on the VM |
| Clinic logos + signatures | `/srv/sites/klinika-health/storage` on the VM |
| Deploy keypair (private) | GitHub secret `STAGING_SSH_KEY` + backup at `/home/deploy/.ssh/github_actions_deploy` on the VM |
| Seed credentials | `SEED_*_PASSWORD` rows in `.env.staging` on the VM |

---

## What's NOT in staging (deliberately)

- Real DonetaMED patient data. Staging starts empty per ADR-018; reintroducing real data would require revisiting the consent picture.
- Orthanc / DICOM. That lives only at the on-premise DonetaMED install (ADR-009).
- Database backups. Slice 18a is bring-up only; backups land in a later slice.
- Monitoring / alerting. Same.
- The migration tool runtime artefacts. The staging VM never runs the Python migration tool.
