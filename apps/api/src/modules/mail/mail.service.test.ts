import { describe, it, expect, vi } from 'vitest';
import { encryptSecret } from '../../common/crypto';
import { MailService, mailConfigFromSettings, BREVO_API_URL } from './mail.service';

function storedEmail(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    smtp_host: 'smtp.gmail.com',
    smtp_port: 587,
    smtp_secure: false,
    smtp_user: 'owner@gmail.com',
    from_name: 'Lahore Cold Store',
    admin_email: 'owner@gmail.com',
    smtp_password_enc: encryptSecret('app-password'),
    ...overrides,
  };
}

function storedBrevoEmail(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    provider: 'BREVO',
    from_email: 'owner@coldchain.pk',
    from_name: 'Lahore Cold Store',
    admin_email: 'owner@coldchain.pk',
    api_key_enc: encryptSecret('xkeysib-test-key'),
    ...overrides,
  };
}

describe('mailConfigFromSettings — SMTP (legacy)', () => {
  it('resolves a full config from stored settings', () => {
    const config = mailConfigFromSettings({ email: storedEmail() });
    expect(config).toMatchObject({
      provider: 'SMTP',
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      user: 'owner@gmail.com',
      password: 'app-password',
      fromName: 'Lahore Cold Store',
      adminEmail: 'owner@gmail.com',
    });
  });

  it('returns null when disabled', () => {
    expect(mailConfigFromSettings({ email: storedEmail({ enabled: false }) })).toBeNull();
  });

  it('returns null when no email settings exist at all', () => {
    expect(mailConfigFromSettings({})).toBeNull();
    expect(mailConfigFromSettings(null)).toBeNull();
    expect(mailConfigFromSettings(undefined)).toBeNull();
  });

  it('returns null when user or password missing', () => {
    expect(mailConfigFromSettings({ email: storedEmail({ smtp_user: '' }) })).toBeNull();
    expect(mailConfigFromSettings({ email: storedEmail({ smtp_password_enc: undefined }) })).toBeNull();
  });

  it('returns null when the stored password cannot be decrypted', () => {
    expect(mailConfigFromSettings({ email: storedEmail({ smtp_password_enc: 'garbage.garbage.garbage' }) })).toBeNull();
  });

  it('falls back to the default from_name when blank', () => {
    const config = mailConfigFromSettings({ email: storedEmail({ from_name: '' }) });
    expect(config?.fromName).toBe('ColdChain');
  });
});

describe('mailConfigFromSettings — BREVO', () => {
  it('resolves a Brevo config with the decrypted API key', () => {
    const config = mailConfigFromSettings({ email: storedBrevoEmail() });
    expect(config).toMatchObject({
      provider: 'BREVO',
      apiKey: 'xkeysib-test-key',
      fromEmail: 'owner@coldchain.pk',
      fromName: 'Lahore Cold Store',
      adminEmail: 'owner@coldchain.pk',
    });
  });

  it('returns null without an API key or sender address', () => {
    expect(mailConfigFromSettings({ email: storedBrevoEmail({ api_key_enc: undefined }) })).toBeNull();
    expect(mailConfigFromSettings({ email: storedBrevoEmail({ from_email: '' }) })).toBeNull();
  });

  it('returns null when the stored API key cannot be decrypted', () => {
    expect(mailConfigFromSettings({ email: storedBrevoEmail({ api_key_enc: 'garbage.garbage.garbage' }) })).toBeNull();
  });

  it('does not require SMTP fields for the BREVO provider', () => {
    // No smtp_host/smtp_user/smtp_password_enc at all — still configured.
    expect(mailConfigFromSettings({ email: storedBrevoEmail() })).not.toBeNull();
  });
});

describe('MailService.send — SMTP', () => {
  it('renders the template and sends through the transport', async () => {
    const sent: Array<{ from: string; to: string; subject: string; html: string }> = [];
    const service = new MailService(() => ({
      sendMail: async (opts) => {
        sent.push(opts);
        return {};
      },
    }));
    const config = mailConfigFromSettings({ email: storedEmail() })!;

    await service.send(config, {
      to: 'someone@example.com',
      subject: 'Your code',
      template: 'otp-code',
      context: { facilityName: 'Lahore Cold Store', purposeLabel: 'Password reset code', code: '123456', expiresMinutes: 10 },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.from).toBe('"Lahore Cold Store" <owner@gmail.com>');
    expect(sent[0]!.to).toBe('someone@example.com');
    expect(sent[0]!.html).toContain('123456');
    expect(sent[0]!.html).toContain('Password reset code');
    expect(sent[0]!.html).toContain('10 minutes');
  });

  it('propagates transport failures to the caller', async () => {
    const service = new MailService(() => ({
      sendMail: async () => {
        throw new Error('ECONNREFUSED');
      },
    }));
    const config = mailConfigFromSettings({ email: storedEmail() })!;
    await expect(
      service.send(config, {
        to: 'x@example.com',
        subject: 't',
        template: 'test-email',
        context: { facilityName: 'F', sentAt: 'now' },
      }),
    ).rejects.toThrow('ECONNREFUSED');
  });

  it('isConfigured mirrors mailConfigFromSettings', () => {
    const service = new MailService();
    expect(service.isConfigured({ email: storedEmail() })).toBe(true);
    expect(service.isConfigured({ email: storedBrevoEmail() })).toBe(true);
    expect(service.isConfigured({})).toBe(false);
  });
});

describe('MailService.send — BREVO', () => {
  function brevoService(fetchMock: ReturnType<typeof vi.fn>) {
    // transportFactory that explodes proves Brevo sends never touch SMTP.
    return new MailService(
      () => ({ sendMail: async () => { throw new Error('SMTP path must not be used'); } }),
      fetchMock as unknown as typeof fetch,
    );
  }

  it('POSTs the rendered mail to the Brevo API with the api-key header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    const service = brevoService(fetchMock);
    const config = mailConfigFromSettings({ email: storedBrevoEmail() })!;

    await service.send(config, {
      to: 'someone@example.com',
      subject: 'Your code',
      template: 'otp-code',
      context: { facilityName: 'Lahore Cold Store', purposeLabel: 'Login verification code', code: '654321', expiresMinutes: 10 },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(BREVO_API_URL);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['api-key']).toBe('xkeysib-test-key');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init.body as string);
    expect(body.sender).toEqual({ name: 'Lahore Cold Store', email: 'owner@coldchain.pk' });
    expect(body.to).toEqual([{ email: 'someone@example.com' }]);
    expect(body.subject).toBe('Your code');
    expect(body.htmlContent).toContain('654321');
  });

  it('throws with the status on a non-2xx Brevo response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"message":"Key not found"}', { status: 401 }));
    const service = brevoService(fetchMock);
    const config = mailConfigFromSettings({ email: storedBrevoEmail() })!;

    await expect(
      service.send(config, {
        to: 'x@example.com',
        subject: 't',
        template: 'test-email',
        context: { facilityName: 'F', sentAt: 'now' },
      }),
    ).rejects.toThrow(/Brevo send failed \(HTTP 401\)/);
  });
});
