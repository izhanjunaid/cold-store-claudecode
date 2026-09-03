# 24. UI Density Spec — Foundation Module

Binding contract for the five module sessions that build on `ui-revamp/00-foundation`. If a
decision isn't written down here, it doesn't exist for you — read this file, not the
foundation session's history.

## 1. Spacing scale

No custom spacing tokens — Tailwind's default 4px scale (`0.25rem` steps) is the scale.
What changed is *which step goes where*:

| Use | Value | Class |
|---|---|---|
| Table cell vertical padding, compact | 4px | `py-1` |
| Table cell vertical padding, comfortable | 8px | `py-2` |
| Form field label→control gap | 4px | `space-y-1` (on `FormItem`) |
| Card / Dialog / Sheet padding | 16px | `p-4` |
| Confirm-dialog padding | 16px | `p-4` |
| StatTile / EditableRows footer bar padding | 12px | `p-3` |
| Page content padding (`<main>`) | 20px / 16px | `px-5 py-4` |
| Page header bottom margin | 16px | `mb-4` |

## 2. Typography scale

Defined under `theme.extend.fontSize` in `tailwind.config.ts` — **never** bare `theme.fontSize`,
which would replace Tailwind's scale wholesale and silently strip `text-4xl` (live in
`chambers/[id]/page.tsx`, a page this module cannot touch). Only three steps are remapped —
they carry the whole density win; every larger step keeps Tailwind's stock value and is applied
per-component instead, since this module controls every component that uses one.

| Token | Size/line-height | Was | Maps to |
|---|---|---|---|
| `text-2xs` | 11px/14px | *(new)* | Helper text, `FormDescription`/`FormMessage`, micro-labels |
| `text-xs` | 12px/16px | unchanged | Form label, table header, `EntryGroup` micro-header |
| `text-sm` | 13px/18px | 14px/20px | Control text, table cell, body-in-forms |
| `text-base` | 14px/20px | 16px/24px | Body text |
| `text-lg` | 18px/28px (stock) | unchanged | Card / Dialog / Sheet / AlertDialog title |
| `text-xl` | 20px/28px (stock) | unchanged | Page title (`PageHeader` h1) |
| `text-2xl` | 24px/32px (stock) | unchanged | `StatTile` default value |
| `text-3xl`+ | stock, untouched | — | Reserved for pages this module can't touch |

## 3. Table density modes

`DataTable`'s `density?: 'compact' | 'comfortable'` prop, default `'compact'`. Row height is
pinned directly on `<tr>` (`h-7`/`h-9`), not left to padding + inherited line-height, because a
`<tr>` height is a **floor** in table layout — content taller than it silently expands the row.

| Mode | Row height | Cell padding | When |
|---|---|---|---|
| `compact` (default) | 28px (`h-7`) | `py-1` | Default for all lists — an ERP used for hours benefits from more rows on screen |
| `comfortable` | 36px (`h-9`) | `py-2` | Tables whose rows carry icon-button actions or need more breathing room |
| Header (both modes) | 32px (`h-8`) | — | Fixed regardless of body density |

**Row-height ceiling — read before adding a row action.** The pinned height is a floor, so any
in-cell control taller than it forces the row to grow, silently breaking the density promise:

- `StatusBadge` (~22px) fits inside a compact row.
- `Button size="sm"` — **measured at exactly 28px** in the live app (`getBoundingClientRect`
  on a real "Rename" action button) — fits exactly inside a compact row.
- `Button` default/`icon` (32px, `h-8`) does **not** fit inside a compact row — it forces the
  row to 32px. Use `size="sm"` for any row action in a `density="compact"` table, or switch
  that table to `comfortable`.
- **`UrduText`** (`ui/urdu-text.tsx`, used for `marka` and `name_urdu` values) sets
  `leading-loose` (2× line-height) deliberately, to avoid clipping Nastaliq script's vertical
  strokes — a pre-existing, correct choice, not a density-pass regression. **Measured on a real
  seeded lot row: 28.7px without a marka value, 34.87px with one.** Any list column that can
  render Urdu text will not hold the 28px compact-row promise for rows that have a value in
  that column. This is expected, not a bug — don't "fix" it by removing `leading-loose`.

Cells default to `whitespace-nowrap`; opt into `col.truncate` for ellipsis + hover tooltip on a
column that legitimately holds long text — pair it with `col.width` (an unbounded column can't
truncate). Wrapping cells are what make row height non-deterministic; don't reach for it.

**Sticky header/footer — the mechanism, so you don't reintroduce the bug.** The header/footer
now actually stick — verified against real seeded data on `/lots` (19 rows): scrolling `<main>`
by a real ~292px (its full available scroll range) left the `<thead>`'s position pixel-for-pixel
unchanged. Before this branch, the same scroll moved the header the full scroll distance, i.e.
it never stuck at all. Two things had to change together, and neither works alone:

1. `app/(app)/layout.tsx`: the shell is `h-screen overflow-hidden`; `<main>` is `overflow-auto`
   (both axes — see below) and is the *only* scroll container in the app.
2. `components/ui/table.tsx`: the wrapper `<div>` around `<table>` no longer sets
   `overflow-auto`. CSS coerces a lone `overflow-x: auto` into `overflow-y: auto` too (a
   documented mismatched-axis rule), so even a horizontal-only scroll wrapper would silently
   re-block vertical sticky by becoming its own scroll container. **Any wrapper div you put
   between a sticky element and `<main>` must not set `overflow-x` or `overflow-y` to anything
   but `visible`,** or sticky breaks again, invisibly, with no test catching it.
3. Consequence: a table wider than the viewport now scrolls horizontally at the `<main>` level
   (the whole content pane pans), not internally. This is standard ERP behavior (Odoo/SAP do
   the same) and applies even to the 25 pages that use the raw `Table` primitive directly
   without `DataTable`.

Column-visibility toggling, resizing, multi-select facets, row-selection/bulk-bar, sticky first
column, and persisting hidden columns across navigation are explicitly **not built** — no named
consumer for any of them.

## 4. Control heights

| Control | Height | Notes |
|---|---|---|
| `Button` default | 32px (`h-8`) | |
| `Button size="sm"` | 28px (`h-7`) | Only size legal inside a compact table row |
| `Button size="lg"` | 36px (`h-9`) | |
| `Button size="icon"` | 32×32px (`h-8 w-8`) | |
| `Input` / `SelectTrigger` / native `<select>` | 32px (`h-8`) | `text-sm` (13px) |
| `Textarea` | 56px min (`min-h-[56px]`) | `text-sm` |
| `Label` / `FormLabel` | — | `text-xs` (12px), `font-medium` |

**Form field rhythm:** label (12px) + gap (4px, `space-y-1` on `FormItem`) + control (32px) =
**48px per field.** This replaced the old `.entry-sheet` CSS hack (which matched the literal
Tailwind class string `.space-y-1\.5` to compress nine specific forms) — the base scale is now
uniformly compact, so every form looks like an entry form and there's no escape-hatch class to
accidentally break. `.entry-sheet` has been deleted from `globals.css`; do not recreate it.

Composition rule: a compact-density table row (28px) fits `Button size="sm"` or a badge, not a
default/icon button. A comfortable-density row (36px) fits a default-size button (32px) with
margin to spare.

## 5. Interaction pattern decision table

| Pattern | Use when | Trigger |
|---|---|---|
| **Modal (`Dialog`)** | Focused, blocking task; must finish or cancel before returning | ≤1 screen of fields, no need for page context behind it, not deep-linkable |
| **Drawer (`Sheet`)** | Editing/viewing one record while keeping list context visible | Medium field count (roughly 5–15), benefits from seeing what's behind it, doesn't need its own URL |
| **Popover** | A few lines of read-only info or a tiny action, anchored to a trigger | ≤3–4 fields, no validation/submit flow, dismissible by clicking away |
| **Inline edit (`EditableRows`)** | Editing several similar rows of structured data in place | Row count is bounded (tens, not thousands), fields are homogeneous per row, edits happen in a batch before one submit |
| **Expandable row (`DataTable.renderExpanded`)** | Occasional deeper detail on a subset of rows, read-mostly | Detail is secondary to the row's summary, not needed for every row, no separate URL |
| **Quick-view panel** | Peek at a record's detail without leaving a list | Composition of the shell's working scroll + `Sheet` (`size="md"` or `"lg"`) — not a new component; build it from these two primitives |
| **Dedicated page** | The record has enough state/actions to be a first-class destination | Needs a shareable URL, has its own sub-navigation (tabs), or is a multi-step flow |

**Master-detail layout** is likewise a composition, not a new primitive: a flex row inside
`<main>` (which now genuinely scrolls) with a list pane and a detail pane that's either an
inline `Card` or a `Sheet`. No dedicated master-detail component was built — nothing named a
consumer for one beyond what's already assemblable.

**A detail page's actions default onto it whether they qualify or not — re-check the
"Dedicated page" row's own criteria before keeping one, don't just keep it because a detail
view already exists.** Once any `[id]` route is built for a record type, every new action for
that record tends to land there by habit, even when none of the three "Dedicated page"
triggers actually apply to that specific action. Concretely, for each action ask: is it more
than a single no-field POST (Approve-style) or a small (~5-field) `Dialog`? Does the *record*
have sub-navigation/tabs, or a genuine multi-step lifecycle (payroll runs: draft → finalize →
pay → remit → reverse — correctly a dedicated page)? If not, the action belongs as a row
action on the *list* instead — Payroll (Module 2) found this auditing the expense-voucher
detail page: Approve/Accrue/Cancel are single POSTs, Edit/Pay are small dialogs already built
for the detail page, and the voucher has no sub-navigation or multi-step flow — so all five
moved to row actions on `expenses/page.tsx`, sharing the *same* `Dialog` components with the
detail page (`expense-voucher-dialogs.tsx`) rather than duplicating them, and the detail page
became a fallback (JE-peek links, a bookmarkable URL) instead of the primary way to act on a
voucher. This removes a full-page navigation from the most common expense workflow without
touching Foundation's decision table itself — the table was already right, the miss was not
re-applying it once a page already existed. A row's actions need `size="sm"`/`ghost` buttons
(compact-row ceiling, §3) and every action handler must `e.stopPropagation()` (one wrapper
`onClick` on the actions cell is enough) or it also fires the row's own navigate-to-detail
click.

**Explicit non-decisions** (recorded so no module invents its own):
- **No stepper/wizard component.** No downstream flow was named that needs one; the existing
  multi-step flows (lot transfer, loan issue, payroll run) stay nested routes. Build one only
  if you hit a specific flow that needs it, and note it here.
- **Dark mode is deferred.** `darkMode: ['class']` is configured but no `.dark` token block
  exists; 17 `dark:` usages in the codebase predate this branch. Do not half-implement it in a
  module session — it needs a deliberate token pass across the whole palette.
- **Sidebar (`layout/sidebar.tsx`) is unchanged, deliberately.** It already groups 6 sections
  with permission filtering; the command-palette Actions group (§7 below) attacks navigation
  cost more cheaply than restructuring it. This is a decision, not an oversight.

## 6. Action placement rules

- **Dialog/Sheet/AlertDialog footer:** primary action bottom-right (or top-right of the
  flex-reversed mobile layout via `sm:flex-row sm:justify-end`), secondary/cancel to its left.
  Destructive-confirm actions use `AlertDialogAction` with `variant="destructive"` styling —
  never a bare `Button` for a destructive confirm.
- **Page header (`PageHeader`):** primary action(s) top-right via the `actions` prop. A page
  has at most one visually primary action; anything else is `variant="outline"` or `"ghost"`.
- **Table toolbar (`DataTableToolbar`):** search + filters left-aligned, export/column-visibility
  utility actions right-aligned (`ml-auto`) — already the existing pattern, unchanged.
- **`FormActions` (sticky form footer):** primary submit first, secondary/cancel after it, live
  computed values (`EntryChip`) pushed right via the `meta` prop. Sticky positioning now works
  for the same reason table headers do (§3) — no page-specific CSS needed.
- **`EditableRows`:** row-remove is a `ghost`/`icon` button at the row's trailing edge; Add is
  `variant="outline" size="sm"` below the rows, with any totals/footer content right-aligned
  beside it (`footer` prop).

## 7. `EditableRows` — API and usage

Generalizes the working array-of-rows + controlled-inputs pattern already proven in
`rack-allocation-editor.tsx` (kept as-is; Operations owns that file). CSS grid, not `<table>` —
matches the prior art and avoids table-semantics fights with inputs. Named consumers: journal-
entry lines (Accounting Core), payroll-run review (Payroll), rack allocation (Operations, as a
future refactor — not required).

```tsx
import { EditableRows, type EditableRowColumn } from '@/components/form';

interface LineItem { account_id: string; debit: string; credit: string; }

const columns: EditableRowColumn<LineItem>[] = [
  { key: 'account', header: 'Account', width: '2fr', render: (row, update) => (
      <ComboboxTrigger value={row.account_id} onChange={(v) => update({ account_id: v })} />
    ) },
  { key: 'debit', header: 'Debit', width: '140px', align: 'right', render: (row, update) => (
      <Input className="h-8 text-right tabular-nums" value={row.debit}
             onChange={(e) => update({ debit: e.target.value })} />
    ) },
  { key: 'credit', header: 'Credit', width: '140px', align: 'right', render: (row, update) => (
      <Input className="h-8 text-right tabular-nums" value={row.credit}
             onChange={(e) => update({ credit: e.target.value })} />
    ) },
];

<EditableRows
  rows={lines}
  onChange={setLines}
  columns={columns}
  newRow={() => ({ account_id: '', debit: '', credit: '' })}
  minRows={2}
  footer={<span className="text-sm tabular-nums">Balance: {balance}</span>}
/>
```

**Props:**

| Prop | Type | Notes |
|---|---|---|
| `rows` / `onChange` | `T[]` / `(rows: T[]) => void` | Fully controlled — no internal row state |
| `columns` | `EditableRowColumn<T>[]` | `{ key, header, width, align?, render }`; `width` is a CSS grid track (`'2fr'`, `'140px'`) |
| `newRow` | `() => T` | Factory for a blank row, used by Add and by Enter-to-add-row |
| `addLabel` | `string` | Default `'Add row'` |
| `minRows` | `number` | Rows at/below this count can't be removed (default `0`) |
| `maxRows` | `number` | Add button hides at this count |
| `footer` | `ReactNode` | Totals/remaining-counter, right-aligned next to Add |
| `disabled` | `boolean` | Disables Add and every row's remove button |
| `removable` | `boolean` | Default `true`. Set `false` for a fixed-roster editor (e.g. payroll-run lines, snapshotted at draft creation with no add/delete) — hides the trailing remove column entirely rather than disabling it. Added by Payroll (Module 2); default preserves every existing consumer unchanged. |

**Behavior:** Enter on the last field of the last row appends a new row and focuses its first
field — the ERP line-entry reflex. Every other Enter press is left alone, so if `EditableRows`
is nested inside an `<EntrySheet>`, that ancestor's own field-to-field Enter-advance keeps
working unmodified (verified via `entry-sheet.tsx`'s exported `isEnterAdvanceTarget`, reused
rather than reimplemented). The pure row operations (`addRowTo`, `removeRowAt`, `updateRowAt`,
`canRemoveRow`) are exported and unit-tested in `editable-rows.test.tsx` — reuse them if a
consumer needs the same array algebra outside the component.

## 8. What changed and why

**Tokens** (`tailwind.config.ts`, `globals.css`): 3-step type ramp under `theme.extend.fontSize`
(§2); `earth` palette deleted (0 usages); `.entry-sheet` CSS block deleted (superseded by making
the base control scale compact — see §4).

**Controls** (`ui/{button,input,select,textarea,label,form}.tsx`): heights and text size cut to
the §4 scale; `FormItem` rhythm tightened to `space-y-1`; the nine field components' individual
`space-y-1.5` overrides removed so one class governs spacing everywhere, not a CSS hack keyed to
a literal class string.

**Containers** (`ui/{card,dialog,sheet,alert-dialog}.tsx`): padding cut from `p-6` to `p-4`;
`Dialog` and `Sheet` gained a `size` variant (`sm`/`md`/`lg`/`xl`) since the old fixed
`sm:max-w-sm` (384px) on `Sheet` was too narrow to hold a real form; `Sheet` is now a flex column
with a new `SheetBody` (scrolling middle region) so header/body/footer compose correctly.
`AlertDialogContent` (backing `confirm-dialog.tsx`, one of the most-used dialogs in the app) was
tightened to match — it carried the same oversized `p-6`/`max-w-lg` scale as `Dialog` did before
this pass and wasn't in the original file list, but is squarely `components/ui/**` and the brief
explicitly calls out `confirm-dialog.tsx` for review.

**Shell** (`app/(app)/layout.tsx`): fixed-viewport (`h-screen overflow-hidden`), `<main>` is the
one scroll container. This is the prerequisite for sticky headers/footers everywhere (§3) and
for master-detail/quick-view compositions (§5) — without it, none of those work anywhere, on any
future page.

**`DataTable`**: `density` prop (§3), sticky header made to actually work (previously provably
inert — verified in-browser: scrolling moved the header pixel-for-pixel with the page, meaning
it never stuck), `col.truncate`, `col.footer` (totals row), `renderExpanded` (expandable rows).

**New**: `EditableRows` (§7). **Command palette**: a static "Actions" group
(`PALETTE_ACTIONS` in `nav-config.ts`) for six common creates (New Inbound, New Party, Record
Payment, New Journal Entry, New Expense, Issue Loan), filtered through the same permission
mechanism as nav items — a courtesy, not a substitute for the API's own guard. ("New Outbound"
was dropped from the original idea: withdrawal is nested under a specific lot
(`/lots/[id]/withdraw`), so there's no lot-agnostic destination to send the palette to.)

**Deleted**: `@tanstack/react-table` from `apps/web/package.json` (zero imports anywhere in
`apps/web/src` — the real `DataTable` is hand-rolled with server-side sort/filter/paginate, the
correct pattern at this data volume); `pnpm-lock.yaml` regenerated and committed alongside it.
`FormSection` (0 consumers, competed with `EntryGroup`'s 9) — `form-section.tsx` renamed to
`form-actions.tsx`, keeping only `FormActions` (4+ consumers). `SummaryRail`/`SummaryItem` (0
consumers, superseded by `EntryChip`).

**Kept as-is**: `ui/collapsible.tsx` (0 consumers but harmless — restorable in seconds, a module
session may reach for it); the legacy `primary-50..900` Tailwind color scale (19 live usages in
pages this module can't touch); `entry-sheet.tsx`'s `EntrySheet`/`EntryGroup`/`EntryChip`
components (already the working dense-form pattern — only the redundant CSS override was
deleted, not the components); `rack-allocation-editor.tsx` (Operations' file, untouched).
