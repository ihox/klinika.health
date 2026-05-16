# Load .env from the repo root if present so `make db-migrate`,
# `make db-seed`, and `make test` can run from the host without the
# operator exporting every variable by hand. `-include` is silent if
# .env doesn't exist (e.g. in CI where env vars come from secrets).
-include .env
export

# Host-side DATABASE_URL. The api container in docker-compose connects
# to `postgres:5432` (service hostname); host-side commands like
# `prisma migrate deploy` go through the exposed port at
# `localhost:5432`. Override in .env or the shell for non-default
# setups.
DATABASE_URL ?= postgresql://klinika:klinika@localhost:5432/klinika?schema=public

COMPOSE := docker compose -f infra/compose/docker-compose.dev.yml --project-directory .

.PHONY: dev stop logs ps db-migrate db-reset db-studio db-seed refresh-api lint typecheck test test-migrate test-e2e build clean

dev:
	$(COMPOSE) up -d --build
	@echo ""
	@echo "  web : http://localhost:3000"
	@echo "  api : http://localhost:3001/health"
	@echo "  db  : postgres://klinika:klinika@localhost:5432/klinika"
	@echo "  dcm : http://localhost:8042  (orthanc)"
	@echo ""

stop:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f --tail=200

ps:
	$(COMPOSE) ps

db-migrate:
	pnpm --filter @klinika/api exec prisma migrate deploy
	@for f in apps/api/prisma/sql/*.sql; do \
		echo "applying $$f"; \
		$(COMPOSE) exec -T postgres psql -U klinika -d klinika -v ON_ERROR_STOP=1 < "$$f"; \
	done

db-reset:
	$(COMPOSE) exec postgres psql -U klinika -d postgres -c "DROP DATABASE IF EXISTS klinika;"
	$(COMPOSE) exec postgres psql -U klinika -d postgres -c "CREATE DATABASE klinika;"
	$(MAKE) db-migrate

db-studio:
	pnpm --filter @klinika/api exec prisma studio

db-seed:
	pnpm --filter @klinika/api seed

# Rebuild the api container's node_modules symlinks and regenerate the
# Prisma client. Run after `docker compose up --build`, after editing
# api package.json, or whenever you see "Cannot find module 'puppeteer'"
# or "Property 'Decimal' does not exist on type 'typeof Prisma'" in the
# nest --watch output. Idempotent — safe to run any time.
refresh-api:
	$(COMPOSE) exec api sh -lc 'cd /workspace && pnpm install --filter @klinika/api && cd apps/api && pnpm exec prisma generate'

lint:
	pnpm -r lint

typecheck:
	pnpm -r typecheck

test:
	pnpm -r test

# Python migration-tool tests. Uses tools/migrate/.venv if present;
# otherwise falls back to a system python3.12+. The venv is created on
# first run by `python3.12 -m venv tools/migrate/.venv && \
# tools/migrate/.venv/bin/pip install -r tools/migrate/requirements-dev.txt`.
test-migrate:
	@cd tools/migrate && \
	if [ -x .venv/bin/python ]; then PY=.venv/bin/python; \
	else PY=$$(command -v python3.12 || command -v python3.14 || command -v python3.13); \
	     [ -n "$$PY" ] || { echo "no python3.12+ found"; exit 1; }; \
	fi; \
	"$$PY" -m pytest tests/ -v

test-e2e:
	pnpm --filter @klinika/web test:e2e

build:
	pnpm -r build

clean:
	rm -rf node_modules apps/*/node_modules apps/*/.next apps/*/dist coverage playwright-report test-results
