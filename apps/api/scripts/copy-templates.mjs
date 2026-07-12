// Copy non-TS assets (PDF HTML/Handlebars templates) into dist after `tsc`.
// tsc only emits .js/.d.ts, so the templates that pdf.service reads via readFileSync
// (dist/modules/pdf/templates/*.html) are otherwise missing in the built image and
// every PDF endpoint 500s with ENOENT. Cross-platform, no extra dependencies.
import { cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

for (const module of ['pdf', 'mail']) {
  const src = join(apiRoot, 'src', 'modules', module, 'templates');
  const dest = join(apiRoot, 'dist', 'modules', module, 'templates');

  if (existsSync(src)) {
    cpSync(src, dest, { recursive: true });
    console.log(`[copy-templates] ${module} templates -> ${dest}`);
  } else {
    console.warn(`[copy-templates] no templates dir at ${src} (skipped)`);
  }
}
