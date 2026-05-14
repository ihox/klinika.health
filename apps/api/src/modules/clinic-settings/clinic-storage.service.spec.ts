import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ClinicStorageService } from './clinic-storage.service';
import { SvgRejectedError } from './svg-sanitizer';

const PNG_SIGNATURE_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('faux-signature-data', 'utf8'),
]);

const VALID_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle r="10"/></svg>',
  'utf8',
);

const HOSTILE_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  'utf8',
);

describe('ClinicStorageService', () => {
  let root: string;
  let svc: ClinicStorageService;
  const CLINIC_ID = '11111111-1111-1111-1111-111111111111';
  const USER_ID = '22222222-2222-2222-2222-222222222222';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'klinika-storage-'));
    process.env['STORAGE_ROOT'] = root;
    svc = new ClinicStorageService();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    delete process.env['STORAGE_ROOT'];
  });

  it('writes a PNG logo and reads it back', async () => {
    await svc.writeLogo(CLINIC_ID, 'image/png', PNG_SIGNATURE_BYTES);
    const read = await svc.readLogo(CLINIC_ID);
    expect(read?.contentType).toBe('image/png');
    expect(Buffer.compare(read!.bytes, PNG_SIGNATURE_BYTES)).toBe(0);
  });

  it('replaces a PNG logo when an SVG is uploaded', async () => {
    await svc.writeLogo(CLINIC_ID, 'image/png', PNG_SIGNATURE_BYTES);
    await svc.writeLogo(CLINIC_ID, 'image/svg+xml', VALID_SVG);
    const read = await svc.readLogo(CLINIC_ID);
    expect(read?.contentType).toBe('image/svg+xml');
    expect(read!.bytes.toString('utf8')).toBe(VALID_SVG.toString('utf8'));
  });

  it('rejects hostile SVG uploads', async () => {
    await expect(svc.writeLogo(CLINIC_ID, 'image/svg+xml', HOSTILE_SVG)).rejects.toThrow(
      SvgRejectedError,
    );
  });

  it('round-trips an encrypted clinic signature', async () => {
    await svc.writeClinicSignature(CLINIC_ID, PNG_SIGNATURE_BYTES);
    // File on disk is NOT plaintext — verify the magic bytes don't appear.
    const onDisk = readFileSync(svc.signaturePath(CLINIC_ID));
    expect(Buffer.compare(onDisk.subarray(0, 8), PNG_SIGNATURE_BYTES.subarray(0, 8))).not.toBe(0);

    const decrypted = await svc.readClinicSignature(CLINIC_ID);
    expect(decrypted).not.toBeNull();
    expect(Buffer.compare(decrypted!, PNG_SIGNATURE_BYTES)).toBe(0);
  });

  it('round-trips an encrypted per-user signature', async () => {
    await svc.writeUserSignature(CLINIC_ID, USER_ID, PNG_SIGNATURE_BYTES);
    expect(await svc.hasUserSignature(CLINIC_ID, USER_ID)).toBe(true);
    const decrypted = await svc.readUserSignature(CLINIC_ID, USER_ID);
    expect(Buffer.compare(decrypted!, PNG_SIGNATURE_BYTES)).toBe(0);
    await svc.removeUserSignature(CLINIC_ID, USER_ID);
    expect(await svc.hasUserSignature(CLINIC_ID, USER_ID)).toBe(false);
  });

  it('returns null when no logo or signature exists', async () => {
    expect(await svc.readLogo(CLINIC_ID)).toBeNull();
    expect(await svc.readClinicSignature(CLINIC_ID)).toBeNull();
  });

  it('removes logos cleanly', async () => {
    await svc.writeLogo(CLINIC_ID, 'image/png', PNG_SIGNATURE_BYTES);
    await svc.removeLogo(CLINIC_ID);
    expect(await svc.readLogo(CLINIC_ID)).toBeNull();
  });
});
