// Klinika — DonetaMED on-prem seed.
//
// Bootstraps an EMPTY DonetaMED install with the real clinic record
// and the four production users (one per role + the platform admin).
// No patients — the .accdb migration is a separate cutover-day
// procedure (ADR-008).
//
// Contents:
//   1. ICD-10 reference data (visit creation needs it)
//   2. One platform admin (admin@klinika.health)
//   3. One clinic: subdomain `donetamed`, name "DonetaMED"
//      — slug matches the production hostname donetamed.klinika.health
//   4. Three users in that clinic — doctor, receptionist, clinic_admin
//
// Idempotent — every insert uses upsert keyed on a stable natural
// key, so re-running the seed is safe.
//
// Run on the laptop with:
//   docker compose -f infra/compose/docker-compose.donetamed.yml \
//     --env-file /srv/sites/klinika-health/.env \
//     run --rm api ./node_modules/.bin/ts-node \
//     --transpile-only prisma/seed-donetamed.ts

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

// Matches the production hostname donetamed.klinika.health (suffix
// tenancy mode — see CLINIC_HOST_SUFFIX in .env). Keep this stable —
// changing it after the .accdb migration would orphan every visit
// row's tenancy.
const CLINIC_SUBDOMAIN = 'donetamed';
const CLINIC_NAME = 'DonetaMED';
const CLINIC_SHORT_NAME = 'DONETA-MED';

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
      `DonetaMED seed aborted: env var ${name} is missing or shorter than 12 characters. ` +
        `Set it in /srv/sites/klinika-health/.env and re-run.`,
    );
  }
  return value;
}

async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

async function seedClinic(): Promise<string> {
  // Real DonetaMED branding — Dr. Taulant Shala, Prizren, Kosovo
  // (CLAUDE.md §14). Phones and address come from the existing
  // .accdb header; the doctor uploads the real logo + signature
  // through Cilësimet → Stampa after first login.
  const clinic = await prisma.clinic.upsert({
    where: { subdomain: CLINIC_SUBDOMAIN },
    update: {
      name: CLINIC_NAME,
      shortName: CLINIC_SHORT_NAME,
    },
    create: {
      subdomain: CLINIC_SUBDOMAIN,
      name: CLINIC_NAME,
      shortName: CLINIC_SHORT_NAME,
      address: 'Prizren, Kosovo',
      city: 'Prizren',
      phones: ['+383 45 83 00 83', '+383 43 543 123'],
      email: 'info@donetamed.com',
      licenseNumber: 'DONETAMED-001',
      hoursConfig: {
        timezone: 'Europe/Belgrade',
        days: {
          mon: { open: true, start: '10:00', end: '18:00' },
          tue: { open: true, start: '10:00', end: '18:00' },
          wed: { open: true, start: '10:00', end: '18:00' },
          thu: { open: true, start: '10:00', end: '18:00' },
          fri: { open: true, start: '10:00', end: '18:00' },
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
      // logoUrl + signatureUrl are non-null in the schema. The clinic
      // admin uploads real assets through Cilësimet → Stampa.
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
    where: { email: 'admin@klinika.health' },
    update: {},
    create: {
      email: 'admin@klinika.health',
      passwordHash: await hashPassword(password),
      firstName: 'Platform',
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
    where: { email: 'taulant@klinika.health' },
    update: { roles: ['doctor'] },
    create: {
      clinicId,
      email: 'taulant@klinika.health',
      passwordHash: await hashPassword(doctorPassword),
      roles: ['doctor'],
      firstName: 'Taulant',
      lastName: 'Shala',
      title: 'Dr.',
      credential: 'Pediatër',
      signatureUrl: null,
      isActive: true,
    },
  });

  await prisma.user.upsert({
    where: { email: 'albina@klinika.health' },
    update: { roles: ['receptionist'] },
    create: {
      clinicId,
      email: 'albina@klinika.health',
      passwordHash: await hashPassword(receptionistPassword),
      roles: ['receptionist'],
      firstName: 'Albina',
      lastName: 'Recepsioniste',
      title: null,
      credential: null,
      signatureUrl: null,
      isActive: true,
    },
  });

  await prisma.user.upsert({
    where: { email: 'donetamed-admin@klinika.health' },
    update: { roles: ['clinic_admin'] },
    create: {
      clinicId,
      email: 'donetamed-admin@klinika.health',
      passwordHash: await hashPassword(clinicAdminPassword),
      roles: ['clinic_admin'],
      firstName: 'Klinika',
      lastName: 'Admin',
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
  console.log('Seeding Klinika DonetaMED database (empty tenant)...');

  const icd10Count = await seedIcd10();
  // eslint-disable-next-line no-console
  console.log(`  ✓ ICD-10 codes loaded: ${icd10Count}`);

  await seedPlatformAdmin();
  // eslint-disable-next-line no-console
  console.log('  ✓ Platform admin admin@klinika.health');

  const clinicId = await seedClinic();
  // eslint-disable-next-line no-console
  console.log(`  ✓ Clinic ${CLINIC_SUBDOMAIN} (${clinicId})`);

  await seedClinicUsers(clinicId);
  // eslint-disable-next-line no-console
  console.log('  ✓ Clinic users (doctor, receptionist, clinic_admin)');

  // eslint-disable-next-line no-console
  console.log('DonetaMED seed complete. Patient data lands via the .accdb migration tool on cutover day.');
}

main()
  .catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('DonetaMED seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
