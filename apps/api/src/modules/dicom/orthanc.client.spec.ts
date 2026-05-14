// Unit tests for OrthancClient — verifies the wire surface (headers,
// URL composition, error handling) without spinning up an Orthanc
// container. `global.fetch` is stubbed per test.

import type { PinoLogger } from 'nestjs-pino';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { OrthancClient } from './orthanc.client';

type FetchMock = Mock<(input: string | URL, init?: RequestInit) => Promise<Response>>;

function makeLogger(): PinoLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    setContext: vi.fn(),
    assign: vi.fn(),
  } as unknown as PinoLogger;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('OrthancClient', () => {
  let fetchMock: FetchMock;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    process.env['ORTHANC_URL'] = 'http://orthanc:8042';
    process.env['ORTHANC_USERNAME'] = 'klinika';
    process.env['ORTHANC_PASSWORD'] = 'klinika';
    fetchMock = vi.fn() as FetchMock;
    originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env['ORTHANC_URL'];
    delete process.env['ORTHANC_USERNAME'];
    delete process.env['ORTHANC_PASSWORD'];
  });

  it('returns null study when Orthanc 404s', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, {}));
    const client = new OrthancClient(makeLogger());
    expect(await client.getStudy('missing')).toBeNull();
  });

  it('sends Basic auth on every request', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { ID: 'x', Instances: [], Series: [], MainDicomTags: {} }),
    );
    const client = new OrthancClient(makeLogger());
    await client.getStudy('study-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://orthanc:8042/studies/study-1');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBe(
      `Basic ${Buffer.from('klinika:klinika').toString('base64')}`,
    );
  });

  it('lists instances from a study payload', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        ID: 'study-1',
        Instances: ['i1', 'i2', 'i3'],
        Series: ['s1'],
        MainDicomTags: {},
      }),
    );
    const client = new OrthancClient(makeLogger());
    expect(await client.listInstances('study-1')).toEqual(['i1', 'i2', 'i3']);
  });

  it('fetches preview bytes with the expected content type', async () => {
    const body = Buffer.from('fake-png-bytes', 'utf-8');
    fetchMock.mockResolvedValueOnce(
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    );
    const client = new OrthancClient(makeLogger());
    const result = await client.fetchPreview('instance-1');
    expect(result?.contentType).toBe('image/png');
    expect(result?.buffer.toString('utf-8')).toBe('fake-png-bytes');
  });

  it('returns null when ORTHANC_URL is unset (cloud-only install)', async () => {
    delete process.env['ORTHANC_URL'];
    const client = new OrthancClient(makeLogger());
    expect(client.isConfigured()).toBe(false);
    expect(await client.getStudy('x')).toBeNull();
    expect(await client.fetchPreview('y')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null and logs when the network call throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connection refused'));
    const logger = makeLogger();
    const client = new OrthancClient(logger);
    expect(await client.getStudy('x')).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('parses /statistics into bytes', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { TotalDiskSize: '12345' }));
    const client = new OrthancClient(makeLogger());
    expect(await client.getStorageBytes()).toBe(12345);
  });

  it('falls back to TotalDiskSizeMB when TotalDiskSize is missing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { TotalDiskSizeMB: 2 }));
    const client = new OrthancClient(makeLogger());
    expect(await client.getStorageBytes()).toBe(2 * 1024 * 1024);
  });
});
