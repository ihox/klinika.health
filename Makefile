COMPOSE := docker compose -f infra/compose/docker-compose.dev.yml --project-directory .

.PHONY: dev stop logs ps db-migrate db-reset db-studio db-seed lint typecheck test test-e2e build clean

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
	$(COMPOSE) exec -T postgres psql -U klinika -d klinika -v ON_ERROR_STOP=1 \
		< apps/api/prisma/migrations/manual/001_rls_indexes_triggers.sql

db-reset:
	$(COMPOSE) exec postgres psql -U klinika -d postgres -c "DROP DATABASE IF EXISTS klinika;"
	$(COMPOSE) exec postgres psql -U klinika -d postgres -c "CREATE DATABASE klinika;"
	$(MAKE) db-migrate

db-studio:
	pnpm --filter @klinika/api exec prisma studio

db-seed:
	pnpm --filter @klinika/api seed

lint:
	pnpm -r lint

typecheck:
	pnpm -r typecheck

test:
	pnpm -r test

test-e2e:
	pnpm --filter @klinika/web test:e2e

build:
	pnpm -r build

clean:
	rm -rf node_modules apps/*/node_modules apps/*/.next apps/*/dist coverage playwright-report test-results
