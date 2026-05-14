import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

/**
 * Lean Orthanc REST client.
 *
 * Only the surface Klinika needs:
 *   - GET /studies/:id          — JSON metadata + instance list
 *   - GET /instances/:id        — parent-study lookup for proxy auth
 *   - GET /instances/:id/preview — rendered PNG/JPEG preview
 *   - GET /instances/:id/file   — full DICOM bytes (rare, audited)
 *   - GET /statistics           — disk usage for telemetry
 *
 * Every request carries the `Authorization: Basic <user:pass>` header
 * derived from `ORTHANC_USERNAME` / `ORTHANC_PASSWORD`. Klinika is the
 * only legitimate Orthanc admin user; the credentials never leave the
 * server.
 *
 * The bytes returned by `fetchPreview` / `fetchFullDicom` are streamed
 * straight back to the browser through the proxy endpoint, never
 * cached at rest. Klinika sets `Cache-Control: private, no-store` on
 * every image response per CLAUDE.md §1.3.
 */
export interface OrthancStudyTags {
  PatientName?: string;
  PatientID?: string;
  StudyDescription?: string;
  StudyDate?: string;
  StudyTime?: string;
  AccessionNumber?: string;
}

export interface OrthancStudyMeta {
  ID: string;
  Instances: string[];
  Series: string[];
  MainDicomTags: OrthancStudyTags;
  PatientMainDicomTags?: { PatientName?: string; PatientID?: string };
  LastUpdate?: string;
}

export interface OrthancFetchResult {
  buffer: Buffer;
  contentType: string;
}

@Injectable()
export class OrthancClient {
  private readonly baseUrl: string | null;
  private readonly authHeader: string | null;

  constructor(
    @InjectPinoLogger(OrthancClient.name)
    private readonly logger: PinoLogger,
  ) {
    const raw = process.env['ORTHANC_URL'] ?? null;
    this.baseUrl = raw ? raw.replace(/\/$/, '') : null;
    const user = process.env['ORTHANC_USERNAME'];
    const pass = process.env['ORTHANC_PASSWORD'];
    if (user && pass) {
      this.authHeader = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
    } else {
      this.authHeader = null;
    }
  }

  isConfigured(): boolean {
    return this.baseUrl !== null;
  }

  async getStudy(orthancStudyId: string): Promise<OrthancStudyMeta | null> {
    const res = await this.request(`/studies/${encodeURIComponent(orthancStudyId)}`);
    if (!res) return null;
    if (res.status === 404) return null;
    if (!res.ok) {
      this.logger.warn(
        { orthancStudyId, status: res.status },
        'Orthanc getStudy returned non-2xx',
      );
      return null;
    }
    return (await res.json()) as OrthancStudyMeta;
  }

  async listInstances(orthancStudyId: string): Promise<string[]> {
    const study = await this.getStudy(orthancStudyId);
    return study?.Instances ?? [];
  }

  /**
   * `/instances/:id` — returns `ParentStudy` (the Orthanc study id),
   * used by the bridge to verify a browser-requested instance belongs
   * to a study in this clinic. Returns `null` if the instance does
   * not exist in Orthanc or the server is unreachable.
   */
  async getInstance(instanceId: string): Promise<{ ParentStudy?: string } | null> {
    const res = await this.request(`/instances/${encodeURIComponent(instanceId)}`);
    if (!res) return null;
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return (await res.json()) as { ParentStudy?: string };
  }

  async fetchPreview(instanceId: string): Promise<OrthancFetchResult | null> {
    return this.fetchBinary(
      `/instances/${encodeURIComponent(instanceId)}/preview`,
      'image/png',
    );
  }

  async fetchFullDicom(instanceId: string): Promise<OrthancFetchResult | null> {
    return this.fetchBinary(
      `/instances/${encodeURIComponent(instanceId)}/file`,
      'application/dicom',
    );
  }

  /**
   * Storage usage in bytes — used by the telemetry agent. Returns
   * `null` when Orthanc is unreachable. Reads `/statistics` (cheap,
   * O(1) on Orthanc's side).
   */
  async getStorageBytes(): Promise<number | null> {
    const res = await this.request('/statistics');
    if (!res || !res.ok) return null;
    const body = (await res.json()) as { TotalDiskSize?: string; TotalDiskSizeMB?: number };
    if (body.TotalDiskSize) {
      const parsed = Number(body.TotalDiskSize);
      if (Number.isFinite(parsed)) return parsed;
    }
    if (typeof body.TotalDiskSizeMB === 'number') {
      return body.TotalDiskSizeMB * 1024 * 1024;
    }
    return null;
  }

  private async fetchBinary(
    path: string,
    defaultContentType: string,
  ): Promise<OrthancFetchResult | null> {
    const res = await this.request(path, { accept: defaultContentType });
    if (!res) return null;
    if (!res.ok) {
      this.logger.warn(
        { path, status: res.status },
        'Orthanc binary fetch returned non-2xx',
      );
      return null;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') ?? defaultContentType;
    return { buffer, contentType };
  }

  private async request(
    path: string,
    opts: { accept?: string } = {},
  ): Promise<Response | null> {
    if (!this.baseUrl) {
      // No Orthanc configured (cloud-only install). All endpoints
      // degrade gracefully — the picker shows "Asnjë studim" and the
      // bridge controller short-circuits.
      return null;
    }
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {};
    if (this.authHeader) headers['Authorization'] = this.authHeader;
    if (opts.accept) headers['Accept'] = opts.accept;
    try {
      return await fetch(url, { method: 'GET', headers });
    } catch (err) {
      this.logger.warn(
        { path, err: err instanceof Error ? err.message : String(err) },
        'Orthanc request failed',
      );
      return null;
    }
  }
}
