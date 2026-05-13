import type { IncomingMessage, ServerResponse } from 'node:http';

import { describe, expect, it } from 'vitest';

import { REQUEST_ID_HEADER_NAME, buildLoggerConfig } from './logger.config';

function makeReq(headers: Record<string, string> = {}): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

function makeRes(): {
  res: ServerResponse;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  } as unknown as ServerResponse;
  return { res, headers };
}

describe('logger config — request ID propagation', () => {
  const params = buildLoggerConfig();

  it('uses x-request-id from the incoming request when present', () => {
    const cfg = params.pinoHttp as {
      genReqId: (req: IncomingMessage, res: ServerResponse) => string;
    };
    const req = makeReq({ [REQUEST_ID_HEADER_NAME]: 'inbound-uuid' });
    const { res, headers } = makeRes();
    const id = cfg.genReqId(req, res);
    expect(id).toBe('inbound-uuid');
    expect(headers[REQUEST_ID_HEADER_NAME]).toBe('inbound-uuid');
  });

  it('mints a UUID when no incoming header is provided', () => {
    const cfg = params.pinoHttp as {
      genReqId: (req: IncomingMessage, res: ServerResponse) => string;
    };
    const req = makeReq();
    const { res, headers } = makeRes();
    const id = cfg.genReqId(req, res);
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(headers[REQUEST_ID_HEADER_NAME]).toBe(id);
  });

  it('attaches userId and clinicId via customProps', () => {
    const cfg = params.pinoHttp as {
      customProps: (req: IncomingMessage) => Record<string, unknown>;
    };
    const req = Object.assign(makeReq(), {
      userId: 'u-1',
      clinicId: 'c-1',
    });
    const props = cfg.customProps(req);
    expect(props).toEqual({ userId: 'u-1', clinicId: 'c-1' });
  });
});
