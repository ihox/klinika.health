// Klinika — staging seed.
//
// Bootstraps an EMPTY staging environment so the founder can log in
// and exercise every role without exposing real patient data. Runs
// only on the staging VM and is invoked manually (never from the
// deploy workflow) — see infra/STAGING.md.
//
// Contents:
//   1. ICD-10 reference data (visit creation needs it)
//   2. One platform admin
//   3. One clinic: subdomain `donetamed`, name "DonetaMED (Staging)"
//      — slug matches the NPM proxy host the operator pre-configured
//   4. Three users in that clinic — doctor, receptionist, clinic_admin
//   5. NO patients, NO visits — staging starts empty by design
//
// Idempotent — every insert uses upsert keyed on a stable natural
// key, so re-running the seed is safe.
//
// Run on the VM with:
//   docker compose -f infra/compose/docker-compose.staging.yml \
//     --env-file .env.staging \
//     run --rm api pnpm seed:staging

import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

import argon2 from 'argon2';
import { Prisma, PrismaClient } from '@prisma/client';

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

const prisma = new PrismaClient();

// Subdomain matches the NPM proxy host the operator pre-configured
// (`klinika-health-donetamed.ihox.net` → 10.2.1.101:8003). Keeping
// the slug stable across staging + production avoids re-pointing
// NPM/DNS later when real-data migration to staging is reconsidered.
const STAGING_SUBDOMAIN = 'donetamed';
const STAGING_CLINIC_NAME = 'DonetaMED (Staging)';

interface Icd10Row {
  code: string;
  latinDescription: string;
  chapter: string;
  common: boolean;
}

function readEnvOrThrow(name: string): string {
  const value = process.env[name];
  if (!value || value.length < 12) {
    throw new Error(
      `Staging seed aborted: env var ${name} is missing or shorter than 12 characters. ` +
        `Set it in /srv/sites/klinika-health/repo/.env.staging and re-run.`,
    );
  }
  return value;
}

async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

async function seedClinic(): Promise<string> {
  // Generic test clinic — deliberately bland so screenshots from
  // staging don't accidentally feature real branding. payment codes
  // mirror the project's canonical E/A/B/C/D structure so the
  // receptionist UI exercises every code.
  const clinic = await prisma.clinic.upsert({
    where: { subdomain: STAGING_SUBDOMAIN },
    update: {
      name: STAGING_CLINIC_NAME,
      shortName: 'DONETA-MED (STG)',
    },
    create: {
      subdomain: STAGING_SUBDOMAIN,
      name: STAGING_CLINIC_NAME,
      shortName: 'DONETA-MED (STG)',
      address: 'Rr. Test 1',
      city: 'Prishtinë',
      phones: ['+383 38 000 000'],
      email: 'info@donetamed-staging.health',
      licenseNumber: 'STAGING-ONLY',
      hoursConfig: {
        timezone: 'Europe/Belgrade',
        days: {
          mon: { open: true, start: '09:00', end: '17:00' },
          tue: { open: true, start: '09:00', end: '17:00' },
          wed: { open: true, start: '09:00', end: '17:00' },
          thu: { open: true, start: '09:00', end: '17:00' },
          fri: { open: true, start: '09:00', end: '17:00' },
          sat: { open: false },
          sun: { open: false },
        },
        durations: [10, 15, 20, 30],
        defaultDuration: 15,
      } satisfies Prisma.InputJsonValue,
      paymentCodes: {
        E: { label: 'Falas', amountCents: 0 },
        A: { label: 'Vizitë standarde', amountCents: 1500 },
        B: { label: 'Vizitë e shkurtër', amountCents: 1000 },
        C: { label: 'Kontroll', amountCents: 500 },
        D: { label: 'Vizitë e gjatë', amountCents: 2000 },
      } satisfies Prisma.InputJsonValue,
      // logoUrl + signatureUrl are non-null in the schema (see
      // prisma/schema.prisma). Placeholder paths land here; the
      // clinic admin uploads real assets through Cilësimet → Stampa.
      logoUrl: '/assets/clinics/donetamed/logo.png',
      signatureUrl: '/assets/clinics/donetamed/signature-blank.png',
      smtpConfig: Prisma.DbNull,
      status: 'active',
    },
  });
  return clinic.id;
}

async function seedPlatformAdmin(): Promise<void> {
  const password = readEnvOrThrow('SEED_PLATFORM_ADMIN_PASSWORD');
  await prisma.platformAdmin.upsert({
    where: { email: 'admin@klinika-health.ihox.net' },
    update: {},
    create: {
      email: 'admin@klinika-health.ihox.net',
      passwordHash: await hashPassword(password),
      firstName: 'Staging',
      lastName: 'Admin',
      isActive: true,
    },
  });
}

async function seedClinicUsers(clinicId: string): Promise<void> {
  const doctorPassword = readEnvOrThrow('SEED_DOCTOR_PASSWORD');
  const receptionistPassword = readEnvOrThrow('SEED_RECEPTIONIST_PASSWORD');
  const clinicAdminPassword = readEnvOrThrow('SEED_CLINIC_ADMIN_PASSWORD');

  await prisma.user.upsert({
    where: { email: 'doctor@klinika-health.ihox.net' },
    update: { roles: ['doctor'] },
    create: {
      clinicId,
      email: 'doctor@klinika-health.ihox.net',
      passwordHash: await hashPassword(doctorPassword),
      roles: ['doctor'],
      firstName: 'Test',
      lastName: 'Doctor',
      title: 'Dr.',
      credential: 'Pediatër',
      signatureUrl: null,
      isActive: true,
    },
  });

  await prisma.user.upsert({
    where: { email: 'receptionist@klinika-health.ihox.net' },
    update: { roles: ['receptionist'] },
    create: {
      clinicId,
      email: 'receptionist@klinika-health.ihox.net',
      passwordHash: await hashPassword(receptionistPassword),
      roles: ['receptionist'],
      firstName: 'Test',
      lastName: 'Receptionist',
      title: null,
      credential: null,
      signatureUrl: null,
      isActive: true,
    },
  });

  await prisma.user.upsert({
    where: { email: 'clinic-admin@klinika-health.ihox.net' },
    update: { roles: ['clinic_admin'] },
    create: {
      clinicId,
      email: 'clinic-admin@klinika-health.ihox.net',
      passwordHash: await hashPassword(clinicAdminPassword),
      roles: ['clinic_admin'],
      firstName: 'Test',
      lastName: 'ClinicAdmin',
      title: null,
      credential: null,
      signatureUrl: null,
      isActive: true,
    },
  });
}

// Minimal RFC-4180 CSV line parser — handles quoted fields with
// embedded commas. The fixture is well-formed; this is defensive
// enough for any future WHO datasets that quote descriptions.
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

async function* readIcd10Csv(path: string): AsyncIterable<Icd10Row> {
  const stream = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let header: string[] | null = null;
  for await (const raw of lines) {
    if (!raw.trim()) continue;
    const fields = parseCsvLine(raw);
    if (!header) {
      header = fields.map((f) => f.trim());
      continue;
    }
    if (fields.length < 4) {
      throw new Error(`Malformed ICD-10 row (expected 4 fields): ${raw}`);
    }
    yield {
      code: fields[0].trim(),
      latinDescription: fields[1].trim(),
      chapter: fields[2].trim(),
      common: fields[3].trim().toLowerCase() === 'true',
    };
  }
}

async function seedIcd10(): Promise<number> {
  const fixturePath = resolve(__dirname, 'fixtures', 'icd10.csv');
  const batch: Icd10Row[] = [];
  let total = 0;

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    await prisma.$transaction(
      batch.map((row) =>
        prisma.icd10Code.upsert({
          where: { code: row.code },
          update: {
            latinDescription: row.latinDescription,
            chapter: row.chapter,
            common: row.common,
          },
          create: row,
        }),
      ),
    );
    total += batch.length;
    batch.length = 0;
  };

  for await (const row of readIcd10Csv(fixturePath)) {
    batch.push(row);
    if (batch.length >= 500) {
      await flush();
    }
  }
  await flush();
  return total;
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('Seeding Klinika STAGING database (empty tenant)...');

  const icd10Count = await seedIcd10();
  // eslint-disable-next-line no-console
  console.log(`  ✓ ICD-10 codes loaded: ${icd10Count}`);

  await seedPlatformAdmin();
  // eslint-disable-next-line no-console
  console.log('  ✓ Platform admin admin@klinika-health.ihox.net');

  const clinicId = await seedClinic();
  // eslint-disable-next-line no-console
  console.log(`  ✓ Clinic ${STAGING_SUBDOMAIN} (${clinicId})`);

  await seedClinicUsers(clinicId);
  // eslint-disable-next-line no-console
  console.log('  ✓ Clinic users (doctor, receptionist, clinic_admin)');

  // eslint-disable-next-line no-console
  console.log('Staging seed complete. No patients seeded by design.');
}

main()
  .catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('Staging seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
