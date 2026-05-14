import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

import { Injectable } from '@nestjs/common';

import { decryptBytes, encryptBytes } from './storage-cipher';
import { sanitizeSvgBuffer } from './svg-sanitizer';

export type LogoContentType = 'image/png' | 'image/svg+xml';

export interface StoredLogo {
  bytes: Buffer;
  contentType: LogoContentType;
}

/**
 * Filesystem-backed storage for clinic branding assets and per-user
 * doctor signatures. Lives under `<STORAGE_ROOT>/<clinic_id>/...` so
 * tenants can never read each other's files via the proxy endpoints
 * (proxy adds `req.ctx.clinicId` to the path).
 *
 * Signatures are stored encrypted at rest (AES-256-GCM, see
 * {@link storage-cipher}). Logos are stored as-is because they are
 * intentionally public-within-the-clinic and ride on printed letters.
 *
 * `STORAGE_ROOT` defaults to `<repo>/storage` for local dev. In
 * production containers it's mounted at `/storage` (per `.gitignore`
 * and `docker-compose`). The `/storage/` path is never exposed by
 * Caddy — every read goes through an authenticated NestJS handler.
 */
@Injectable()
export class ClinicStorageService {
  private readonly root: string;

  constructor() {
    const configured = process.env['STORAGE_ROOT'];
    this.root = configured ? resolve(configured) : resolve(process.cwd(), 'storage');
  }

  // ----- Logo -----------------------------------------------------------

  async writeLogo(clinicId: string, contentType: LogoContentType, bytes: Buffer): Promise<void> {
    await this.ensureClinicDir(clinicId);
    // Sanitize SVG bytes BEFORE writing. Reject (throw) instead of
    // silently rewriting — a hostile logo is not the caller's intent.
    const payload = contentType === 'image/svg+xml' ? sanitizeSvgBuffer(bytes) : bytes;
    // Clear out the other extension so we don't end up with both a
    // .png and a .svg sitting around.
    const otherExt = contentType === 'image/png' ? 'svg' : 'png';
    await this.tryRemove(this.logoPath(clinicId, otherExt));
    await writeFile(this.logoPath(clinicId, extOf(contentType)), payload);
  }

  async readLogo(clinicId: string): Promise<StoredLogo | null> {
    for (const ct of ['image/png', 'image/svg+xml'] as const) {
      try {
        const bytes = await readFile(this.logoPath(clinicId, extOf(ct)));
        return { bytes, contentType: ct };
      } catch (err: unknown) {
        if (!isNotFound(err)) throw err;
      }
    }
    return null;
  }

  async removeLogo(clinicId: string): Promise<void> {
    await Promise.all([
      this.tryRemove(this.logoPath(clinicId, 'png')),
      this.tryRemove(this.logoPath(clinicId, 'svg')),
    ]);
  }

  // ----- Clinic signature ---------------------------------------------

  async writeClinicSignature(clinicId: string, bytes: Buffer): Promise<void> {
    await this.ensureClinicDir(clinicId);
    const enc = encryptBytes(bytes);
    await writeFile(this.signaturePath(clinicId), enc);
  }

  async readClinicSignature(clinicId: string): Promise<Buffer | null> {
    try {
      const enc = await readFile(this.signaturePath(clinicId));
      return decryptBytes(enc);
    } catch (err: unknown) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async removeClinicSignature(clinicId: string): Promise<void> {
    await this.tryRemove(this.signaturePath(clinicId));
  }

  // ----- Per-user (doctor) signature ----------------------------------

  async writeUserSignature(clinicId: string, userId: string, bytes: Buffer): Promise<void> {
    await this.ensureUserDir(clinicId, userId);
    const enc = encryptBytes(bytes);
    await writeFile(this.userSignaturePath(clinicId, userId), enc);
  }

  async readUserSignature(clinicId: string, userId: string): Promise<Buffer | null> {
    try {
      const enc = await readFile(this.userSignaturePath(clinicId, userId));
      return decryptBytes(enc);
    } catch (err: unknown) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async removeUserSignature(clinicId: string, userId: string): Promise<void> {
    await this.tryRemove(this.userSignaturePath(clinicId, userId));
  }

  async hasUserSignature(clinicId: string, userId: string): Promise<boolean> {
    return Boolean(await this.readUserSignature(clinicId, userId));
  }

  // ----- Paths --------------------------------------------------------

  clinicDir(clinicId: string): string {
    return join(this.root, clinicId);
  }
  logoPath(clinicId: string, ext: 'png' | 'svg'): string {
    return join(this.clinicDir(clinicId), `logo.${ext}`);
  }
  signaturePath(clinicId: string): string {
    return join(this.clinicDir(clinicId), 'signature.png.enc');
  }
  userSignaturePath(clinicId: string, userId: string): string {
    return join(this.clinicDir(clinicId), 'users', userId, 'signature.png.enc');
  }

  private async ensureClinicDir(clinicId: string): Promise<void> {
    await mkdir(this.clinicDir(clinicId), { recursive: true });
  }

  private async ensureUserDir(clinicId: string, userId: string): Promise<void> {
    await mkdir(join(this.clinicDir(clinicId), 'users', userId), { recursive: true });
  }

  private async tryRemove(path: string): Promise<void> {
    try {
      await rm(path, { force: true });
    } catch (err: unknown) {
      if (!isNotFound(err)) throw err;
    }
  }
}

function extOf(ct: LogoContentType): 'png' | 'svg' {
  return ct === 'image/png' ? 'png' : 'svg';
}

function isNotFound(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT');
}
