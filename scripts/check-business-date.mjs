#!/usr/bin/env node
// Guardrail (CLAUDE.md, "Server today is businessDate()"): "today" is the facility's day in
// Lahore, never the UTC date. The container runs in UTC, so between midnight and 05:00 in
// Lahore `new Date().toISOString().slice(0, 10)` is still yesterday: a form defaults to the
// wrong date, a reversal is dated before the entry it reverses, a report's "today" is a day
// behind. Use businessDate() on the server and localIsoDate() for web form defaults (both in
// packages/shared/src/fiscal.ts).
//
// Only "now" spellings are flagged. Formatting a stored DATE column with
// `row.date.toISOString().slice(0, 10)` is correct (it is a UTC-midnight Date) and is not matched.
//
//   node scripts/check-business-date.mjs              check apps/api/src and apps/web/src (CI)
//   node scripts/check-business-date.mjs <dir>...     check other directories instead
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SCAN = process.argv.length > 2 ? process.argv.slice(2) : ['apps/api/src', 'apps/web/src'];

const RULES = [
  { re: /new Date\(\)\.toISOString\(\)\.(?:slice|substring)\(0,\s*10\)/, use: 'businessDate() / localIsoDate()' },
  { re: /new Date\(\)\.toISOString\(\)\.split\(['"]T['"]\)\[0\]/, use: 'businessDate() / localIsoDate()' },
  { re: /new Date\(\)\.toJSON\(\)\.slice\(0,\s*10\)/, use: 'businessDate() / localIsoDate()' },
  { re: /toIsoDate\(new Date\(\)\)/, use: 'businessDate()' },
];

const skip = (rel) =>
  /\.test\.tsx?$/.test(rel) || // tests pin their own clocks
  rel.includes('/modules/_test/'); // the double-guarded e2e reset route

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist') continue;
      yield* walk(full);
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) {
      yield full;
    }
  }
}

const offences = [];
for (const dir of SCAN) {
  const abs = path.isAbsolute(dir) ? dir : path.join(ROOT, dir);
  if (!fs.existsSync(abs)) {
    console.error(`::error::check-business-date: no such directory ${dir}`);
    process.exit(2);
  }
  for (const file of walk(abs)) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (skip(rel)) continue;
    fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        for (const rule of RULES) {
          if (rule.re.test(line)) offences.push({ rel, line: i + 1, text: line.trim(), use: rule.use });
        }
      });
  }
}

if (offences.length > 0) {
  for (const o of offences) {
    console.error(`::error file=${o.rel},line=${o.line}::UTC "today" — use ${o.use}: ${o.text}`);
  }
  console.error(`\n${offences.length} place(s) take "today" from the UTC date; the facility's day is Asia/Karachi.`);
  process.exit(1);
}
console.log('OK: "today" is the business day everywhere (businessDate() / localIsoDate())');
