# Klinika DonetaMED on-prem — operational guide

This is the runbook for the **on-premise** DonetaMED install: one Lenovo ThinkBook laptop at the clinic in Prizren, Kosovo. Staging (`klinika-health.ihox.net`, see [STAGING.md](STAGING.md)) and the future production cloud are separate environments and live in their own runbooks.

The laptop is the bring-up environment for Slice 18b. It will become the production install at cutover. Read **Architecture** first, then **Initial setup** (one-time per fresh laptop), then **Day-to-day operations**.

---

## Architecture

```
Internet
   │
   ├──[18b.3]── Cloudflare Tunnel ── donetamed.klinika.health
   │                                  klinika.health (apex)
   │
laptop (clinic LAN, WiFi-only today, Ethernet at clinic)
   │  ilir         operator account, NOPASSWD sudo
   │  klinika      system user (uid 997), docker group, nologin shell
   │
   └─ /srv/sites/klinika-health/
       ├─ .env                       ← root:klinika 0640, secrets only
       ├─ repo/                      ← donetamed branch (read-only clone
       │                                via /var/lib/klinika/.ssh deploy
       │                                key)
       ├─ postgres_data/             ← bind mount, chown 999:999
       ├─ storage/                   ← bind mount, chown 10001:10001
       │                                (clinic logos + signatures + DICOM
       │                                metadata once 18b.5 lands)
       └─ backup.sh.example          ← template; copy to backup.sh to
                                       activate

Compose stack (project name `klinika-donetamed`):
   ├─ klinika-donetamed-web        Next.js 15 standalone   :3000 → host 127.0.0.1:8003
   ├─ klinika-donetamed-api        NestJS 10               :3001 (internal only)
   └─ klinika-donetamed-postgres   Postgres 16             :5432 (internal only)

Networks:
   - klinika-donetamed-internal     postgres ↔ api
   - klinika-donetamed-public       api ↔ web

External access during 18b.2c: NONE. The web port is bound to
127.0.0.1 only. SSH (port 22) is allowed from RFC1918 ranges via UFW.
External HTTPS via Cloudflare Tunnel lands in 18b.3.
```

The web container's Next.js process proxies `/api/*` and `/health/*` to `api:3001` via a build-time rewrite. The browser only ever talks to the same origin it loaded the page from, so Cloudflare Tunnel only needs **one upstream**: `127.0.0.1:8003`.

Tenancy runs in **SUFFIX mode** (`CLINIC_HOST_SUFFIX=.klinika.health`) — `klinika.health` is the platform apex and `donetamed.klinika.health` is the tenant. Resolved in two places:

- **API** — [apps/api/src/common/middleware/clinic-resolution.middleware.ts](../apps/api/src/common/middleware/clinic-resolution.middleware.ts)
- **Web** — [apps/web/lib/scope.ts](../apps/web/lib/scope.ts)

The image refs (`ghcr.io/ihox/klinika-{api,web}:staging`) deliberately reuse the staging-built artifacts during 18b bring-up — same code, different env. Slice 18b.4 introduces a dedicated `:donetamed` tag built by the on-prem auto-deploy workflow.

---

## Initial setup (one-time per fresh laptop)

> Already done for the current laptop. This section is a record of what was done plus what to do on a fresh box.

### 18b.2a — OS hardening (Ubuntu 24.04 fresh install)

- UFW active, default deny incoming, RFC1918-only SSH allow rules
- `fail2ban` watching the sshd journal (5 retries / 10m / 1h ban)
- Unattended-upgrades installed; security + ESM origins only;
  `Automatic-Reboot=false` (admin reboots outside clinic hours
  10:00–18:00)
- Timezone `Europe/Belgrade` (Kosovo's IANA zone; `Europe/Pristina`
  doesn't exist in tzdata — same offset and DST regardless)
- SSH hardened: `PasswordAuthentication no`, `PermitRootLogin no`,
  key-only auth, drop-in at
  `/etc/ssh/sshd_config.d/10-klinika-hardening.conf`
- Desktop services trimmed: gnome-remote-desktop, bluetooth,
  ModemManager, cups + cups-browsed disabled (no printers, no
  Bluetooth peripherals, no modems on this laptop)

### 18b.2b — klinika user + Docker + GHCR

- `klinika` system user (uid 997), home `/var/lib/klinika`, shell
  `/usr/sbin/nologin`, in `docker` group, NOT in `sudo`
- Docker Engine 29.x + Compose v5.x from the official Docker apt
  repo
- `postgresql-client-16` for one-off `psql` debugging
- `/srv/sites/klinika-health/{repo,postgres_data,storage}` created
  with the right uids
- GHCR auth at `/root/.docker/config.json` AND
  `/var/lib/klinika/.docker/config.json` (mode 0600)

### 18b.2c — Klinika stack first deploy

#### Filesystem ownership (one-time correction after 18b.2b)

```bash
# Postgres container runs as uid 999, api container as uid 10001
sudo chown -R 999:999   /srv/sites/klinika-health/postgres_data
sudo chown -R 10001:10001 /srv/sites/klinika-health/storage
```

#### Deploy key for git clone

Generated on the laptop as the klinika user:

```bash
sudo install -d -o klinika -g klinika -m 0700 /var/lib/klinika/.ssh
sudo -u klinika HOME=/var/lib/klinika \
  ssh-keygen -t ed25519 \
    -f /var/lib/klinika/.ssh/id_github_klinika \
    -N "" \
    -C "donetamed-laptop-readonly" -q
sudo -u klinika HOME=/var/lib/klinika \
  bash -c "ssh-keyscan -t ed25519,rsa github.com > /var/lib/klinika/.ssh/known_hosts 2>/dev/null"
```

The public key is registered as a **read-only Deploy Key** on the GitHub repo (Settings → Deploy keys → `donetamed-laptop-readonly`). `~klinika/.ssh/config` routes `github.com` through this key with `IdentitiesOnly yes` so no other identity is tried.

To rotate: regenerate with the same `ssh-keygen` command, paste the new pubkey into GitHub Deploy Keys, remove the old key.

#### Clone the repo

```bash
sudo -u klinika HOME=/var/lib/klinika bash <<'EOF'
cd /srv/sites/klinika-health
git clone -b donetamed --single-branch git@github.com:ihox/klinika.health.git repo
EOF
```

#### Generate `.env`

The real `.env` is at `/srv/sites/klinika-health/.env`, mode `0640` `root:klinika`. Bootstrap once with:

```bash
sudo bash <<'EOF'
umask 027
cat > /srv/sites/klinika-health/.env <<INNER
NODE_ENV=production
TZ=Europe/Belgrade
APP_VERSION=donetamed
LOG_LEVEL=info

POSTGRES_DB=klinika
POSTGRES_USER=klinika
POSTGRES_PASSWORD=$(openssl rand -hex 32)

AUTH_SECRET=$(openssl rand -hex 32)
AUTH_TRUSTED_DEVICE_TTL_DAYS=30

CLINIC_HOST_SUFFIX=.klinika.health
CORS_ORIGIN=https://klinika.health

EMAIL_FROM=no-reply@klinika.health
EMAIL_FROM_NAME=Klinika
SMTP_HOST=
SMTP_PORT=587
SMTP_USERNAME=
SMTP_PASSWORD=
RESEND_API_KEY=

SEED_PLATFORM_ADMIN_PASSWORD=$(openssl rand -hex 16)
SEED_DOCTOR_PASSWORD=$(openssl rand -hex 16)
SEED_RECEPTIONIST_PASSWORD=$(openssl rand -hex 16)
SEED_CLINIC_ADMIN_PASSWORD=$(openssl rand -hex 16)

IMAGE_TAG=staging
JOBS_DISABLED=0
INNER
chown root:klinika /srv/sites/klinika-health/.env
chmod 0640 /srv/sites/klinika-health/.env
EOF
```

Retrieve seed passwords once (and only once) into a password manager:

```bash
sudo grep ^SEED_ /srv/sites/klinika-health/.env
```

#### First deploy

```bash
cd /srv/sites/klinika-health/repo
COMPOSE="sudo -u klinika docker compose -f infra/compose/docker-compose.donetamed.yml --env-file /srv/sites/klinika-health/.env"

# Pull images
$COMPOSE pull

# Bring up postgres alone, wait for healthy
$COMPOSE up -d postgres
until docker inspect --format '{{.State.Health.Status}}' \
        klinika-donetamed-postgres | grep -q healthy; do
  sleep 2
done

# Run migrations (direct prisma binary call — see "corepack trap" below)
$COMPOSE run --rm api \
  node node_modules/prisma/build/index.js migrate deploy

# Run the donetamed seed
# (NOTE: while the staging image is in use, the seed file must be
# bind-mounted into the container; once 18b.4 builds dedicated
# :donetamed images, this --volume flag goes away.)
$COMPOSE run --rm \
  --volume /srv/sites/klinika-health/repo/apps/api/prisma/seed-donetamed.ts:/workspace/apps/api/prisma/seed-donetamed.ts:ro \
  api ./node_modules/.bin/ts-node \
  --transpile-only prisma/seed-donetamed.ts

# Bring up the full stack
$COMPOSE up -d
```

Verify `/health/ready`:

```bash
curl -fsS http://localhost:8003/health/ready
# {"status":"ok","db":{"ok":true,"latencyMs":N}}
```

---

## Required env vars

See [`.env.donetamed.example`](../.env.donetamed.example) for the full annotated template. Required (no defaults):

| Var | Notes |
|---|---|
| `POSTGRES_PASSWORD` | ≥32 hex chars, `openssl rand -hex 32` |
| `AUTH_SECRET` | ≥32 hex chars, `openssl rand -hex 32`. Rotating it invalidates every active session. |
| `SEED_PLATFORM_ADMIN_PASSWORD` | ≥12 chars (seed enforces); the seed aborts otherwise |
| `SEED_DOCTOR_PASSWORD` | same |
| `SEED_RECEPTIONIST_PASSWORD` | same |
| `SEED_CLINIC_ADMIN_PASSWORD` | same |

Defaults that should be reviewed before first deploy:

| Var | Default | Notes |
|---|---|---|
| `IMAGE_TAG` | `staging` | Flips to `donetamed` once 18b.4 builds dedicated images |
| `CLINIC_HOST_SUFFIX` | `.klinika.health` | Production suffix mode |
| `JOBS_DISABLED` | `0` | Set to `1` only for one-off CI runs |

---

## Day-to-day operations

All on-laptop commands run as `ilir` with `sudo` from any directory — the compose invocation needs absolute paths to the file and env. Convenience alias for shell sessions:

```bash
alias kc='sudo -u klinika docker compose \
  -f /srv/sites/klinika-health/repo/infra/compose/docker-compose.donetamed.yml \
  --env-file /srv/sites/klinika-health/.env'
```

Then `kc ps`, `kc logs -f api`, `kc restart`, etc.

### Update to a new image tag (manual, pre-18b.4)

```bash
kc pull           # pulls whatever IMAGE_TAG resolves to
kc up -d          # rolls api + web, postgres untouched
```

If migrations need to run, do them first:

```bash
kc run --rm api node node_modules/prisma/build/index.js migrate deploy
kc up -d
```

### Update the laptop's repo clone

The clone is only used for the compose file + the seed bind-mount; the api + web run from GHCR images. Still worth keeping in sync:

```bash
sudo -u klinika HOME=/var/lib/klinika bash <<'EOF'
cd /srv/sites/klinika-health/repo
git fetch
git checkout donetamed
git pull --ff-only
EOF
```

### View logs

```bash
kc logs -f --tail=200
# or, single service
kc logs -f api
```

### Service status

```bash
kc ps
```

### Take the stack offline

```bash
kc down
```

Bind-mounted data (`postgres_data/`, `storage/`) survives `down`. Bringing it back up with `kc up -d` resumes from the same state.

### Reset the laptop to empty

Destructive — only use if you're sure.

```bash
kc down
sudo rm -rf /srv/sites/klinika-health/{postgres_data,storage}/*
# uids must be restored after a wipe
sudo chown -R 999:999    /srv/sites/klinika-health/postgres_data
sudo chown -R 10001:10001 /srv/sites/klinika-health/storage
# Then re-run the bring-up sequence (migrate + seed + up)
```

### One-off psql

The postgres container has no host-port mapping — use `docker exec`:

```bash
sudo -u klinika docker exec -it klinika-donetamed-postgres \
  psql -U klinika klinika
```

---

## Backup procedure

Template at [`/srv/sites/klinika-health/backup.sh.example`](file:///srv/sites/klinika-health/backup.sh.example). To activate:

```bash
sudo cp /srv/sites/klinika-health/backup.sh.example \
        /srv/sites/klinika-health/backup.sh
sudo chmod +x /srv/sites/klinika-health/backup.sh
sudo /srv/sites/klinika-health/backup.sh    # manual run
```

What it captures (each daily archive ~5–500 MB depending on DICOM):
- Postgres dump (`pg_dump -U klinika -d klinika`)
- `/srv/sites/klinika-health/storage` tarball (logos + signatures)
- A copy of `.env` and `docker-compose.donetamed.yml` for disaster recovery

Retention: last 14 days locally. Off-site (Backblaze B2 via restic) is intentionally not in v1 — that lands in a later slice once credentials are provisioned.

To run nightly at 02:30 add to root cron:

```cron
30 2 * * *  /srv/sites/klinika-health/backup.sh >> /var/log/klinika-backup.log 2>&1
```

---

## Troubleshooting

### `/health/ready` 5xxs

- API logs first: `kc logs api --tail 200`. Look for "DB readiness probe failed" or "Schema drift detected."
- Run the schema probe directly on the laptop: `curl http://localhost:8003/health/schema`
- Most often `prisma migrate deploy` succeeded but the api container was still warming up. Wait 10 seconds and re-check.

### `Cannot find matching keyid` from corepack inside the api container

The Node 20.18.x base image ships with corepack signing keys that don't match the npm registry's current keys, so the first invocation of `pnpm` by the non-root `klinika` user inside the container fails. **Always call the prisma / ts-node binaries directly**:

```bash
# Migrations
kc run --rm api node node_modules/prisma/build/index.js migrate deploy

# Seed (with the file bind-mount until 18b.4)
kc run --rm \
  --volume /srv/sites/klinika-health/repo/apps/api/prisma/seed-donetamed.ts:/workspace/apps/api/prisma/seed-donetamed.ts:ro \
  api ./node_modules/.bin/ts-node --transpile-only prisma/seed-donetamed.ts
```

### Port 8003 already in use

```bash
sudo ss -tlnp | grep ':8003'
```

If something else grabbed the port, change the `127.0.0.1:8003:3000` mapping in `infra/compose/docker-compose.donetamed.yml` (and re-pull / re-up). Cloudflare Tunnel in 18b.3 expects 8003 — keep it stable if possible.

### `clinic_not_found` on the tenant subdomain

The seed didn't run, or the subdomain doesn't match. Re-run the donetamed seed (it's idempotent).

### Git pull says "Permission denied (publickey)"

The deploy key was rotated on GitHub but the on-laptop private key wasn't. Regenerate per "Deploy key for git clone" above and update GitHub Deploy Keys.

### Storage permission denied in api logs

The api container runs as uid 10001 but the bind-mounted directory is owned by something else. Fix:

```bash
kc down api
sudo chown -R 10001:10001 /srv/sites/klinika-health/storage
kc up -d api
```

---

## Security notes

- **No disk encryption (accepted risk).** The laptop ships with no LUKS / no full-disk encryption. Physical security responsibility sits at the clinic — locked office during off-hours, the laptop never leaves the premises. Patient data on disk is therefore protected only by Linux permissions; an attacker with physical boot access can read everything. Reconsider once we can dedicate a maintenance window for the LUKS conversion.
- **SSH** — key-only auth, no root login, fail2ban watching the sshd journal. UFW limits port 22 to RFC1918 (10/8, 172.16/12, 192.168/16).
- **Docker** — UFW does NOT see Docker's iptables rules by default. The compose file binds the web port to **127.0.0.1 only**; api + postgres have no host port mapping at all. Cloudflare Tunnel in 18b.3 is the only external ingress.
- **Secrets at rest** — `.env` is `0640 root:klinika`, GHCR config is `0600`. The deploy key is `0600 klinika:klinika`.
- **Auto-updates** — `unattended-upgrades` installs Ubuntu security + ESM updates automatically. `Automatic-Reboot=false` so an unexpected reboot can't take the clinic off-line mid-day; the admin reboots manually outside 10:00–18:00.

---

## Future phases

| Slice | Adds |
|---|---|
| 18b.3 | Cloudflare Tunnel for external HTTPS (donetamed.klinika.health + klinika.health apex) |
| 18b.4 | GitHub Actions self-hosted runner for auto-deploy, dedicated `:donetamed` image tag |
| 18b.5 | Orthanc DICOM container, ultrasound modality push, image proxy through the api |
| 18b.6 | Production cutover at the clinic — physical move, ethernet, `.accdb` migration via `tools/migrate/`, real Dr. Shala onboarding |

---

## Environment notes (current laptop)

- **Hardware** — Lenovo ThinkBook 13s G2 ITL, 16 GiB RAM, 468 GB NVMe, Ubuntu 24.04.4 LTS
- **Timezone** — `Europe/Belgrade` (Kosovo's IANA zone — `Europe/Pristina` doesn't exist in tzdata; same offset and DST rules)
- **Network** — Currently WiFi-only (`wlp0s20f3`). Ethernet at the clinic in 18b.6.
- **Kernel** — `linux-generic-hwe-24.04` rolling stack (currently 6.17). Auto-bumps with HWE point releases.

---

## What lives where

| Concern | Location |
|---|---|
| Tenancy host config | `CLINIC_HOST_SUFFIX` in `.env` (suffix mode) |
| Public hostnames | Cloudflare DNS for `klinika.health` (provisioned in 18b.3) |
| TLS termination | Cloudflare edge (18b.3); the laptop never sees TLS |
| Container images | `ghcr.io/ihox/klinika-{api,web}:${IMAGE_TAG}` (`:staging` today, `:donetamed` from 18b.4) |
| Compose file (canonical) | [infra/compose/docker-compose.donetamed.yml](compose/docker-compose.donetamed.yml) |
| Environment + secrets | `/srv/sites/klinika-health/.env` on the laptop only — gitignored |
| Database files | `/srv/sites/klinika-health/postgres_data` (uid 999) |
| Clinic logos + signatures | `/srv/sites/klinika-health/storage` (uid 10001) |
| Repo clone | `/srv/sites/klinika-health/repo` on the laptop (donetamed branch, read-only deploy key) |
| GHCR pull credentials | `/root/.docker/config.json` + `/var/lib/klinika/.docker/config.json` (mode 0600) |
| Deploy key (private) | `/var/lib/klinika/.ssh/id_github_klinika` (mode 0600 klinika:klinika) |
| Seed credentials | `SEED_*_PASSWORD` rows in `.env` on the laptop |
| Backup template | `/srv/sites/klinika-health/backup.sh.example` |

---

## What's NOT in this slice (deliberately)

- External HTTPS (Cloudflare Tunnel) — 18b.3
- Auto-deploy via self-hosted runner — 18b.4
- Orthanc + DICOM — 18b.5
- `.accdb` patient migration — cutover-day procedure (18b.6)
- Off-site backups — later slice once Backblaze B2 credentials are provisioned
- Dedicated `:donetamed` image tag — 18b.4
- Per-clinic SMTP — configured via Cilësimet → Stampa once the doctor has SMTP credentials
