import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { SmtpError, smtpSendTestMessage } from './smtp-client';

export interface SmtpTestParams {
  host: string;
  port: number;
  username: string;
  password: string;
  fromName: string;
  fromAddress: string;
  toEmail: string;
  clinicName: string;
}

export interface SmtpTestResult {
  ok: boolean;
  detail: string;
  reason?: string;
}

/**
 * Wrapper around {@link smtpSendTestMessage} that translates protocol
 * failures into structured `{ ok, detail }` results. The endpoint
 * never throws back to the caller — a failed test is normal user
 * feedback, not an exceptional condition.
 *
 * Overrideable in tests with {@link SmtpTestService.useStubResult}
 * so integration tests don't need a real SMTP server. The integration
 * test for the SMTP test endpoint exercises this stub by default;
 * a separate test (skipped without `KLINIKA_SMTP_E2E_HOST`) hits a
 * real server when configured.
 */
@Injectable()
export class SmtpTestService {
  private stub: ((params: SmtpTestParams) => Promise<SmtpTestResult>) | null = null;

  constructor(
    @InjectPinoLogger(SmtpTestService.name)
    private readonly logger: PinoLogger,
  ) {}

  /** Replace the real SMTP path with a deterministic stub for tests. */
  useStubResult(stub: ((params: SmtpTestParams) => Promise<SmtpTestResult>) | null): void {
    this.stub = stub;
  }

  async runTest(params: SmtpTestParams): Promise<SmtpTestResult> {
    if (this.stub) {
      return this.stub(params);
    }
    try {
      await smtpSendTestMessage(
        {
          host: params.host,
          port: params.port,
          username: params.username,
          password: params.password,
          fromName: params.fromName,
          fromAddress: params.fromAddress,
        },
        {
          to: params.toEmail,
          subject: 'Klinika · Testimi i SMTP-së',
          text: testBody(params.clinicName),
        },
      );
      return {
        ok: true,
        detail: 'Lidhja u testua me sukses · email i testit u dërgua.',
      };
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : 'Gabim i panjohur.';
      const reason = err instanceof SmtpError ? err.reason : 'unknown';
      // No PHI in the params — host, port, username, fromAddress.
      // Password is deliberately omitted.
      this.logger.warn(
        { host: params.host, port: params.port, reason },
        'SMTP test failed',
      );
      return { ok: false, detail, reason };
    }
  }
}

function testBody(clinicName: string): string {
  return [
    `Ky është një email testimi nga klinika ${clinicName}.`,
    '',
    'Nëse e merrni këtë mesazh, lidhja SMTP funksionon dhe Klinika',
    'mund të dërgojë vërtetime, kujtesa dhe link-e për reset të',
    'fjalëkalimit nga adresa juaj.',
    '',
    'Mund ta injoroni këtë email.',
    '',
    '— Klinika',
    'klinika.health · email automatik, mos përgjigjuni',
  ].join('\n');
}
