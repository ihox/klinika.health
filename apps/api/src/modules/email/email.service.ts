import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';
import { Resend } from 'resend';

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

/** In-memory capturing sender — selected when no RESEND_API_KEY is set. */
export class CapturingEmailSender implements EmailSender {
  readonly inbox: EmailMessage[] = [];
  send(message: EmailMessage): Promise<void> {
    this.inbox.push(message);
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
    } else {
      const apiKey = process.env['RESEND_API_KEY'];
      const from = process.env['EMAIL_FROM'] ?? 'no-reply@klinika.health';
      if (apiKey && apiKey.length > 0) {
        this.sender = new ResendSender(new Resend(apiKey), from, this.logger);
      } else {
        this.logger.warn(
          { from },
          'RESEND_API_KEY not set — falling back to CapturingEmailSender (dev/test only)',
        );
        this.sender = new CapturingEmailSender();
      }
    }
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
