// Klinika — Prisma seed script.
//
// Idempotent: every insert uses `upsert` keyed on a stable natural key
// (clinic subdomain, user email, admin email, ICD-10 code) so the seed
// can be re-run safely against an existing database.
//
// Seed contents are derived from CLAUDE.md §14 (DonetaMED, Dr. Taulant
// Shala, Erëblirë Krasniqi). Passwords come from environment variables
// — never hard-coded — so checking out the repo cannot expose admin or
// doctor credentials.
//
// Run with `make db-seed` (which calls `pnpm --filter @klinika/api seed`).

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

interface Icd10Row {
  code: string;
  latinDescription: string;
  chapter: string;
  common: boolean;
}

const prisma = new PrismaClient();

function readEnvOrThrow(name: string): string {
  const value = process.env[name];
  if (!value || value.length < 12) {
    throw new Error(
      `Seed aborted: environment variable ${name} is missing or shorter than 12 characters. ` +
        `Set it in .env (never commit) and re-run.`,
    );
  }
  return value;
}

async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

async function seedClinic(): Promise<string> {
  // DonetaMED — first customer per CLAUDE.md §14.
  const clinic = await prisma.clinic.upsert({
    where: { subdomain: 'donetamed' },
    update: {},
    create: {
      subdomain: 'donetamed',
      name: 'DonetaMED — Ordinanca Pediatrike',
      shortName: 'DonetaMED',
      address: 'Rruga Adem Jashari, p.n.',
      city: 'Prizren',
      phones: ['045 83 00 83', '043 543 123'],
      email: 'info@donetamed.health',
      hoursConfig: {
        timezone: 'Europe/Belgrade',
        days: {
          mon: { open: true, start: '10:00', end: '18:00' },
          tue: { open: true, start: '10:00', end: '18:00' },
          wed: { open: true, start: '10:00', end: '18:00' },
          thu: { open: true, start: '10:00', end: '18:00' },
          fri: { open: true, start: '10:00', end: '18:00' },
          sat: { open: true, start: '10:00', end: '14:00' },
          sun: { open: false },
        },
        durations: [10, 15, 20, 30, 45],
        defaultDuration: 15,
      } satisfies Prisma.InputJsonValue,
      paymentCodes: {
        E: { label: 'Falas', amountCents: 0 },
        A: { label: 'Vizitë standarde', amountCents: 1500 },
        B: { label: 'Vizitë e shkurtër', amountCents: 1000 },
        C: { label: 'Kontroll', amountCents: 500 },
        D: { label: 'Vizitë e gjatë', amountCents: 2000 },
      } satisfies Prisma.InputJsonValue,
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
    where: { email: 'founder@klinika.health' },
    update: {},
    create: {
      email: 'founder@klinika.health',
      passwordHash: await hashPassword(password),
      firstName: 'Klinika',
      lastName: 'Founder',
      isActive: true,
    },
  });
}

async function seedDoctor(clinicId: string): Promise<void> {
  const password = readEnvOrThrow('SEED_DOCTOR_PASSWORD');
  await prisma.user.upsert({
    where: { email: 'taulant.shala@klinika.health' },
    update: {},
    create: {
      clinicId,
      email: 'taulant.shala@klinika.health',
      passwordHash: await hashPassword(password),
      role: 'doctor',
      firstName: 'Taulant',
      lastName: 'Shala',
      title: 'Dr.',
      credential: 'Pediatër',
      signatureUrl: null,
      isActive: true,
    },
  });
}

async function seedReceptionist(clinicId: string): Promise<void> {
  const password = readEnvOrThrow('SEED_RECEPTIONIST_PASSWORD');
  await prisma.user.upsert({
    where: { email: 'ereblire.krasniqi@klinika.health' },
    update: {},
    create: {
      clinicId,
      email: 'ereblire.krasniqi@klinika.health',
      passwordHash: await hashPassword(password),
      role: 'receptionist',
      firstName: 'Erëblirë',
      lastName: 'Krasniqi',
      title: null,
      credential: null,
      signatureUrl: null,
      isActive: true,
    },
  });
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

// Minimal RFC-4180 CSV line parser: handles quoted fields and embedded
// commas. The fixtures file is well-formed; this is defensive enough for
// production WHO datasets that quote descriptions containing commas.
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
  console.log('Seeding Klinika database...');

  const clinicId = await seedClinic();
  // eslint-disable-next-line no-console
  console.log(`  ✓ Clinic donetamed (${clinicId})`);

  await seedPlatformAdmin();
  // eslint-disable-next-line no-console
  console.log('  ✓ Platform admin founder@klinika.health');

  await seedDoctor(clinicId);
  // eslint-disable-next-line no-console
  console.log('  ✓ Doctor taulant.shala@klinika.health');

  await seedReceptionist(clinicId);
  // eslint-disable-next-line no-console
  console.log('  ✓ Receptionist ereblire.krasniqi@klinika.health');

  const icd10Count = await seedIcd10();
  // eslint-disable-next-line no-console
  console.log(`  ✓ ICD-10 codes loaded: ${icd10Count}`);

  // eslint-disable-next-line no-console
  console.log('Seed complete.');
}

main()
  .catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
