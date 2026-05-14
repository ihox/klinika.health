import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';
import { Resend } from 'resend';

import { smtpSendMessage, type SmtpDialOptions } from '../clinic-settings/smtp-client';
import { mfaCodeEmail, type MfaCodeEmailVars } from './templates/mfa-code';
import { newDeviceEmail, type NewDeviceEmailVars } from './templates/new-device';
import { passwordResetEmail, type PasswordResetEmailVars } from './templates/password-reset';
import { tenantSetupEmail, type TenantSetupEmailVars } from './templates/tenant-setup';
import { userInviteEmail, type UserInviteEmailVars } from './templates/user-invite';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

/** Resend-backed sender. Replaced in tests with a CapturingEmailSender. */
class ResendSender implements EmailSender {
  constructor(
    private readonly resend: Resend,
    private readonly fromAddress: string,
    private readonly logger: PinoLogger,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const res = await this.resend.emails.send({
      from: this.fromAddress,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    if (res.error) {
      throw new Error(`Resend error: ${res.error.message}`);
    }
    this.logger.debug({ to: message.to, subject: message.subject }, 'Email sent via Resend');
  }
}

/** SMTP-backed sender — selected when SMTP_HOST / SMTP_USERNAME /
 *  SMTP_PASSWORD are all set. Reuses the same primitive that the
 *  clinic-settings "Test connection" button uses, so the format of
 *  sent messages is identical to what a clinic admin would expect.
 *
 *  One-shot per message (no connection pooling). At our volume the
 *  TCP/TLS handshake cost is acceptable; if email throughput becomes
 *  a bottleneck a pooled transport can drop in behind this class. */
class SmtpSender implements EmailSender {
  constructor(
    private readonly dial: SmtpDialOptions,
    private readonly logger: PinoLogger,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    await smtpSendMessage(this.dial, {
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    this.logger.debug({ to: message.to, subject: message.subject }, 'Email sent via SMTP');
  }
}

/** In-memory capturing sender — selected when no RESEND_API_KEY is set. */
export class CapturingEmailSender implements EmailSender {
  readonly inbox: EmailMessage[] = [];
  send(message: EmailMessage): Promise<void> {
    this.inbox.push(message);
    // Dev-only mirror to stdout so the operator can read OTPs, password
    // reset links, etc. without standing up an SMTP/Resend backend.
    // Only reachable when `RESEND_API_KEY` is unset (the EmailService
    // constructor selects this sender only in that case) AND when the
    // current test isn't injecting its own CapturingEmailSender, so it
    // never runs in production or under the integration test harness.
    //
    // eslint-disable-next-line no-console
    console.log(
      `\n[capturing-email] to=${message.to} subject=${message.subject}\n${message.text ?? message.html ?? '(no body)'}\n`,
    );
    return Promise.resolve();
  }
  takeLatest(forEmail: string): EmailMessage | undefined {
    for (let i = this.inbox.length - 1; i >= 0; i -= 1) {
      const m = this.inbox[i];
      if (m && m.to === forEmail) return m;
    }
    return undefined;
  }
  clear(): void {
    this.inbox.length = 0;
  }
}

@Injectable()
export class EmailService {
  private sender: EmailSender;

  constructor(
    @InjectPinoLogger(EmailService.name) private readonly logger: PinoLogger,
    @Optional() @Inject(EMAIL_SENDER) injected?: EmailSender,
  ) {
    if (injected) {
      this.sender = injected;
      return;
    }

    const from = process.env['EMAIL_FROM'] ?? 'no-reply@klinika.health';
    const fromName = process.env['EMAIL_FROM_NAME'] ?? 'Klinika';

    // Selection order: SMTP (when host + credentials are present) >
    // Resend > CapturingEmailSender. Each branch is mutually
    // exclusive so misconfiguration is loud — if you set SMTP_HOST
    // without credentials, the API logs and falls through to Resend
    // rather than silently sending via a broken transport.
    const smtpHost = process.env['SMTP_HOST'];
    const smtpUser = process.env['SMTP_USERNAME'];
    const smtpPass = process.env['SMTP_PASSWORD'];
    if (smtpHost && smtpUser && smtpPass) {
      const port = Number(process.env['SMTP_PORT'] ?? 587);
      this.sender = new SmtpSender(
        { host: smtpHost, port, username: smtpUser, password: smtpPass, fromName, fromAddress: from },
        this.logger,
      );
      this.logger.info({ host: smtpHost, port, from }, 'Email transport: SMTP');
      return;
    }
    if (smtpHost) {
      this.logger.warn(
        { host: smtpHost },
        'SMTP_HOST is set but SMTP_USERNAME / SMTP_PASSWORD are missing — ignoring SMTP config',
      );
    }

    const apiKey = process.env['RESEND_API_KEY'];
    if (apiKey && apiKey.length > 0) {
      this.sender = new ResendSender(new Resend(apiKey), from, this.logger);
      this.logger.info({ from }, 'Email transport: Resend');
      return;
    }

    this.logger.warn(
      { from },
      'Neither SMTP_* nor RESEND_API_KEY set — falling back to CapturingEmailSender (dev/test only)',
    );
    this.sender = new CapturingEmailSender();
  }

  setSender(sender: EmailSender): void {
    this.sender = sender;
  }

  async sendMfaCode(toEmail: string, vars: MfaCodeEmailVars): Promise<void> {
    const t = mfaCodeEmail(vars);
    await this.sender.send({ to: toEmail, ...t });
  }

  async sendNewDeviceAlert(toEmail: string, vars: NewDeviceEmailVars): Promise<void> {
    const t = newDeviceEmail(vars);
    await this.sender.send({ to: toEmail, ...t });
  }

  async sendPasswordReset(toEmail: string, vars: PasswordResetEmailVars): Promise<void> {
    const t = passwordResetEmail(vars);
    await this.sender.send({ to: toEmail, ...t });
  }

  async sendTenantSetup(toEmail: string, vars: TenantSetupEmailVars): Promise<void> {
    const t = tenantSetupEmail(vars);
    await this.sender.send({ to: toEmail, ...t });
  }

  async sendUserInvite(toEmail: string, vars: UserInviteEmailVars): Promise<void> {
    const t = userInviteEmail(vars);
    await this.sender.send({ to: toEmail, ...t });
  }
}
