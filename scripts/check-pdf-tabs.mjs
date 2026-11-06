// CI guardrail (docs/28 D8). Two rules for apps/web/src:
//   1. `window.open(` only inside lib/open-pdf.ts. A PDF tab opened after an await is blocked by Chrome as
//      a pop-up on a slow box; the helper opens it on the click and fills it when the PDF arrives.
//   2. NEXT_PUBLIC_API_URL is read only by lib/api-client.ts and lib/open-pdf.ts, with `??`. A
//      production build sets it to "" (one address behind Caddy); an `||` fallback turns that into
//      localhost:3001, which nothing serves on a client box, so every PDF button failed there.
// Pass directories to scan as arguments (the default is apps/web/src).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SCAN = process.argv.length > 2 ? process.argv.slice(2) : ['apps/web/src'];

const RULES = [
  {
    re: /\bwindow\.open\(/,
    allowed: ['lib/open-pdf.ts'],
    use: 'openPdf() / openPdfTab() from @/lib/open-pdf (the tab must open on the click)',
  },
  {
    re: /NEXT_PUBLIC_API_URL/,
    allowed: ['lib/api-client.ts', 'lib/open-pdf.ts'],
    use: 'apiClient() for JSON, or openPdf() / fetchPdfBlobUrl() from @/lib/open-pdf for a PDF (they read the base with ??)',
  },
];

const skip = (rel) => /\.test\.tsx?$/.test(rel);

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', 'dist'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) yield full;
  }
}

const offences = [];
for (const base of SCAN) {
  const dir = path.resolve(ROOT, base);
  if (!fs.existsSync(dir)) continue;
  for (const file of walk(dir)) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (skip(rel)) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const rule of RULES) {
        if (rule.re.test(line) && !rule.allowed.some((a) => rel.endsWith(a))) {
          offences.push({ rel, line: i + 1, text: line.trim(), use: rule.use });
        }
      }
    });
  }
}

if (offences.length > 0) {
  for (const o of offences) {
    console.error(`::error file=${o.rel},line=${o.line}::use ${o.use}: ${o.text}`);
  }
  process.exit(1);
}
console.log('OK: every PDF opens through openPdf (tab first, base read with ??)');
