// Wire-shape tests for the visit-client soft-delete call. The
// `DeleteVisitDialog`'s "Pse?" reason flows through `softDelete(id,
// { reason })` and surfaces in the request body — server-side this
// becomes the `deleteReason` audit-log field (see
// `visits.service.softdelete.spec.ts`).
//
// The rest of the visit-client (PATCH / restore / history) is
// exercised by the integration suite and the typecheck; this file
// pins ONLY the soft-delete body shape so the front-back contract
// can't silently drift.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

import { visitClient } from './visit-client';

const VISIT = '11111111-1111-1111-1111-111111111111';

interface CapturedCall {
  url: string;
  method: string | undefined;
  body: unknown;
  contentType: string | undefined;
}

let fetchMock: MockInstance;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function captureLastCall(): CapturedCall {
  const calls = fetchMock.mock.calls;
  const [url, init] = calls[calls.length - 1] as [string, RequestInit | undefined];
  const headers = init?.headers as Record<string, string> | undefined;
  return {
    url,
    method: init?.method,
    body: init?.body == null ? null : JSON.parse(String(init.body)),
    contentType: headers?.['Content-Type'],
  };
}

beforeEach(() => {
  fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      jsonResponse({ status: 'ok', restorableUntil: '2026-05-15T10:00:30Z' }),
    );
});

afterEach(() => {
  fetchMock.mockRestore();
});

describe('visitClient.softDelete', () => {
  it('sends no body when no reason is supplied', async () => {
    await visitClient.softDelete(VISIT);
    const call = captureLastCall();
    expect(call.url).toContain(`/api/visits/${VISIT}`);
    expect(call.method).toBe('DELETE');
    expect(call.body).toBeNull();
    // Without a JSON body apiFetch must NOT inject the Content-Type
    // header — keeps the DELETE wire-clean for intermediaries that
    // don't expect a body on this method.
    expect(call.contentType).toBeUndefined();
  });

  it('sends no body when reason is an empty string', async () => {
    await visitClient.softDelete(VISIT, { reason: '' });
    expect(captureLastCall().body).toBeNull();
  });

  it('sends no body when reason is whitespace only', async () => {
    await visitClient.softDelete(VISIT, { reason: '   ' });
    expect(captureLastCall().body).toBeNull();
  });

  it('serialises the trimmed reason into the request body', async () => {
    await visitClient.softDelete(VISIT, {
      reason: '  Pacienti u regjistrua dy herë  ',
    });
    const call = captureLastCall();
    expect(call.method).toBe('DELETE');
    expect(call.body).toEqual({ reason: 'Pacienti u regjistrua dy herë' });
    expect(call.contentType).toBe('application/json');
  });
});
