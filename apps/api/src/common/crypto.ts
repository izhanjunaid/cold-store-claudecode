import crypto from 'crypto';

// Symmetric encryption for secrets that must live inside facility settings JSON
// (e.g. the SMTP app password). Settings JSON is snapshotted verbatim into
// audit_log by the facilities audit trigger, so secrets must never be stored
// in plaintext. aes-256-gcm; payload format: base64(iv).base64(tag).base64(data).
const ALGO = 'aes-256-gcm';

function encryptionKey(): Buffer {
  const source = process.env['APP_ENCRYPTION_KEY'] || process.env['JWT_SECRET'] || 'dev-secret';
  return crypto.createHash('sha256').update(source).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Malformed encrypted secret');
  const decipher = crypto.createDecipheriv(ALGO, encryptionKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}
