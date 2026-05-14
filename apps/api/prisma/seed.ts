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
  // Dr. Taulant wears two hats — doctor AND clinic_admin (no separate
  // admin account at DonetaMED). `update` re-asserts roles so existing
  // single-role rows from earlier seeds get the second role on
  // re-seed.
  await prisma.user.upsert({
    where: { email: 'taulant.shala@klinika.health' },
    update: { roles: ['doctor', 'clinic_admin'] },
    create: {
      clinicId,
      email: 'taulant.shala@klinika.health',
      passwordHash: await hashPassword(password),
      roles: ['doctor', 'clinic_admin'],
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
    update: { roles: ['receptionist'] },
    create: {
      clinicId,
      email: 'ereblire.krasniqi@klinika.health',
      passwordHash: await hashPassword(password),
      roles: ['receptionist'],
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

// ---------------------------------------------------------------------------
// Sample clinical fixtures (post-visits-merge: 2026-05-14).
//
// Idempotent via a sentinel — if any patient already exists for the
// clinic, we assume sample data is already in place and skip. This
// keeps `make db-seed` safe to re-run without piling up duplicates.
//
// The fixtures cover both lifecycle ends of the unified `visits` table:
//   - completed visits (clinical content, no `scheduled_for`) so the
//     doctor's home + visit log have rows to render
//   - scheduled visits (the receptionist's calendar view) anchored to
//     today + tomorrow in Europe/Belgrade
//
// All timestamps are anchored to "today" at seed run-time so the
// fixtures land in the same local-day buckets the UI shows.
// ---------------------------------------------------------------------------

async function seedSampleClinical(clinicId: string): Promise<void> {
  const existing = await prisma.patient.count({ where: { clinicId } });
  if (existing > 0) {
    // eslint-disable-next-line no-console
    console.log('  · Sample patients already present — skipping clinical seed');
    return;
  }

  const doctor = await prisma.user.findFirstOrThrow({
    where: { email: 'taulant.shala@klinika.health' },
  });
  const receptionist = await prisma.user.findFirstOrThrow({
    where: { email: 'ereblire.krasniqi@klinika.health' },
  });

  // Patients — three pediatric DOBs spread across age bands so the
  // master-data strip exercises both infants and older children.
  const era = await prisma.patient.create({
    data: {
      clinicId,
      firstName: 'Era',
      lastName: 'Krasniqi',
      dateOfBirth: new Date('2023-08-03'),
      sex: 'f',
      alergjiTjera: 'Penicilinë',
      phone: '044 123 456',
    },
  });
  const dion = await prisma.patient.create({
    data: {
      clinicId,
      firstName: 'Dion',
      lastName: 'Hoxha',
      dateOfBirth: new Date('2024-02-12'),
      sex: 'm',
    },
  });
  const lira = await prisma.patient.create({
    data: {
      clinicId,
      firstName: 'Lira',
      lastName: 'Berisha',
      dateOfBirth: new Date('2019-04-22'),
      sex: 'f',
    },
  });

  // Anchor everything to today in Europe/Belgrade. We pick a deterministic
  // UTC moment from `toLocaleDateString('sv-SE', { timeZone })` and combine
  // with offsets in minutes for each fixture row.
  const todayIso = new Date().toLocaleDateString('sv-SE', {
    timeZone: 'Europe/Belgrade',
  });
  const todayMidnightUtc = new Date(`${todayIso}T00:00:00Z`);
  const tomorrowIso = new Date(todayMidnightUtc.getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10);

  function at(dateIso: string, hh: number, mm: number): Date {
    // Belgrade is UTC+2 in May (CEST). The seed runs once and the
    // resulting TIMESTAMPTZ values are stored in UTC, so we materialise
    // them as `${date}T${hh-2}:${mm}:00Z`. The UI's timezone helper does
    // the inverse on read.
    const utcHour = hh - 2;
    const pad = (n: number): string => String(n).padStart(2, '0');
    return new Date(`${dateIso}T${pad(utcHour)}:${pad(mm)}:00Z`);
  }

  // Two completed clinical visits earlier today — these drive the
  // doctor's visit log + payment stats on the home screen.
  await prisma.visit.create({
    data: {
      clinicId,
      patientId: era.id,
      visitDate: todayMidnightUtc,
      status: 'completed',
      complaint: 'Temperaturë e lehtë dhe kollë e thatë.',
      weightG: 9_400,
      heightCm: 76 as unknown as Prisma.Decimal,
      temperatureC: 37.8 as unknown as Prisma.Decimal,
      paymentCode: 'A',
      examinations: 'Inspekcion: faringe e kuqe. Auskultim normal.',
      prescription: 'Paracetamol sirup 120 mg/5 ml — 2.5 ml çdo 6 orë.',
      createdBy: doctor.id,
      updatedBy: doctor.id,
    },
  });
  await prisma.visit.create({
    data: {
      clinicId,
      patientId: dion.id,
      visitDate: todayMidnightUtc,
      status: 'completed',
      complaint: 'Kontroll i rregullt 6-mujor.',
      weightG: 8_100,
      heightCm: 70 as unknown as Prisma.Decimal,
      paymentCode: 'C',
      examinations: 'Zhvillim i mirë. Reflekse normale.',
      createdBy: doctor.id,
      updatedBy: doctor.id,
    },
  });

  // Scheduled appointments — one later today, two tomorrow morning. The
  // calendar view should render these on the receptionist's screen and
  // the doctor's "next patient" card binds to the soonest upcoming one.
  await prisma.visit.create({
    data: {
      clinicId,
      patientId: lira.id,
      visitDate: todayMidnightUtc,
      scheduledFor: at(todayIso, 16, 0),
      durationMinutes: 20,
      status: 'scheduled',
      createdBy: receptionist.id,
      updatedBy: receptionist.id,
    },
  });
  await prisma.visit.create({
    data: {
      clinicId,
      patientId: era.id,
      visitDate: new Date(`${tomorrowIso}T00:00:00Z`),
      scheduledFor: at(tomorrowIso, 10, 30),
      durationMinutes: 15,
      status: 'scheduled',
      createdBy: receptionist.id,
      updatedBy: receptionist.id,
    },
  });
  await prisma.visit.create({
    data: {
      clinicId,
      patientId: dion.id,
      visitDate: new Date(`${tomorrowIso}T00:00:00Z`),
      scheduledFor: at(tomorrowIso, 11, 0),
      durationMinutes: 15,
      status: 'scheduled',
      createdBy: receptionist.id,
      updatedBy: receptionist.id,
    },
  });
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

  await seedSampleClinical(clinicId);
  // eslint-disable-next-line no-console
  console.log('  ✓ Sample patients + visits');

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
