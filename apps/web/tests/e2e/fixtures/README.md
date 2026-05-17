# E2E test fixtures

Every Playwright spec under `apps/web/tests/e2e/` imports `test` and
`expect` from `./fixtures/auth` instead of `@playwright/test`:

```ts
import { type Page, type Route } from '@playwright/test';

import { expect, test } from './fixtures/auth';
```

The fixture wires the clinic auth endpoints (`/api/auth/me`,
`/api/auth/clinic-identity`) and the connection-status poll
(`/health/ready`) at fixture-setup time. Without it, every clinic
test redirects to `/login` on the first 401 and the suite turns red
regardless of what it's asserting.

## Choosing a role

Default is `doctor`. Override per file with `test.use`:

```ts
test.use({ authState: 'receptionist' });
```

or per describe block:

```ts
test.describe('Receptionist patient search', () => {
  test.use({ authState: 'receptionist' });
  // …
});
```

Supported values:

| `authState`      | Use this when…                                            |
|------------------|-----------------------------------------------------------|
| `doctor`         | Default. Most chart / patient / dashboard flows.          |
| `receptionist`   | `/receptionist`, `/receptionist/pacientet`, booking, etc. |
| `clinic_admin`   | `/cilesimet` and other admin-only clinic surfaces.        |
| `platform_admin` | Apex `/admin` surfaces (rare — see notes below).          |
| `logged-out`     | Tests that exercise the login flow itself.                |

## Logged-out tests

Specs that test the login flow (`auth.spec.ts`, `multi-role.spec.ts`,
`boundary.spec.ts`, `home.spec.ts`, `admin.spec.ts`) opt out so they
can wire their own auth state per test:

```ts
test.use({ authState: 'logged-out' });
```

With `logged-out`, the fixture skips all auth mocks. The spec is
responsible for whatever 401 / 200 / redirect behaviour it needs.

## Overriding the default mocks

Playwright route handlers are LIFO — a `page.route('**/api/auth/me', …)`
inside a test runs before the fixture's handler. Specs that need a
non-default `me` payload (e.g. a doctor who also holds `clinic_admin`)
can still call `page.route(…)` in their `beforeEach` and the fixture
will quietly defer.

## When to add a new mock to the fixture

Add a route here only when it's truly cross-cutting — every
authenticated page hits it (`/api/auth/me`, `/health/ready`). Per-test
domain data (`/api/patients/:id/chart`, `/api/visits/...`,
`/api/admin/...`) stays inside each spec so the contract under test
stays visible at the call site.

## Production code is untouched

The fixture is pure test infrastructure. No `TEST_MODE` backdoor in
`apps/api` or `apps/web` — the production auth flow is exercised
end-to-end by the integration specs in `apps/api/src/modules/auth/`.
