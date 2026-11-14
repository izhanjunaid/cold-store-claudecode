---
paths:
  - "apps/web/**"
---

# Web app (`apps/web`)

- **`next build` and `next dev` share `apps/web/.next/` — running one while the other is live corrupts the running dev server.** Both scripts point at the same output directory (`apps/web/package.json`), so a `next build` (e.g. the build gate, or a CI-style verification build) kicked off while a `next dev` session is still serving overwrites its manifests mid-flight. The dev server process stays alive and keeps answering requests, but every static chunk 404s and the page renders blank — a symptom (blank page, missing `main-app.js`/`layout.css`) that looks nothing like its cause. Fix: stop the dev server before building, or afterward `rm -rf apps/web/.next` and restart `next dev` (a plain reload is not enough). Hit live during the UI-revamp module 2 session (2026-09-02): a backgrounded verification build silently blanked a `next dev` server that had been running for hours on a non-default port.

- **On Windows, `next build` and `next dev` can empty `node_modules` — the web `build`/`dev` scripts now guard against it.** `output: 'standalone'` makes a build write directory junctions into `apps/web/.next/standalone` that point at the real `node_modules/.pnpm/<pkg>` folders (next, react, react-dom, postcss, picocolors, scheduler, …). Next 14.2.35's `recursiveDelete` (`dist/lib/recursive-delete.js`, run on `.next` by both `next build` and `next dev`) follows a link to decide whether it is a directory and then recurses *into the target*, so the **next** build or dev start deletes the real packages. The symptom is `Cannot find module 'next/dist/...'` (or `.../jest-worker/processChild.js`) right after a build that worked, and `node_modules/.pnpm/next@…/node_modules/next` holding no files; the same 16 packages every time. `rimraf` and PowerShell 5.1 `Remove-Item -Recurse` on `.next` follow the same junctions. `apps/web/package.json` `build` and `dev` therefore first run `node -e "require('fs').rmSync('.next/standalone',{recursive:true,force:true})"` (Node's `rmSync` unlinks a junction without following it; a no-op on Linux, CI and Docker). A box that is already hollow is repaired with `pnpm install --frozen-lockfile --force` (about 3 minutes; a plain `pnpm install` does not notice). Reproduced on demand and fixed 2026-10-19, after four unexplained wipes.

- **Every PDF opens through `openPdf()` (`apps/web/src/lib/open-pdf.ts`), and the tab opens before any `await`.** Chrome blocks a tab opened after a slow PDF render or checkout POST, so a handler calls `openPdf` (or `openPdfTab()` on the click, handing the tab on) first and the blank tab is filled when the PDF arrives and closed if it fails. The helper reads `NEXT_PUBLIC_API_URL` with `??`, never `||`: a production build sets it to `""` (one address behind Caddy), and `||` turned that into `localhost:3001`, so every PDF button failed on a client box until docs/28 Part 2. `scripts/check-pdf-tabs.mjs` (CI) fails on `window.open(` and on any read of `NEXT_PUBLIC_API_URL` outside `lib/open-pdf.ts` and `lib/api-client.ts`.

- **A `page.tsx` may export nothing but `default` and its metadata members.** Only `next build` enforces it; a helper exported for a colocated test kept CI red for four phases while typecheck and unit tests stayed green.

- **Permissions:** gate with `can(user, key)` (`apps/web/src/lib/permissions.ts`). `hasMinRole` survives only for the fixed seniority rules: the KATCHI toggles, the withdrawal form's third-party checkbox and trucks-inside rule, the gate's manager credit/override controls.

- **Blind fields:** bag counts, weights and gate amounts can arrive as `null` (the SECURITY role). Render them as `formatCount(n)` / `formatKg(n)`, never `n.toLocaleString()`. Whether weights show at all is `useWeightsShown()`.

- **Dates:** form defaults use `localIsoDate()` (`packages/shared/src/fiscal.ts`), never `new Date().toISOString().slice(0, 10)`.

- **"Room" on screen is `chamber` in code, routes and settings keys.** Only labels changed.

- **Components:** the shadcn components live in `apps/web/src/components/ui`; `packages/ui` is an empty stub. Density spec: `docs/24_ui_density_spec.md`.
