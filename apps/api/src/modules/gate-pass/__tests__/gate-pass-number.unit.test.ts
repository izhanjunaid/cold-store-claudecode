import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { formatGatePassNumber, gatePassNumberPrefix, generateGatePassNumber } from '../gate-pass-number';

describe('Gate Pass number format GP-YYMMDD-NNNN', () => {
  it('formats sequence with 4-digit pad', () => {
    expect(formatGatePassNumber(new Date('2026-05-09'), 1)).toBe('GP-260509-0001');
    expect(formatGatePassNumber(new Date('2026-05-09'), 42)).toBe('GP-260509-0042');
    expect(formatGatePassNumber(new Date('2026-12-31'), 9999)).toBe('GP-261231-9999');
  });

  it('prefix excludes sequence', () => {
    expect(gatePassNumberPrefix(new Date('2026-05-09'))).toBe('GP-260509-');
    expect(gatePassNumberPrefix(new Date('2026-01-01'))).toBe('GP-260101-');
  });

  it('prefix changes with day rollover', () => {
    expect(gatePassNumberPrefix(new Date('2026-05-09'))).not.toBe(
      gatePassNumberPrefix(new Date('2026-05-10')),
    );
  });
});

describe('the number carries the facility day, not the container clock', () => {
  // The API container runs in UTC: test the same way, whatever this machine's zone is.
  let previousTz: string | undefined;
  beforeAll(() => {
    previousTz = process.env['TZ'];
    process.env['TZ'] = 'UTC';
  });
  afterAll(() => {
    if (previousTz === undefined) delete process.env['TZ'];
    else process.env['TZ'] = previousTz;
  });

  it('a pass logged at 03:30 in Lahore (22:30 UTC the day before) is numbered with the Lahore day', async () => {
    const calls: unknown[][] = [];
    const tx = {
      $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
        calls.push(params);
        return sql.includes('pg_advisory') ? [{ _lock: '' }] : [{ next: 1 }];
      },
    };
    const n = await generateGatePassNumber(tx as never, 'fac-1', new Date('2026-10-20T22:30:00Z'));
    expect(n).toBe('GP-261021-0001');
    expect(calls.at(-1)).toEqual(['fac-1', 'GP-261021-%']);
  });
});
