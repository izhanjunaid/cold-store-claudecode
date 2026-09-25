#!/usr/bin/env node
// Guardrail (docs/25 §2 invariant 1): an account code is spelled out in exactly two
// places — the registry (packages/shared/src/accounting-accounts.ts) and the seed
// that creates it (packages/db/src/chart-of-accounts.ts). Everywhere else names the
// account by role (SYSTEM_ACCOUNTS.X) or reads a property off the chart row.
//
// Files that still hold literals are listed in scripts/account-literal-allowlist.txt
// and each work stream removes its own. The list can only shrink: a listed file that
// no longer holds a literal fails too, so the line has to be deleted with the fix.
//
//   node scripts/check-account-literals.mjs            check (CI)
//   node scripts/check-account-literals.mjs --update   rewrite the allowlist from the current tree
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const ALLOWLIST = path.join(ROOT, 'scripts', 'account-literal-allowlist.txt');
const SEED = path.join(ROOT, 'packages', 'db', 'src', 'chart-of-accounts.ts');
const SCAN = ['apps/api/src', 'apps/web/src'];
const EXEMPT = [
  'packages/shared/src/accounting-accounts.ts',
  'packages/db/src/chart-of-accounts.ts',
];

const codes = new Set([...fs.readFileSync(SEED, 'utf8').matchAll(/code: '(\d{4})'/g)].map((m) => m[1]));

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === '.next') continue;
      yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      yield full;
    }
  }
}

const offenders = new Map(); // relative path -> first offending code
for (const dir of SCAN) {
  for (const file of walk(path.join(ROOT, dir))) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (EXEMPT.includes(rel)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/['"`](\d{4})['"`]/g)) {
      if (codes.has(m[1])) {
        offenders.set(rel, m[1]);
        break;
      }
    }
  }
}

if (process.argv.includes('--update')) {
  const header = '# Files still holding account-code literals. Remove a line when you remove its literals.\n';
  fs.writeFileSync(ALLOWLIST, header + [...offenders.keys()].sort().join('\n') + '\n');
  console.log(`allowlist rewritten: ${offenders.size} file(s)`);
  process.exit(0);
}

const allowed = new Set(
  fs.readFileSync(ALLOWLIST, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')),
);

let failed = false;
for (const [rel, code] of offenders) {
  if (!allowed.has(rel)) {
    console.log(`::error file=${rel}::account code '${code}' spelled out — use SYSTEM_ACCOUNTS or a chart flag`);
    failed = true;
  }
}
for (const rel of allowed) {
  if (!offenders.has(rel)) {
    console.log(`::error file=${rel}::no account literals left — delete this line from scripts/account-literal-allowlist.txt`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(`OK: account codes live in the registry (${allowed.size} file(s) still allowlisted)`);
