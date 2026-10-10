'use client';

import { useMemo, useState } from 'react';
import { computeTariffCharge, Tariff, tariffPlanIssue } from '@coldchain/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatMoney } from '@/lib/format';

// Colocated with the rate-plans page, not in it: a page.tsx may export nothing but its
// default (CLAUDE.md), and the presets and validation are worth testing on their own.

const SELECT_CLASS =
  'flex h-8 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export const DEFAULT_TARIFF: Tariff = Tariff.parse({});

/** Each preset only fills the rule; the rates stay whatever the owner has typed. */
export const TARIFF_PRESETS: { id: string; label: string; tariff: Tariff }[] = [
  {
    id: 'apple',
    label: 'Apple: ½ month, then months, then days',
    tariff: Tariff.parse({ opening: { type: 'BLOCK', days: 15, months_charged: 0.5 } }),
  },
  {
    id: 'half-or-full',
    label: 'Months, then a ½ or full month',
    tariff: Tariff.parse({ remainder: { mode: 'HALF_OR_FULL', half_month_days: 15 } }),
  },
  {
    id: 'calendar-split',
    label: 'Calendar months (arrival after the 15th = ½ month)',
    tariff: Tariff.parse({ month_counting: 'CALENDAR', opening: { type: 'SPLIT_MONTH', split_day: 15 } }),
  },
  {
    id: 'season-extension',
    label: 'Season fee, then extra time by the month',
    tariff: Tariff.parse({ opening: { type: 'SEASON', fee: 100 } }),
  },
  {
    id: 'monthly-grace',
    label: 'Monthly, with 3 free days past each month',
    tariff: Tariff.parse({ remainder: { grace_days: 3, mode: 'FULL_MONTH' } }),
  },
];

/** What is wrong with this rule for this plan, in words a clerk can act on; null when fine. */
export function tariffIssue(tariff: Tariff, seasonEnd: string): string | null {
  const parsed = Tariff.safeParse(tariff);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'The tariff is not valid';
  return tariffPlanIssue(parsed.data, seasonEnd ? new Date(`${seasonEnd}T00:00:00.000Z`) : null);
}

function Num({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  hint,
}: {
  label: string;
  value: number | null;
  onChange: (n: number | null) => void;
  step?: number;
  min?: number;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input
        type="number"
        min={min}
        step={step}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="tabular-nums"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const dayOf = (s: string) => new Date(`${s}T00:00:00.000Z`);

function TryIt({ tariff, monthRate, minDays, seasonEnd }: { tariff: Tariff; monthRate: number; minDays: number; seasonEnd: string }) {
  const [bags, setBags] = useState('100');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const result = useMemo(() => {
    const n = Number(bags);
    if (!from || !to || !(n > 0) || !(monthRate > 0) || to < from) return null;
    if (tariffIssue(tariff, seasonEnd)) return null;
    return computeTariffCharge(
      { monthRatePkr: monthRate, minBillingDays: minDays, seasonEndDate: seasonEnd ? dayOf(seasonEnd) : null, tariff },
      n,
      dayOf(from),
      dayOf(to),
    );
  }, [bags, from, to, tariff, monthRate, minDays, seasonEnd]);

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
      <p className="text-sm font-medium">Try it — what would this bill?</p>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label>Bags</Label>
          <Input type="number" min={1} value={bags} onChange={(e) => setBags(e.target.value)} className="tabular-nums" />
        </div>
        <div className="space-y-1">
          <Label>Came in</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="tabular-nums" />
        </div>
        <div className="space-y-1">
          <Label>Taken out</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="tabular-nums" />
        </div>
      </div>
      {result ? (
        <div className="text-sm" aria-live="polite">
          <p>
            {result.days} day(s): {result.breakdown.map((b) => `${b.label} ${formatMoney(b.pkr)}`).join(' + ') || 'no charge'}
          </p>
          <p className="font-medium tabular-nums">
            {formatMoney(result.perBagPkr)} per bag × {bags} bags = {formatMoney(result.amountPkr)}
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Enter the monthly rate and pick two dates to see the bill.</p>
      )}
    </div>
  );
}

export function TariffFields({
  tariff,
  onChange,
  monthRate,
  minDays,
  seasonEnd,
}: {
  tariff: Tariff;
  onChange: (t: Tariff) => void;
  monthRate: number;
  minDays: number;
  seasonEnd: string;
}) {
  const issue = tariffIssue(tariff, seasonEnd);
  const o = tariff.opening;
  const r = tariff.remainder;
  const set = (patch: Partial<Tariff>) => onChange({ ...tariff, ...patch });
  const setRemainder = (patch: Partial<Tariff['remainder']>) => set({ remainder: { ...r, ...patch } });

  const changeOpening = (type: Tariff['opening']['type']) => {
    if (type === 'NONE') set({ opening: { type } });
    if (type === 'BLOCK') set({ opening: { type, days: 15, months_charged: 0.5 }, month_counting: 'DAYS_30' });
    if (type === 'SPLIT_MONTH') set({ opening: { type, split_day: 15 }, month_counting: 'CALENDAR' });
    if (type === 'SEASON') set({ opening: { type, fee: 100 } });
  };
  const countingLocked = o.type === 'BLOCK' || o.type === 'SPLIT_MONTH';

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-1">
        <Label>Start from a ready-made tariff</Label>
        <select
          className={SELECT_CLASS}
          value=""
          onChange={(e) => {
            const p = TARIFF_PRESETS.find((x) => x.id === e.target.value);
            if (p) onChange(p.tariff);
          }}
        >
          <option value="">Choose one, then change what you need…</option>
          {TARIFF_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>The first stretch is charged…</Label>
          <select className={SELECT_CLASS} value={o.type} onChange={(e) => changeOpening(e.target.value as Tariff['opening']['type'])}>
            <option value="NONE">like any other time</option>
            <option value="BLOCK">as a fixed block of days</option>
            <option value="SPLIT_MONTH">as the rest of the arrival month</option>
            <option value="SEASON">as one season fee</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label>Months are counted as</Label>
          <select
            className={SELECT_CLASS}
            value={tariff.month_counting}
            disabled={countingLocked}
            onChange={(e) => set({ month_counting: e.target.value as Tariff['month_counting'] })}
          >
            <option value="DAYS_30">30 days each</option>
            <option value="CALENDAR">real calendar months</option>
          </select>
        </div>

        {o.type === 'BLOCK' && (
          <>
            <Num label="First … days" value={o.days} min={1} onChange={(n) => set({ opening: { ...o, days: n ?? 1 } })} />
            <Num
              label="…are charged as … months"
              value={o.months_charged}
              step={0.5}
              min={0.5}
              hint="0.5 = half a month (adhi)"
              onChange={(n) => set({ opening: { ...o, months_charged: n ?? 0.5 } })}
            />
          </>
        )}
        {o.type === 'SPLIT_MONTH' && (
          <Num
            label="Arrived up to this day of the month = full month"
            value={o.split_day}
            min={1}
            hint="Arriving later in the month pays half a month"
            onChange={(n) => set({ opening: { ...o, split_day: n ?? 15 } })}
          />
        )}
        {o.type === 'SEASON' && (
          <Num
            label="Season fee per bag (PKR)"
            value={o.fee}
            step={0.01}
            min={0.01}
            hint="Covers storage up to the Season End date below; after that the months and days below apply"
            onChange={(n) => set({ opening: { ...o, fee: n ?? 0 } })}
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Days left over after whole months</Label>
          <select className={SELECT_CLASS} value={r.mode} onChange={(e) => setRemainder({ mode: e.target.value as Tariff['remainder']['mode'] })}>
            <option value="DAILY">are charged per day</option>
            <option value="HALF_OR_FULL">are a half month, or a full month if more</option>
            <option value="FULL_MONTH">are always a full month</option>
          </select>
        </div>
        <Num label="Free days" value={r.grace_days} hint="Leftover days up to this many cost nothing" onChange={(n) => setRemainder({ grace_days: n ?? 0 })} />
        {r.mode === 'HALF_OR_FULL' && (
          <Num label="Half month up to … days" value={r.half_month_days} min={1} onChange={(n) => setRemainder({ half_month_days: n ?? 15 })} />
        )}
        {r.mode === 'DAILY' && (
          <Num
            label="Rate per day (PKR, optional)"
            value={tariff.day_rate}
            step={0.01}
            hint="Leave empty to use the monthly rate ÷ 30"
            onChange={(n) => set({ day_rate: n })}
          />
        )}
      </div>

      {issue && (
        <p role="alert" className="text-sm text-destructive">
          {issue}
        </p>
      )}
      <TryIt tariff={tariff} monthRate={monthRate} minDays={minDays} seasonEnd={seasonEnd} />
    </div>
  );
}
