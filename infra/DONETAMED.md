# Klinika DonetaMED on-prem — operational guide

This is the runbook for the **on-premise** DonetaMED install: one Lenovo ThinkBook laptop at the clinic in Prizren, Kosovo. Staging (`klinika-health.ihox.net`, see [STAGING.md](STAGING.md)) and the future production cloud (slice 18c) are separate environments and live in their own runbooks.

The laptop is currently in bring-up (slices 18b.2a / 18b.2b / 18b.2c / 18b.3 / 18b.4 complete). 18b.5 (Orthanc DICOM) and 18b.6 (cutover at the clinic) are the remaining slices before it becomes the live production install. Read **Architecture** first, then **What works today**, then **Day-to-day operations**. The bootstrap procedure under **Initial setup** is a record of how we got here — useful for replicating on a fresh laptop.

---

## Architecture

```
Internet
   │
   └── Cloudflare edge (Vienna PoP) ── donetamed.klinika.health
                                       (klinika.health apex when 18c lands)
   │
   │   Cloudflare Tunnel — outbound QUIC from the laptop, no router
   │   port-forward, no public IP. Tunnel name: donetamed-laptop.
   │
laptop (clinic LAN, WiFi-only today, Ethernet at clinic in 18b.6)
   │  ilir            operator account, NOPASSWD sudo
   │  klinika         system user (uid 997), docker group, nologin shell
   │  github-runner   system user (uid 995), docker + klinika groups, no sudo
   │  cloudflared     process runs as root (apt-installed service)
   │
   └─ /srv/sites/klinika-health/
       ├─ .env                       ← root:klinika 0640, secrets only
       ├─ repo/                      ← donetamed branch (read-only clone
       │                                via /var/lib/klinika/.ssh deploy
       │                                key); kept for ops/reference, the
       │                                auto-deploy uses its own checkout
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

External access: HTTPS via Cloudflare Tunnel only (cloudflared on the
laptop dials out to Cloudflare's edge; nothing is published on the LAN).
The web port is bound to 127.0.0.1; api + postgres have no host port
mapping. SSH (port 22) is allowed only from RFC1918 ranges via UFW.
```

The web container's Next.js process proxies `/api/*` and `/health/*` to `api:3001` via a build-time rewrite. The browser only ever talks to the same origin it loaded the page from, so Cloudflare Tunnel only needs **one upstream**: `127.0.0.1:8003`.

Tenancy runs in **SUFFIX mode** (`CLINIC_HOST_SUFFIX=.klinika.health`) — `klinika.health` is the platform apex and `donetamed.klinika.health` is the tenant. Resolved in two places:

- **API** — [apps/api/src/common/middleware/clinic-resolution.middleware.ts](../apps/api/src/common/middleware/clinic-resolution.middleware.ts)
- **Web** — [apps/web/lib/scope.ts](../apps/web/lib/scope.ts)

The image refs are `ghcr.io/ihox/klinika-{api,web}:donetamed` — built and pushed by `.github/workflows/deploy-donetamed.yml` on every green CI run against the `donetamed` branch. The matching sha-tagged variant (`:donetamed-<sha>`) is pushed alongside for rollback (see [Image rollback](#image-rollback-by-sha-tag)).

---

## What works today (post-18b.4)

- ✅ Klinika stack running on the laptop (postgres + api + web)
- ✅ **External HTTPS via Cloudflare Tunnel** — `https://donetamed.klinika.health` reachable from anywhere
- ✅ **Auto-deploy on push to `donetamed` branch** — CI → build → deploy → smoke test in ~5 min total
- ✅ **Dedicated `:donetamed` image tag** built per-commit, with `:donetamed-<sha>` immutable variants for rollback
- ✅ Tenancy resolution at the edge (Cloudflare Tunnel forwards Host header → api middleware reads subdomain)
- ✅ OS hardening (UFW, fail2ban, key-only SSH, unattended-upgrades)
- ✅ Idempotent seed (clinic + 4 users, no patients)

### Coming up (still future work)

- ⏳ **18b.5** — Orthanc DICOM container + ultrasound modality integration
- ⏳ **18b.6** — Production cutover at the clinic (physical move, ethernet, `.accdb` patient migration, Cloudflare Access for SSH, doctor onboarding)
- ⏳ **Production cloud (18c)** — separate environment for non-DonetaMED tenants

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

# Run the donetamed seed (the seed file is baked into the :donetamed image)
$COMPOSE run --rm api ./node_modules/.bin/ts-node \
  --transpile-only prisma/seed-donetamed.ts

# Bring up the full stack
$COMPOSE up -d
```

Verify `/health/ready`:

```bash
curl -fsS http://localhost:8003/health/ready
# {"status":"ok","db":{"ok":true,"latencyMs":N}}
```

### 18b.3 — Cloudflare Tunnel for external HTTPS

The tunnel terminates at Cloudflare's edge and dials out from the laptop — no public IP, no router port-forward, no inbound rule needed on UFW (which still defaults to deny-incoming). Tunnel created in the Cloudflare Zero Trust dashboard:

- **Tunnel name:** `donetamed-laptop`
- **Public hostname routing:** `donetamed.klinika.health → http://localhost:8003`
- **DNS:** CNAME auto-managed by Cloudflare under the `klinika.health` zone
- **Status:** HEALTHY, 4 outbound QUIC connections to Vienna PoP (`vie02 / vie05 / vie06`)

On the laptop:

- Installed via Cloudflare's official apt repo (`pkg.cloudflare.com/cloudflared`); package name `cloudflared`, version 2026.5.0
- Runs as **root** (no separate `cloudflared` user is created by the package)
- Systemd unit: `/etc/systemd/system/cloudflared.service`, enabled on boot
- **Token storage (hardened beyond Cloudflare's default install):**
  - `/etc/cloudflared/cloudflared.env` mode `0600 root:root`, holds `TUNNEL_TOKEN=…`
  - `/etc/cloudflared/` directory mode `0700 root:root`
  - Unit uses `EnvironmentFile=/etc/cloudflared/cloudflared.env`
  - `ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel run` — **no `--token` flag**; cloudflared reads `TUNNEL_TOKEN` directly from env
  - `ps -ef` and `/proc/<pid>/cmdline` therefore show **no token** at all
  - Cloudflare's default `cloudflared service install <TOKEN>` puts the literal token in `ExecStart` (and on the world-readable unit file); we rewrote it post-install. Worth knowing on a fresh laptop install.

To rotate the token: in Cloudflare Zero Trust → Networks → Tunnels → donetamed-laptop → Refresh Token, then on the laptop:

```bash
sudo systemctl stop cloudflared
echo 'TUNNEL_TOKEN=<new-token>' | sudo tee /etc/cloudflared/cloudflared.env > /dev/null
sudo chmod 0600 /etc/cloudflared/cloudflared.env
sudo systemctl start cloudflared
```

**Known harmless warning** in the journal:

```
ICMP proxy feature is disabled error="cannot create ICMPv4 proxy:
Group ID 0 is not between ping group 1 to 0 ..."
```

This is cloudflared's optional ICMP probe feature — disabled because the cloudflared process's GID (0 = root) isn't in `/proc/sys/net/ipv4/ping_group_range`. Doesn't affect HTTPS tunneling. Ignore.

### 18b.4 — Self-hosted runner + auto-deploy

Auto-deploy on push to `donetamed`: CI → build images → deploy on the laptop → smoke test. Total ~5 min wall-clock.

#### Branch flow

```
feature/*   ─PR→  main       ─auto→  STAGING (Proxmox VM)
                  main       ─manual merge→  donetamed   ─auto→  DONETAMED LAPTOP
                  main       ─(future)→  CLOUD PRODUCTION  (when 18c lands)
```

Only the `infra/compose/docker-compose.donetamed.yml` image-tag change (`:donetamed`) stays on the `donetamed` branch — merging it to `main` would break the staging-vm deploy. Every other change in `donetamed` should be a fast-forward of `main`.

#### Runner

- **System user** `github-runner`, uid 995, home `/opt/actions-runner`
- **Groups:** `github-runner` (primary) + `klinika` (reads `.env`, mode 0640) + `docker` (manages compose). **Not** in `sudo`.
- **Runner version:** v2.334.0 (pinned in install). Update by re-downloading the tarball and re-running `config.sh --replace`.
- **Registered as** `donetamed-laptop` with labels `self-hosted, Linux, X64, donetamed`
- **Systemd unit:** `actions.runner.ihox-klinika.health.donetamed-laptop.service` (enabled on boot)
- **Auth credentials** at `/opt/actions-runner/.credentials` and `.credentials_rsaparams`, scoped to the parent `0750 github-runner:github-runner` directory

To rotate / re-register a runner (e.g. fresh registration token from GitHub UI → Settings → Actions → Runners → New self-hosted runner):

```bash
cd /opt/actions-runner
sudo ./svc.sh stop
sudo -u github-runner ./config.sh remove --token <OLD-REMOVAL-TOKEN-FROM-GITHUB>
echo "<NEW-REGISTRATION-TOKEN>" | sudo -u github-runner ./config.sh \
  --url https://github.com/ihox/klinika.health \
  --token "$(cat -)" \
  --name donetamed-laptop \
  --labels self-hosted,donetamed \
  --work _work \
  --unattended --replace
sudo ./svc.sh start
```

#### Workflow files (location matters)

GitHub's `workflow_run` and `workflow_dispatch` triggers only see workflow files on the **default branch (main)**. So:

- `.github/workflows/deploy-donetamed.yml` lives on **both `main` and `donetamed`** (identical content). The `actions/checkout@v4 with: ref: donetamed` step pulls the donetamed code at build/deploy time.
- `.github/workflows/ci.yml` has `[main, donetamed]` in its push branches (also on both branches).

When you merge `main → donetamed` you don't need to do anything special — both files travel with the merge. When you add a new workflow that should fire on `donetamed`, remember it must also land on `main`.

#### What the deploy job does

The deploy job runs on the laptop as `github-runner` (no sudo). Steps:

1. `actions/checkout@v4 ref: donetamed` into `/opt/actions-runner/_work/...`
2. `docker compose pull` (using the workspace compose + `/srv/sites/klinika-health/.env`)
3. `docker compose run --rm api node node_modules/prisma/build/index.js migrate deploy`
4. `docker compose up -d --remove-orphans`
5. Smoke test `http://localhost:8003/health/ready` (12 attempts × 5s)
6. Smoke test `https://donetamed.klinika.health/health/ready` (exercises the full Cloudflare Tunnel chain)
7. Verify the running api container's image tag starts with `ghcr.io/ihox/klinika-api:donetamed`

If any step fails the deploy job fails red in the Actions UI; the previous container generation keeps running because compose only swaps containers on a successful `up -d`.

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
| `CLINIC_HOST_SUFFIX` | `.klinika.health` | Production suffix mode |
| `JOBS_DISABLED` | `0` | Set to `1` only for one-off CI runs |

The compose file pins image refs to `ghcr.io/ihox/klinika-{api,web}:donetamed` literally — there's no `IMAGE_TAG` env var any more (the 18b.2c contract had one for staging-image reuse; dropped in 18b.4 once dedicated images existed).

---

## Day-to-day operations

All on-laptop commands run as `ilir` with `sudo` from any directory — the compose invocation needs absolute paths to the file and env. Convenience alias for shell sessions:

```bash
alias kc='sudo -u klinika docker compose \
  -f /srv/sites/klinika-health/repo/infra/compose/docker-compose.donetamed.yml \
  --env-file /srv/sites/klinika-health/.env'
```

Then `kc ps`, `kc logs -f api`, `kc restart`, etc.

### Trigger a deploy

Deploys are gated on CI passing. Pushing to `donetamed` triggers the
`CI` workflow first; only when CI completes green does
`deploy-donetamed.yml` fire. If you push with red CI, the laptop
stays on its previous image — no auto-deploy.

To deploy anyway (hot-fix, CI infrastructure issue, or any case
where you've confirmed the red CI is unrelated to the deploy
artifact):

```bash
gh workflow run deploy-donetamed.yml --ref donetamed
```

Manual triggers bypass the CI gate entirely. Use sparingly.

The workflow builds the api + web images on a GitHub-hosted runner, pushes them to GHCR as `:donetamed` and `:donetamed-<sha>`, then hands off to the self-hosted runner on the laptop which pulls, migrates, rolls, and smoke-tests. Total ~5 min wall-clock (first build is closer to 5–8 min cold; subsequent builds ~3–4 min with cache hits).

### Image rollback by SHA tag

Every deploy pushes a `:donetamed-<sha>` immutable tag alongside the mutable `:donetamed`. To pin the laptop to an earlier build:

1. Find the SHA in the GHCR registry or by `git log --oneline donetamed`.
2. Edit `infra/compose/docker-compose.donetamed.yml` to:
   ```yaml
   api:
     image: ghcr.io/ihox/klinika-api:donetamed-<old-sha>
   web:
     image: ghcr.io/ihox/klinika-web:donetamed-<old-sha>
   ```
3. Commit on `donetamed` and push. The deploy workflow will roll the laptop back to those exact images (no rebuild — the tags already exist in GHCR).
4. Once you've fixed forward, swap the lines back to `:donetamed` (mutable) and push again.

Alternative emergency rollback if the deploy workflow itself is broken: SSH into the laptop and edit `/opt/actions-runner/_work/.../docker-compose.donetamed.yml`, then `kc up -d` manually. But you should normally fix forward.

### Manual one-off compose (no CI)

If you need to act on the stack outside of the auto-deploy (e.g. local debugging), the `kc` alias on the laptop runs compose as the `klinika` user using the in-repo file at `/srv/sites/klinika-health/repo/`:

```bash
kc pull
kc up -d
```

This is *separate from* the auto-deploy's workspace at `/opt/actions-runner/_work/...`. Both reach the same containers because compose's project name (`klinika-donetamed`) is in the YAML.

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

# Seed (post-18b.4: seed-donetamed.ts is baked into the :donetamed image)
kc run --rm api ./node_modules/.bin/ts-node --transpile-only prisma/seed-donetamed.ts
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
- **SSH** — key-only auth, no root login, fail2ban watching the sshd journal. UFW limits port 22 to RFC1918 (10/8, 172.16/12, 192.168/16). Once 18b.6 happens, the clinic LAN's WAN-side will not reach port 22 anyway; **Cloudflare Access for SSH** (planned in 18b.6) is the off-LAN management path.
- **Docker** — UFW does NOT see Docker's iptables rules by default. The compose file binds the web port to **127.0.0.1 only**; api + postgres have no host port mapping at all. Cloudflare Tunnel is the only external ingress.
- **Cloudflare Tunnel** — outbound-only QUIC, no inbound rule needed. The tunnel token lives in `/etc/cloudflared/cloudflared.env` mode `0600 root:root`; the systemd unit reads it via `EnvironmentFile`, NOT as a `--token` CLI flag, so the token is **absent from `ps -ef`** and `/proc/<pid>/cmdline`. See [18b.3 — Cloudflare Tunnel](#18b3--cloudflare-tunnel-for-external-https) for the hardening detail.
- **Secrets at rest** — `.env` is `0640 root:klinika`, GHCR config is `0600`, deploy key is `0600 klinika:klinika`, tunnel env file is `0600 root:root`, runner credentials are inside `0750 github-runner:github-runner` dir.
- **GitHub Actions runner** — runs as `github-runner` (uid 995) with `docker` + `klinika` group membership and **no sudo**. The runner has docker-sock access, which is root-equivalent on this host. Treat any compromise of the GitHub repo or the runner credentials as a host-level breach. Runner credentials at `/opt/actions-runner/.credentials*` are scoped behind the `0750` parent dir.
- **Auto-updates** — `unattended-upgrades` installs Ubuntu security + ESM updates automatically. `Automatic-Reboot=false` so an unexpected reboot can't take the clinic off-line mid-day; the admin reboots manually outside 10:00–18:00.

---

## Future phases

| Slice | Adds |
|---|---|
| ✅ 18b.3 | Cloudflare Tunnel for external HTTPS — DONE, see [18b.3 section above](#18b3--cloudflare-tunnel-for-external-https) |
| ✅ 18b.4 | Self-hosted runner + auto-deploy + dedicated `:donetamed` image tag — DONE, see [18b.4 section above](#18b4--self-hosted-runner--auto-deploy) |
| 18b.5 | Orthanc DICOM container, ultrasound modality push, image proxy through the api |
| 18b.6 | Production cutover at the clinic (see checklist below) |

### 18b.6 — Cutover checklist (planned)

The day the laptop physically moves to the clinic and starts serving real patients. Each item below should be a runnable step with no ambiguity by the time we get there.

- [ ] **Static IP on the laptop's Ethernet interface** (currently WiFi-only; clinic LAN gives DHCP today, but a static lease keeps cloudflared / fail2ban / backups consistent across reboots). Configure via `netplan`.
- [ ] **Connect ultrasound to the clinic LAN**, configure its DICOM destination to send to the laptop's static IP on **port 4242** (Orthanc C-STORE port — landed in 18b.5).
- [ ] **Run patient migration** with the fresh `.accdb` exported from the clinic's existing system:
  ```bash
  cd tools/migrate
  python migrate.py --config config.yaml --source ~/PEDIATRIA.accdb --dry-run
  python migrate.py --config config.yaml --source ~/PEDIATRIA.accdb --execute
  ```
  (~11,163 patients + ~220,465 visits per CLAUDE.md §14. Tool runs locally on the laptop, never against staging.)
- [ ] **Cloudflare Access for SSH** so the laptop can be managed from outside the clinic LAN once UFW + RFC1918 restrictions cut off off-LAN SSH. Pattern: a Cloudflare tunnel route for SSH + an Access policy gating it on the operator's Cloudflare identity.
- [ ] **Train Dr. Taulant + Albina** on the live UI. Walk through booking flow, walk-in flow, calendar, vërtetim PDF, password change. Hand over the four `SEED_*_PASSWORD` values (from a password manager, never email).
- [ ] **Operator handover** — the clinic's IT contact gets read-only SSH access via Cloudflare Access, the runbook URL, and an escalation path (Telegram / email) for incidents.
- [ ] **Set the laptop to Auto-power-on on AC restore** in BIOS so a power blip doesn't take the clinic offline waiting for someone to press the button.
- [ ] **Activate `backup.sh`** with the nightly cron at 02:30.
- [ ] **Smoke-test the full path on cutover day** with real DNS, real laptop placement, real internet at the clinic:
  - `curl https://donetamed.klinika.health/health/ready`
  - Log in as Dr. Taulant from a clinic workstation
  - Print a vërtetim, confirm the blank-stamp area is in the right place (CLAUDE.md §1.1)
  - Push an ultrasound image from the modality, confirm it appears in the chart

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
| Public hostnames | Cloudflare DNS for `klinika.health` zone (CNAME auto-managed by the tunnel) |
| TLS termination | Cloudflare edge; the laptop never sees TLS |
| Cloudflare tunnel config | Cloudflare Zero Trust dashboard (tunnel name `donetamed-laptop`); ingress rule `donetamed.klinika.health → http://localhost:8003` |
| Cloudflare tunnel token | `/etc/cloudflared/cloudflared.env` (mode 0600 root:root) |
| cloudflared systemd unit | `/etc/systemd/system/cloudflared.service` |
| Container images | `ghcr.io/ihox/klinika-{api,web}:donetamed` (mutable) + `:donetamed-<sha>` (immutable, for rollback) |
| Compose file (canonical) | [infra/compose/docker-compose.donetamed.yml](compose/docker-compose.donetamed.yml) on the `donetamed` branch |
| Auto-deploy workflow | `.github/workflows/deploy-donetamed.yml` (lives on both `main` and `donetamed`; identical content) |
| Environment + secrets | `/srv/sites/klinika-health/.env` on the laptop only — gitignored |
| Database files | `/srv/sites/klinika-health/postgres_data` (uid 999) |
| Clinic logos + signatures | `/srv/sites/klinika-health/storage` (uid 10001) |
| Repo clone (ops/reference) | `/srv/sites/klinika-health/repo` (donetamed branch, read-only deploy key) |
| Runner work tree | `/opt/actions-runner/_work/klinika.health/klinika.health/` (recreated per job) |
| Runner credentials | `/opt/actions-runner/.credentials*` (scoped behind 0750 parent dir) |
| GHCR pull credentials | `/root/.docker/config.json` + `/var/lib/klinika/.docker/config.json` (mode 0600) |
| Deploy key (private, for git clone) | `/var/lib/klinika/.ssh/id_github_klinika` (mode 0600 klinika:klinika) |
| Seed credentials | `SEED_*_PASSWORD` rows in `.env` on the laptop |
| Backup template | `/srv/sites/klinika-health/backup.sh.example` |

---

## What's NOT here yet (planned)

- Orthanc + DICOM — 18b.5
- `.accdb` patient migration — cutover-day procedure (18b.6)
- Cloudflare Access for SSH — 18b.6 (so the laptop can be SSHed from outside the clinic LAN)
- Static IP / Ethernet on the laptop — 18b.6 (the clinic move)
- Off-site backups (Backblaze B2 via restic) — later slice once credentials are provisioned
- Per-clinic SMTP — configured via Cilësimet → Stampa once the doctor has SMTP credentials
- LUKS / full-disk encryption — accepted v1 risk, reconsider in a later maintenance window
- Production cloud (non-DonetaMED tenants) — separate environment, lands in slice 18c
