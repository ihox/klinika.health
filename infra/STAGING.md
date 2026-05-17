# Klinika staging — operational guide

This is the runbook for the staging environment introduced in Slice 18a. Production cloud (Slice 18c) and DonetaMED on-premise (Slice 18b) are separate environments and live in their own runbooks.

If you're new to this environment, read the **Architecture** section first, then **Initial setup** (one-time), then **Day-to-day operations**.

For the design rationale, see [ADR-018](../docs/decisions/018-staging-via-shared-vm-and-npm.md).

---

## Architecture

```
GitHub Actions runner
   │  1. build api + web images, push to GHCR
   │     - ghcr.io/ihox/klinika-api:staging
   │     - ghcr.io/ihox/klinika-web:staging
   │  2. ssh -p 101 deploy@<vm> klinika-health
   ▼
staging-vm  10.2.1.101  (Ubuntu 24.04, Docker 29, the shared host)
   │
   │  Deploy keypair has command="/usr/local/bin/deploy.sh" in
   │  authorized_keys. The SSH argument ("klinika-health") arrives
   │  in SSH_ORIGINAL_COMMAND. deploy.sh:
   │   - cd /srv/sites/klinika-health
   │   - docker compose pull
   │   - docker compose up -d postgres (wait pg_isready)
   │   - docker compose run --rm api node node_modules/prisma/build/index.js migrate deploy
   │   - docker compose up -d --remove-orphans
   │
   └─ /srv/sites/klinika-health/
       ├─ .env                       ← gitignored, secrets only
       ├─ docker-compose.yml         ← GHCR image refs (mirrored from
       │                                infra/compose/docker-compose.staging.yml)
       ├─ postgres_data/             ← bind mount, chown 999:999
       ├─ storage/                   ← bind mount, chown 10001:10001
       │                                (clinic logos + per-user signatures)
       └─ repo/                      ← optional git clone kept for ops; the
                                       deploy doesn't use it (compose lives
                                       at the site root, not inside repo/)

Compose stack (project name `klinika-staging`):
   ├─ klinika-staging-web        Next.js 15 standalone   :3000 → host 8003
   ├─ klinika-staging-api        NestJS 10               :3001 (internal only)
   └─ klinika-staging-postgres   Postgres 16             :5432 (internal only)

Networks:
   - klinika-staging-internal   postgres ↔ api
   - klinika-staging-public     api ↔ web

Sibling NPM VM on the same LAN proxies the public hostnames to
10.2.1.101:8003. See "NPM proxy host configuration" below.
```

The web container's Next.js process proxies `/api/*` and `/health/*` to `api:3001` via a build-time rewrite (next.config.mjs). The browser only ever talks to the same origin it loaded the page from, so the sibling NPM only needs **one upstream** — port 8003 on this VM.

The tenancy split (apex vs clinic subdomain) is decided in two places, both driven by `CLINIC_HOST_APEX=klinika-health.ihox.net` + `CLINIC_HOST_PREFIX=klinika-health-` (prefix mode; ADR-018). Production keeps the dotted suffix scheme via `CLINIC_HOST_SUFFIX`:

- **API** — [apps/api/src/common/middleware/clinic-resolution.middleware.ts](../apps/api/src/common/middleware/clinic-resolution.middleware.ts)
- **Web** — [apps/web/lib/scope.ts](../apps/web/lib/scope.ts)

The deploy pattern (build in CI, restricted SSH command on the VM) mirrors the existing `tregu-online` and `montelgo` site stacks on the same VM — see `/usr/local/bin/deploy.sh` for the per-slug dispatcher.

---

## Initial setup (one-time per fresh VM)

> Already done for the current VM. This section is a record of what was done plus what to do on a fresh box.

### Prereqs on the VM

- Ubuntu LTS 24.04+ with Docker 24+ and Compose v2
- `deploy` user with `docker` group membership, no sudo
- Operator account (e.g. `ilir`) with NOPASSWD sudo
- `/usr/local/bin/deploy.sh` dispatcher already exists from a sibling site stack
- LAN reachability from the NPM VM
- Internet-routable SSH path to the VM for the GitHub-hosted runner

### Filesystem prep

```bash
# As the operator account
sudo mkdir -p /srv/sites/klinika-health
sudo chown deploy:deploy /srv/sites/klinika-health
sudo -H -u deploy mkdir -p /srv/sites/klinika-health/{postgres_data,storage}
sudo chown -R 999:999 /srv/sites/klinika-health/postgres_data    # postgres:16-alpine runtime uid
sudo chown -R 10001:10001 /srv/sites/klinika-health/storage      # api runtime uid (Dockerfile.api.prod)
```

### Add the klinika-health case to `/usr/local/bin/deploy.sh`

```bash
sudo tee /usr/local/bin/deploy.sh > /dev/null <<'DEPLOY'
#!/usr/bin/env bash
set -euo pipefail
slug="${SSH_ORIGINAL_COMMAND:-}"
case "$slug" in
  tregu-online|montelgo)
    cd "/srv/sites/$slug"
    docker compose pull
    docker compose up -d
    sleep 3
    docker compose exec -T php-fpm kill -USR2 1 || true
    ;;
  klinika-health)
    cd "/srv/sites/$slug"
    docker compose pull
    docker compose up -d postgres
    for i in $(seq 1 15); do
      if docker compose exec -T postgres pg_isready >/dev/null 2>&1; then
        break
      fi
      sleep 2
    done
    # Call the prisma binary directly — corepack/pnpm in the api
    # base image (Node 20.18.x) trips a stale-signing-key error when
    # the non-root user first invokes pnpm.
    docker compose run --rm api node node_modules/prisma/build/index.js migrate deploy
    docker compose up -d --remove-orphans
    ;;
  *) echo "ERROR: invalid slug '$slug'" >&2; exit 1 ;;
esac
echo "deployed $slug at $(date -u +%FT%TZ)"
DEPLOY
sudo chmod 755 /usr/local/bin/deploy.sh
sudo chown root:root /usr/local/bin/deploy.sh
```

### Generate the GitHub Actions deploy key (command-restricted)

```bash
sudo -H -u deploy ssh-keygen -t ed25519 \
    -f /home/deploy/.ssh/github_actions_deploy \
    -N "" \
    -C "github-actions-deploy@klinika-staging" -q

# Append the public key WITH the command="…" restriction so the
# runner can only invoke /usr/local/bin/deploy.sh (matches the
# tregu-online deploy key).
PUBKEY=$(sudo cat /home/deploy/.ssh/github_actions_deploy.pub)
echo "command=\"/usr/local/bin/deploy.sh\",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty,restrict $PUBKEY" \
  | sudo tee -a /home/deploy/.ssh/authorized_keys > /dev/null
sudo chmod 600 /home/deploy/.ssh/authorized_keys
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
```

The **private key** at `/home/deploy/.ssh/github_actions_deploy` goes into the GitHub repo secret `STAGING_SSH_KEY`.

### Place the compose file at the site root

```bash
sudo cp /path/to/repo/infra/compose/docker-compose.staging.yml \
    /srv/sites/klinika-health/docker-compose.yml
sudo chown deploy:deploy /srv/sites/klinika-health/docker-compose.yml
sudo chmod 644 /srv/sites/klinika-health/docker-compose.yml
```

The in-repo file is the canonical reference; the on-VM copy must be hand-synced when the contract changes (no auto-sync in CI).

### Write `.env`

```bash
sudo tee /srv/sites/klinika-health/.env > /dev/null <<ENV
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
# CLINIC_HOST_SUFFIX=.klinika.health  (uncomment to fall back to suffix mode)

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
sudo chown deploy:deploy /srv/sites/klinika-health/.env
sudo chmod 600 /srv/sites/klinika-health/.env
```

**Read back the file once** with `sudo cat` and store the `SEED_*_PASSWORD` values in a password manager — those are the only credentials you'll need at the web UI.

---

## GitHub repo configuration

### Secrets (`Settings → Secrets and variables → Actions → Secrets`)

| Name | Value |
|---|---|
| `STAGING_SSH_KEY` | The contents of `/home/deploy/.ssh/github_actions_deploy` from the VM. Paste the entire multi-line block including the `-----BEGIN/END OPENSSH PRIVATE KEY-----` markers. |

The deploy workflow hardcodes the host (`80.108.9.40`), port (`101`), and user (`deploy`) — they're not sensitive and they don't change per environment.

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

All on-VM commands run as the `deploy` user from `/srv/sites/klinika-health/`. Compose auto-loads `.env` next to `docker-compose.yml`, so the standard `docker compose <command>` works without `-f` or `--env-file` flags.

### Trigger a deploy

Pushing to `main` triggers `deploy-staging.yml` automatically. To re-run manually (e.g. after fixing NPM/DNS):

> Actions → Deploy Staging → Run workflow → main

The workflow builds the api + web images, pushes them to GHCR, then SSHes the dispatcher (`ssh -p 101 deploy@80.108.9.40 klinika-health`) which pulls, migrates, and brings the stack up.

### Run the staging seed (first deploy only)

The deploy workflow does **not** seed by design. After the first successful deploy, SSH in and run:

```bash
sudo -H -u deploy bash -c '
  cd /srv/sites/klinika-health &&
  docker compose run --rm api ./node_modules/.bin/ts-node \
    --transpile-only prisma/seed-staging.ts
'
```

This creates the platform admin + the `donetamed` tenant + three users (doctor / receptionist / clinic_admin). No patients — the staging clinic starts empty by design. The slug matches the NPM proxy host the operator pre-configured (`klinika-health-donetamed.ihox.net`).

The seed is idempotent — re-running is a no-op for existing records.

Login credentials are the `SEED_*_PASSWORD` values from `.env`:

| URL | Email | Password env var |
|---|---|---|
| `https://klinika-health.ihox.net/login` | `admin_staging@klinika.health` | `SEED_PLATFORM_ADMIN_PASSWORD` |
| `https://klinika-health-donetamed.ihox.net/login` | `doctor_staging@klinika.health` | `SEED_DOCTOR_PASSWORD` |
| `https://klinika-health-donetamed.ihox.net/login` | `receptionist_staging@klinika.health` | `SEED_RECEPTIONIST_PASSWORD` |
| `https://klinika-health-donetamed.ihox.net/login` | `clinic-admin_staging@klinika.health` | `SEED_CLINIC_ADMIN_PASSWORD` |

Retrieve the actual passwords with:

```bash
sudo grep '^SEED_' /srv/sites/klinika-health/.env
```

### View logs

```bash
cd /srv/sites/klinika-health
docker compose logs -f --tail=200
# or, single service
docker compose logs -f api
```

### Service status

```bash
cd /srv/sites/klinika-health && docker compose ps
```

### Take staging offline

```bash
cd /srv/sites/klinika-health && docker compose down
```

Bind-mounted data (`postgres_data/`, `storage/`) survives `down`. Bringing it back up with `docker compose up -d` resumes from the same state.

### Reset staging to empty

Destructive — only use if you're sure.

```bash
cd /srv/sites/klinika-health && docker compose down
sudo rm -rf postgres_data/* storage/*
# Postgres + api mounts need their uids back after a wipe
sudo chown -R 999:999 postgres_data
sudo chown -R 10001:10001 storage

# Then trigger a deploy (it'll run prisma migrate deploy on the
# empty DB) and re-run the staging seed.
```

### Run a one-off psql

The postgres container has no host-port mapping — use `docker compose exec`:

```bash
cd /srv/sites/klinika-health
docker compose exec postgres psql -U klinika klinika
```

---

## Troubleshooting

### Deploy workflow fails at "Trigger deploy on staging-vm"

Two common causes:

1. **The SSH key doesn't match.** Compare:
   - `STAGING_SSH_KEY` secret in the GitHub repo (the private key)
   - `/home/deploy/.ssh/github_actions_deploy` on the VM (the matching private key, kept as a backup)
   - The line in `/home/deploy/.ssh/authorized_keys` (the matching public key, `command=…`-restricted)
   
   Regenerate via the "Generate the GitHub Actions deploy key" section if needed.

2. **The dispatcher rejected the slug.** Run `sudo cat /usr/local/bin/deploy.sh` and confirm there's a `klinika-health)` case. If not, re-apply the snippet under "Add the klinika-health case" above.

### Deploy succeeds but `/health/ready` 5xxs

- The api logs are the first stop: `docker compose logs api --tail 200`. Look for "DB readiness probe failed" or "Schema drift detected."
- Run the schema probe directly against web on the VM (works without NPM): `curl http://localhost:8003/health/schema`.
- Most often the `prisma migrate deploy` step succeeded but the api container was still warming up when the workflow checked. Re-trigger the workflow.

### `Cannot find matching keyid` from corepack inside the api container

The Node 20.18.x base image ships with corepack signing keys that don't match the npm registry's current keys, so the first invocation of `pnpm` by the non-root `klinika` user fails. The dispatcher (`deploy.sh`) and the staging seed both avoid pnpm at runtime — call the prisma / ts-node binaries directly:

```bash
# Migrations
docker compose run --rm api node node_modules/prisma/build/index.js migrate deploy

# Seed
docker compose run --rm api ./node_modules/.bin/ts-node --transpile-only prisma/seed-staging.ts
```

### NPM SSL "Cert renewal failed" for the wildcard

Klinika reuses the existing `*.ihox.net` wildcard cert, so the renewal failure mode is the same as any other site stack on the NPM — check the cert's renewal history in NPM and the DNS-01 token for `_acme-challenge.ihox.net`.

### Port 8003 already in use

```bash
sudo ss -tlnp | grep ':8003'
```

If something else (another site stack) grabbed 8003, change the `8003:3000` port mapping in `/srv/sites/klinika-health/docker-compose.yml` (and the in-repo copy) to the next free port AND update the NPM forward port to match. Don't reuse a port from `montelgo` (8002) or `tregu-online` (8001).

### Clinic subdomain returns 404 with `{"reason":"clinic_not_found"}`

The clinic isn't seeded yet. Run the staging seed (see "Run the staging seed" above).

### Apex hits the platform login but a clinic subdomain hits a 404 page

DNS isn't pointing the tenant host at the NPM. Confirm `dig klinika-health-donetamed.ihox.net` resolves to the NPM IP — either via a per-host A record or via the `*.ihox.net` wildcard.

---

## What lives where

| Concern | Location |
|---|---|
| Tenancy host config | `CLINIC_HOST_APEX` + `CLINIC_HOST_PREFIX` env vars in `.env` (prefix mode); `CLINIC_HOST_SUFFIX` available as a commented fallback |
| Public hostnames | NPM (sibling VM) + DNS provider for `ihox.net` |
| TLS termination | NPM (using the `*.ihox.net` wildcard cert) |
| Container images | `ghcr.io/ihox/klinika-{api,web}:staging` (built + pushed by CI) |
| Compose file (canonical) | [infra/compose/docker-compose.staging.yml](compose/docker-compose.staging.yml) in repo |
| Compose file (deployed) | `/srv/sites/klinika-health/docker-compose.yml` on the VM (hand-synced from repo) |
| Environment + secrets | `/srv/sites/klinika-health/.env` on the VM only — gitignored |
| Database files | `/srv/sites/klinika-health/postgres_data` |
| Clinic logos + signatures | `/srv/sites/klinika-health/storage` |
| Deploy dispatcher | `/usr/local/bin/deploy.sh` on the VM (shared with tregu-online, montelgo) |
| Deploy keypair (private) | GitHub secret `STAGING_SSH_KEY` + backup at `/home/deploy/.ssh/github_actions_deploy` on the VM |
| Seed credentials | `SEED_*_PASSWORD` rows in `.env` on the VM |

---

## What's NOT in staging (deliberately)

- Real DonetaMED patient data. Staging starts empty per ADR-018; reintroducing real data would require revisiting the consent picture.
- Orthanc / DICOM. That lives only at the on-premise DonetaMED install (ADR-009).
- Database backups. Slice 18a is bring-up only; backups land in a later slice.
- Monitoring / alerting. Same.
- The migration tool runtime artefacts. The staging VM never runs the Python migration tool.
