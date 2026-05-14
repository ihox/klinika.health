// Unit tests for the pure helpers exported by `dicom.service.ts`.
// The service's stateful integration paths (Prisma + Orthanc + audit)
// are covered by dicom.integration.spec.ts.

import { describe, expect, it } from 'vitest';

import { parseOrthancTimestamp, toStudyDto } from './dicom.service';

describe('parseOrthancTimestamp', () => {
  it('parses StudyDate + StudyTime into a UTC Date', () => {
    const result = parseOrthancTimestamp({
      ID: 'x',
      Instances: [],
      Series: [],
      MainDicomTags: { StudyDate: '20260514', StudyTime: '094203' },
    });
    expect(result?.toISOString()).toBe('2026-05-14T09:42:03.000Z');
  });

  it('returns null when StudyDate is missing', () => {
    expect(
      parseOrthancTimestamp({
        ID: 'x',
        Instances: [],
        Series: [],
        MainDicomTags: {},
      }),
    ).toBeNull();
  });

  it('falls back to 00:00:00 when StudyTime is missing', () => {
    const result = parseOrthancTimestamp({
      ID: 'x',
      Instances: [],
      Series: [],
      MainDicomTags: { StudyDate: '20260101' },
    });
    expect(result?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns null when StudyDate is malformed', () => {
    expect(
      parseOrthancTimestamp({
        ID: 'x',
        Instances: [],
        Series: [],
        MainDicomTags: { StudyDate: 'not-a-date' },
      }),
    ).toBeNull();
  });

  it('tolerates StudyTime fractional seconds', () => {
    // Orthanc occasionally returns "094203.456789" — we read the
    // first 6 chars (HHMMSS) and ignore the fraction.
    const result = parseOrthancTimestamp({
      ID: 'x',
      Instances: [],
      Series: [],
      MainDicomTags: { StudyDate: '20260514', StudyTime: '094203.456789' },
    });
    expect(result?.toISOString()).toBe('2026-05-14T09:42:03.000Z');
  });
});

describe('toStudyDto', () => {
  it('maps a row to wire shape with ISO timestamp', () => {
    const dto = toStudyDto({
      id: 'klinika-uuid',
      orthancStudyId: '1.2.840.113619.2.5.1234567890.20260514.1142.3457',
      receivedAt: new Date('2026-05-14T09:42:00.000Z'),
      imageCount: 8,
      studyDescription: 'Abdomen US',
    });
    expect(dto).toEqual({
      id: 'klinika-uuid',
      orthancStudyId: '1.2.840.113619.2.5.1234567890.20260514.1142.3457',
      receivedAt: '2026-05-14T09:42:00.000Z',
      imageCount: 8,
      studyDescription: 'Abdomen US',
    });
  });

  it('preserves null studyDescription', () => {
    const dto = toStudyDto({
      id: 'k',
      orthancStudyId: 'o',
      receivedAt: new Date('2026-05-14T00:00:00.000Z'),
      imageCount: 1,
      studyDescription: null,
    });
    expect(dto.studyDescription).toBeNull();
  });
});
