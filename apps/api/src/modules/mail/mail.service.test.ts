import { describe, it, expect } from 'vitest';
import { encryptSecret } from '../../common/crypto';
import { MailService, mailConfigFromSettings } from './mail.service';

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

describe('mailConfigFromSettings', () => {
  it('resolves a full config from stored settings', () => {
    const config = mailConfigFromSettings({ email: storedEmail() });
    expect(config).toEqual({
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

describe('MailService.send', () => {
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
    expect(service.isConfigured({})).toBe(false);
  });
});
