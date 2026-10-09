import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain-text body; the HTML version is generated from it. */
  text: string;
  html?: string;
}

/**
 * Templated transactional email.
 *
 * In development this points at Laragon's Mailpit on :1025, so nothing leaves
 * the machine and every message is visible at http://localhost:8025.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    if (this.config.get<string>('MAIL_DRIVER') === 'log') return;

    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');

    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: Number(this.config.get<string>('SMTP_PORT')),
      secure: this.config.get<string>('SMTP_SECURE') === 'true',
      // Mailpit accepts unauthenticated mail; production will have credentials.
      auth: user ? { user, pass } : undefined,
    });
  }

  async send(message: MailMessage): Promise<void> {
    const from = this.config.get<string>('MAIL_FROM');

    if (!this.transporter) {
      this.logger.log(`[mail:log] to=${message.to} subject="${message.subject}"`);
      return;
    }

    try {
      await this.transporter.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html ?? wrap(message.subject, message.text),
      });
      this.logger.log(`Sent "${message.subject}" to ${message.to}`);
    } catch (error) {
      // Email is a notification channel, not a transaction: a failure is logged
      // rather than rolled back into the caller.
      this.logger.error(`Could not send mail to ${message.to}: ${String(error)}`);
    }
  }
}

/** Minimal branded shell, matching the product's ink/blue palette. */
function wrap(title: string, text: string): string {
  const paragraphs = text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(p)}</p>`)
    .join('');

  return `<!doctype html>
<html><body style="margin:0;background:#f5f7fb;font-family:Inter,system-ui,sans-serif;color:#0b1220">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:#fff;border-radius:14px;box-shadow:0 8px 28px rgba(15,23,42,.07);overflow:hidden">
        <tr><td style="background:linear-gradient(135deg,#3366ff,#15b8d6);padding:20px 28px">
          <span style="color:#fff;font-weight:700;letter-spacing:.08em;font-size:14px">OPSVERA</span>
        </td></tr>
        <tr><td style="padding:28px">
          <h1 style="margin:0 0 16px;font-size:18px">${escapeHtml(title)}</h1>
          ${paragraphs}
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #e5eaf1;color:#8b98ab;font-size:12px">
          Business Operations OS
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
