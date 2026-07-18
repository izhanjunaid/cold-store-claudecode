// ============================================================================
// Password policy — NIST SP 800-63B-4 (Aug 2025) compliant.
//
// Rev 4 requires screening against a blocklist of commonly used, expected, or
// compromised passwords, and explicitly forbids composition rules ("must
// contain a symbol/number/uppercase") and periodic expiry. This module is
// deliberately just length + blocklist — nothing else — and is shared by the
// API (server-side enforcement, authoritative) and the web app (inline
// feedback before submit).
// ============================================================================

export const PASSWORD_MIN_LENGTH_DEFAULT = 10;

// Offline blocklist of the most predictable passwords, drawn from the top of
// SecLists' most-common-password corpus, filtered to entries that could pass
// the 10-char length floor (shorter ones are already rejected by length).
// Compared lowercased. Deliberately small — it screens the obviously
// guessable, it is not a breach-corpus check.
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  '1234567890',
  '123456789',
  '12345678910',
  '1234567890123',
  'password',
  'password1',
  'password12',
  'password123',
  'password1234',
  'password12345',
  'password!',
  'password1!',
  'passwords',
  'passw0rd123',
  'qwertyuiop',
  'qwerty12345',
  'qwertyuiop123',
  '1qaz2wsx3edc',
  '1q2w3e4r5t',
  'iloveyou123',
  'letmein123',
  'welcome123',
  'welcome1234',
  'admin12345',
  'administrator',
  'changeme123',
  'basketball',
  'football123',
  'liverpool1',
  'sunshine123',
  'princess123',
  'superman123',
  'starwars123',
  'monkey12345',
  'dragon12345',
  'freedom12345',
  'whatever123',
  'jennifer123',
  'michelle123',
  'charlie123',
  'thunder123',
  'computer123',
  'internet123',
  'abcdefghij',
  'abcd1234567',
  'a1b2c3d4e5',
  '0987654321',
  '9876543210',
  'qazwsxedcrfv',
  'zaq12wsxcde3',
]);

export interface PasswordPolicyOptions {
  minLength?: number;
}

export interface PasswordPolicyResult {
  ok: boolean;
  reason?: string;
}

export function validateNewPassword(
  password: string,
  options: PasswordPolicyOptions = {},
): PasswordPolicyResult {
  const minLength = options.minLength ?? PASSWORD_MIN_LENGTH_DEFAULT;
  if (password.length < minLength) {
    return { ok: false, reason: `Password must be at least ${minLength} characters long.` };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { ok: false, reason: 'That password is too common — choose something less predictable.' };
  }
  return { ok: true };
}
