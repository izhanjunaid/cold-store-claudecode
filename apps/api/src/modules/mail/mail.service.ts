import nodemailer from 'nodemailer';
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_FACILITY_SETTINGS } from '@coldchain/shared';
import { decryptSecret } from '../../common/crypto';

export const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const API_SEND_TIMEOUT_MS = 15_000;

export type MailProvider = 'SMTP' | 'BREVO';

export interface MailConfig {
  provider: MailProvider;
  // SMTP fields (provider === 'SMTP')
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  // API fields (provider === 'BREVO')
  apiKey: string;
  fromEmail: string;
  // Common
  fromName: string;
  adminEmail: string;
}

// Shape of settings.email as stored in the facility settings JSON: the public
// fields plus the internal encrypted secret keys (never exposed in responses).
interface StoredEmailSettings {
  enabled?: boolean;
  provider?: MailProvider;
  smtp_host?: string;
  smtp_port?: number;
  smtp_secure?: boolean;
  smtp_user?: string;
  from_email?: string;
  from_name?: string;
  admin_email?: string;
  smtp_password_enc?: string;
  api_key_enc?: string;
}

/**
 * Resolve a usable mail config from a facility's raw settings JSON.
 * Returns null when email is disabled, incomplete for its provider, or the
 * stored secret cannot be decrypted — callers treat null as "not configured".
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
  if (!email.enabled) return null;

  const base = {
    fromName: email.from_name || 'ColdChain',
    adminEmail: email.admin_email ?? '',
  };

  if (email.provider === 'BREVO') {
    if (!email.api_key_enc || !email.from_email) return null;
    let apiKey: string;
    try {
      apiKey = decryptSecret(email.api_key_enc);
    } catch {
      return null;
    }
    return {
      provider: 'BREVO',
      host: '',
      port: 0,
      secure: false,
      user: '',
      password: '',
      apiKey,
      fromEmail: email.from_email,
      ...base,
    };
  }

  // SMTP (default / legacy)
  if (!email.smtp_host || !email.smtp_user || !email.smtp_password_enc) return null;
  let password: string;
  try {
    password = decryptSecret(email.smtp_password_enc);
  } catch {
    return null;
  }
  return {
    provider: 'SMTP',
    host: email.smtp_host,
    port: email.smtp_port ?? 587,
    secure: email.smtp_secure ?? false,
    user: email.smtp_user,
    password,
    apiKey: '',
    fromEmail: email.from_email ?? '',
    ...base,
  };
}

export interface MailTransport {
  sendMail(opts: { from: string; to: string; subject: string; html: string }): Promise<unknown>;
}
export type TransportFactory = (config: MailConfig) => MailTransport;
export type FetchImpl = typeof fetch;

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
 * Outbound email. Deliberately minimal: a fresh transport/request per send
 * (volume is tiny and settings may change between sends), hard timeouts, and
 * no retries. Sends can fail on an offline box — callers decide whether that
 * is fatal.
 */
export class MailService {
  constructor(
    private transportFactory: TransportFactory = defaultTransportFactory,
    private fetchImpl: FetchImpl = fetch,
  ) {}

  isConfigured(rawSettings: unknown): boolean {
    return mailConfigFromSettings(rawSettings) !== null;
  }

  async send(
    config: MailConfig,
    opts: { to: string; subject: string; template: string; context: Record<string, unknown> },
  ): Promise<void> {
    const html = renderTemplate(opts.template, opts.context);
    if (config.provider === 'BREVO') {
      await this.sendViaBrevo(config, opts.to, opts.subject, html);
      return;
    }
    const transport = this.transportFactory(config);
    await transport.sendMail({
      from: `"${config.fromName}" <${config.user}>`,
      to: opts.to,
      subject: opts.subject,
      html,
    });
  }

  private async sendViaBrevo(config: MailConfig, to: string, subject: string, html: string): Promise<void> {
    const res = await this.fetchImpl(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'api-key': config.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: config.fromName, email: config.fromEmail },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
      signal: AbortSignal.timeout(API_SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Brevo send failed (HTTP ${res.status}): ${body.slice(0, 300)}`);
    }
  }
}
