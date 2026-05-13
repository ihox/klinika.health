import { Writable } from 'node:stream';

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { PHI_REDACT_CENSOR, PHI_REDACT_PATHS } from './redaction';

// Build a Pino instance writing to an in-memory stream so we can
// inspect the serialized JSON directly. This is the same code path
// nestjs-pino uses, minus the HTTP middleware.
function makeLogger(): { logger: pino.Logger; lines: () => unknown[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString('utf8'));
      cb();
    },
  });
  const logger = pino(
    {
      level: 'trace',
      redact: {
        paths: [...PHI_REDACT_PATHS],
        censor: PHI_REDACT_CENSOR,
        remove: false,
      },
    },
    stream,
  );
  return {
    logger,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((s) => JSON.parse(s)),
  };
}

describe('Pino PHI redaction', () => {
  it('redacts top-level PHI fields', () => {
    const { logger, lines } = makeLogger();
    logger.info(
      {
        firstName: 'Arta',
        lastName: 'Berisha',
        dateOfBirth: '2018-03-12',
        diagnosis: 'J06.9',
        prescription: 'paracetamol 250mg',
        complaint: 'temperature, cough',
        alergjiTjera: 'penicillin',
        examinations: 'lungs clear',
        ultrasoundNotes: 'liver normal',
        labResults: 'CRP 12',
        followupNotes: 'recheck in 7d',
        otherNotes: 'mother concerned',
        email: 'parent@example.com',
        phone: '+38344000000',
      },
      'sensitive',
    );
    const [line] = lines() as Array<Record<string, string>>;
    expect(line).toBeDefined();
    if (!line) return;
    for (const k of [
      'firstName',
      'lastName',
      'dateOfBirth',
      'diagnosis',
      'prescription',
      'complaint',
      'alergjiTjera',
      'examinations',
      'ultrasoundNotes',
      'labResults',
      'followupNotes',
      'otherNotes',
      'email',
      'phone',
    ]) {
      expect(line[k], `expected ${k} to be redacted`).toBe(PHI_REDACT_CENSOR);
    }
  });

  it('redacts nested under patient / visit / body', () => {
    const { logger, lines } = makeLogger();
    logger.info({
      patient: { firstName: 'X', lastName: 'Y', dateOfBirth: '2020-01-01' },
      visit: { complaint: 'fever', prescription: 'rest' },
      body: { notes: 'something private' },
      req: { body: { followupNotes: 'recheck' } },
    });
    const [line] = lines() as Array<Record<string, Record<string, unknown>>>;
    expect(line).toBeDefined();
    if (!line) return;
    expect(line.patient?.firstName).toBe(PHI_REDACT_CENSOR);
    expect(line.patient?.lastName).toBe(PHI_REDACT_CENSOR);
    expect(line.patient?.dateOfBirth).toBe(PHI_REDACT_CENSOR);
    expect(line.visit?.complaint).toBe(PHI_REDACT_CENSOR);
    expect(line.visit?.prescription).toBe(PHI_REDACT_CENSOR);
    expect(line.body?.notes).toBe(PHI_REDACT_CENSOR);
    expect((line.req as Record<string, Record<string, unknown>>)?.body?.followupNotes).toBe(
      PHI_REDACT_CENSOR,
    );
  });

  it('redacts old/new diff values in changes arrays', () => {
    const { logger, lines } = makeLogger();
    logger.info({
      changes: [
        { field: 'prescription', old: 'paracetamol', new: 'ibuprofen' },
        { field: 'diagnosis', old: 'J06.9', new: 'J11.1' },
      ],
    });
    const [line] = lines() as Array<{ changes: Array<Record<string, string>> }>;
    expect(line).toBeDefined();
    if (!line) return;
    for (const change of line.changes) {
      expect(change.old).toBe(PHI_REDACT_CENSOR);
      expect(change.new).toBe(PHI_REDACT_CENSOR);
    }
  });

  it('leaves operational identifiers untouched', () => {
    const { logger, lines } = makeLogger();
    logger.info({
      patientId: '00000000-0000-0000-0000-000000000001',
      visitId: '00000000-0000-0000-0000-000000000002',
      clinicId: 'donetamed',
      userId: 'user-1',
      requestId: 'req-1',
    });
    const [line] = lines() as Array<Record<string, string>>;
    expect(line).toBeDefined();
    if (!line) return;
    expect(line.patientId).toBe('00000000-0000-0000-0000-000000000001');
    expect(line.clinicId).toBe('donetamed');
    expect(line.userId).toBe('user-1');
    expect(line.requestId).toBe('req-1');
  });
});
