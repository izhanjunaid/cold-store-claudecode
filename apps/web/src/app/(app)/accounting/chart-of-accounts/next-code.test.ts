import { describe, it, expect } from 'vitest';
// suggestNextCode moved to @coldchain/shared (the partner-create endpoint picks
// codes by the same rule). The tests stay here, next to the form that is its
// only UI consumer, because packages/shared has no test runner of its own.
import { suggestNextCode, codeBlockFor, type CodedAccount } from '@coldchain/shared';

const h = (code: string, cls: string): CodedAccount => ({
  account_code: code,
  account_class: cls,
  account_type: 'HEADER',
  parent_account_code: null,
});
const d = (code: string, cls: string, parent: string | null): CodedAccount => ({
  account_code: code,
  account_class: cls,
  account_type: 'DETAIL',
  parent_account_code: parent,
});

// Mirrors the shipped seed closely enough that the worked examples in the plan
// are the ones under test.
const SEED: CodedAccount[] = [
  h('1000', 'ASSET'), d('1010', 'ASSET', '1000'), d('1020', 'ASSET', '1000'), d('1030', 'ASSET', '1000'),
  h('1100', 'ASSET'), d('1110', 'ASSET', '1100'), d('1150', 'ASSET', '1100'),
  h('1200', 'ASSET'), d('1210', 'ASSET', '1200'), d('1220', 'ASSET', '1200'), d('1230', 'ASSET', '1200'),
  h('2000', 'LIABILITY'), d('2010', 'LIABILITY', '2000'),
  h('6000', 'EXPENSE'), d('6010', 'EXPENSE', '6000'), d('6100', 'EXPENSE', '6000'), d('6150', 'EXPENSE', '6000'),
];

describe('suggestNextCode', () => {
  it('suggests the round slot after the highest child', () => {
    expect(suggestNextCode(SEED, '6000')).toBe('6160');
    expect(suggestNextCode(SEED, '1200')).toBe('1240');
    expect(suggestNextCode(SEED, '1000')).toBe('1040');
  });

  it('starts a childless header at parent + 10', () => {
    const accounts = [...SEED, h('4900', 'REVENUE')];
    expect(suggestNextCode(accounts, '4900')).toBe('4910');
  });

  // The case that matters: a wrong prefill becomes a permanent code, and the
  // unique constraint only catches duplicates — never a code in the wrong block.
  it('never crosses into the next header of the same class', () => {
    // 1000's block is full to 1090; 1100 is the next header, so there is no room.
    const full: CodedAccount[] = [
      h('1000', 'ASSET'),
      ...['1010', '1020', '1030', '1040', '1050', '1060', '1070', '1080', '1090'].map((c) =>
        d(c, 'ASSET', '1000'),
      ),
      h('1100', 'ASSET'),
    ];
    expect(suggestNextCode(full, '1000')).toBe('');
  });

  it('fills a gap rather than skipping past an inserted account', () => {
    // 1025 Cheques in Hand inserted by hand; the round slot after the highest
    // child (1030) is 1040, which is free — so that still wins.
    const withInsert = [...SEED, d('1025', 'ASSET', '1000')];
    expect(suggestNextCode(withInsert, '1000')).toBe('1040');

    // But once 1040-1090 are taken, it falls back to the first free slot.
    const packed: CodedAccount[] = [
      h('1000', 'ASSET'),
      ...['1020', '1030', '1040', '1050', '1060', '1070', '1080', '1090'].map((c) =>
        d(c, 'ASSET', '1000'),
      ),
      h('1100', 'ASSET'),
    ];
    expect(suggestNextCode(packed, '1000')).toBe('1010');
  });

  it('caps an open-ended block at the end of the class thousand', () => {
    // No header follows 6000, so the block ends at 6999. The slot after the
    // highest child (6990) would be 7000 — another class's range — so it must
    // fall back inside the block rather than hand out 7000.
    const lastHeader: CodedAccount[] = [h('6000', 'EXPENSE'), d('6990', 'EXPENSE', '6000')];
    expect(suggestNextCode(lastHeader, '6000')).toBe('6010');

    // And when the whole block really is taken, it gives up rather than guess.
    const exhausted: CodedAccount[] = [
      h('6000', 'EXPENSE'),
      ...Array.from({ length: 99 }, (_, i) => d(String(6010 + i * 10), 'EXPENSE', '6000')),
    ];
    expect(suggestNextCode(exhausted, '6000')).toBe('');
  });

  it('ignores headers of other classes when finding the block end', () => {
    // 2000 (LIABILITY) must not cap ASSET header 1200's block.
    expect(suggestNextCode(SEED, '1200')).toBe('1240');
  });

  it('returns empty for an unknown or non-header parent', () => {
    expect(suggestNextCode(SEED, '9999')).toBe('');
    expect(suggestNextCode(SEED, '1010')).toBe('');
    expect(suggestNextCode(SEED, '')).toBe('');
  });
});

// The case the whole equity restructure exists for. Before 3100/3200 shipped,
// equity was the only class with no header, so the Add Account form had no
// parent to derive from and a partner's code was invented by hand — which is
// how the live chart ended up with 3011, 3035 and 3040 side by side.
describe('suggestNextCode — partner equity', () => {
  // The seeded equity chart: system plug and the two derived accounts sit at
  // the root deliberately (they belong to no partner), with the partner blocks
  // starting at 3100 and 3200.
  const EQUITY: CodedAccount[] = [
    d('3010', 'EQUITY', null),
    d('3020', 'EQUITY', null),
    d('3030', 'EQUITY', null),
    h('3100', 'EQUITY'),
    h('3200', 'EQUITY'),
  ];

  it('starts each partner block cleanly, ignoring whatever sits in 30xx', () => {
    expect(suggestNextCode(EQUITY, '3100')).toBe('3110');
    expect(suggestNextCode(EQUITY, '3200')).toBe('3210');
  });

  it('walks each block independently as partners are added', () => {
    const twoPartners = [
      ...EQUITY,
      d('3110', 'EQUITY', '3100'), d('3120', 'EQUITY', '3100'),
      d('3210', 'EQUITY', '3200'), d('3220', 'EQUITY', '3200'),
    ];
    expect(suggestNextCode(twoPartners, '3100')).toBe('3130');
    expect(suggestNextCode(twoPartners, '3200')).toBe('3230');
  });

  // 3100's block must stop at 3200, or a third partner's capital account would
  // be suggested a code that reads as a drawings account.
  it('never lets a capital suggestion cross into the drawings block', () => {
    const full: CodedAccount[] = [
      h('3100', 'EQUITY'),
      ...Array.from({ length: 9 }, (_, i) => d(String(3110 + i * 10), 'EQUITY', '3100')),
      h('3200', 'EQUITY'),
    ];
    expect(suggestNextCode(full, '3100')).toBe('');
  });

  it('reports the block a header owns, for the hint under the code field', () => {
    expect(codeBlockFor(EQUITY, '3100')).toEqual({ start: 3100, limit: 3200 });
    // No header follows 3200, so it runs to the end of the class thousand.
    expect(codeBlockFor(EQUITY, '3200')).toEqual({ start: 3200, limit: 4000 });
    expect(codeBlockFor(EQUITY, '3010')).toBeNull();
  });
});
