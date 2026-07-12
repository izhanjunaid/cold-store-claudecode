import nodemailer from 'nodemailer';
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_FACILITY_SETTINGS } from '@coldchain/shared';
import { decryptSecret } from '../../common/crypto';

export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromName: string;
  adminEmail: string;
}

// Shape of settings.email as stored in the facility settings JSON: the public
// fields plus the internal encrypted password key (never exposed in responses).
interface StoredEmailSettings {
  enabled?: boolean;
  smtp_host?: string;
  smtp_port?: number;
  smtp_secure?: boolean;
  smtp_user?: string;
  from_name?: string;
  admin_email?: string;
  smtp_password_enc?: string;
}

/**
 * Resolve a usable SMTP config from a facility's raw settings JSON.
 * Returns null when email is disabled, incomplete, or the stored password
 * cannot be decrypted — callers treat null as "email not configured".
 */
export function mailConfigFromSettings(rawSettings: unknown): MailConfig | null {
  const settings =
    rawSettings && typeof rawSettings === 'object' && !Array.isArray(rawSettings)
      ? (rawSettings as Record<string, unknown>)
      : {};
  const email: StoredEmailSettings = {
    ...DEFAULT_FACILITY_SETTINGS.email,
    ...((settings['email'] as StoredEmailSettings | undefined) ?? {}),
  };
  if (!email.enabled || !email.smtp_host || !email.smtp_user || !email.smtp_password_enc) return null;
  let password: string;
  try {
    password = decryptSecret(email.smtp_password_enc);
  } catch {
    return null;
  }
  return {
    host: email.smtp_host,
    port: email.smtp_port ?? 587,
    secure: email.smtp_secure ?? false,
    user: email.smtp_user,
    password,
    fromName: email.from_name || 'ColdChain',
    adminEmail: email.admin_email ?? '',
  };
}

export interface MailTransport {
  sendMail(opts: { from: string; to: string; subject: string; html: string }): Promise<unknown>;
}
export type TransportFactory = (config: MailConfig) => MailTransport;

const defaultTransportFactory: TransportFactory = (config) =>
  nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

const templateCache = new Map<string, HandlebarsTemplateDelegate>();

function renderTemplate(name: string, context: Record<string, unknown>): string {
  let template = templateCache.get(name);
  if (!template) {
    const source = readFileSync(join(__dirname, 'templates', `${name}.hbs`), 'utf8');
    template = Handlebars.compile(source);
    templateCache.set(name, template);
  }
  return template(context);
}

/**
 * Outbound email. Deliberately minimal: a fresh transport per send (volume is
 * tiny and settings may change between sends), hard timeouts, and no retries.
 * Sends can fail on an offline box — callers decide whether that is fatal.
 */
export class MailService {
  constructor(private transportFactory: TransportFactory = defaultTransportFactory) {}

  isConfigured(rawSettings: unknown): boolean {
    return mailConfigFromSettings(rawSettings) !== null;
  }

  async send(
    config: MailConfig,
    opts: { to: string; subject: string; template: string; context: Record<string, unknown> },
  ): Promise<void> {
    const html = renderTemplate(opts.template, opts.context);
    const transport = this.transportFactory(config);
    await transport.sendMail({
      from: `"${config.fromName}" <${config.user}>`,
      to: opts.to,
      subject: opts.subject,
      html,
    });
  }
}
