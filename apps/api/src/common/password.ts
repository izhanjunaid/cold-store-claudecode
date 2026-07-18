import { hash, verify } from '@node-rs/argon2';
import bcrypt from 'bcryptjs';

// OWASP Password Storage Cheat Sheet (2024+) argon2id minimums. `algorithm`
// is deliberately omitted — Argon2id is the library's documented default,
// and importing the `Algorithm` const enum from another package doesn't
// work under isolatedModules.
const ARGON2_OPTIONS = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

// bcrypt hashes are self-identifying ($2a$/$2b$/$2y$ prefix) and carry their
// own cost factor, so verification never needs the caller to know which
// algorithm produced a given stored hash.
export async function verifyPassword(password: string, hashed: string): Promise<boolean> {
  if (hashed.startsWith('$2')) {
    return bcrypt.compare(password, hashed);
  }
  return verify(hashed, password);
}

/** True for any legacy bcrypt hash — callers should re-hash with argon2id on next successful login. */
export function needsRehash(hashed: string): boolean {
  return hashed.startsWith('$2');
}
