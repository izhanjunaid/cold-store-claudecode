import { describe, expect, it } from 'vitest';
import { buildCsv, type CsvColumn } from './export-csv';

interface Row {
  name: string;
  bags: number;
  note: string | null;
}

const columns: CsvColumn<Row>[] = [
  { header: 'Name', value: (r) => r.name },
  { header: 'Bags', value: (r) => r.bags },
  { header: 'Note', value: (r) => r.note },
];

describe('buildCsv', () => {
  it('emits a header row followed by data rows', () => {
    const csv = buildCsv([{ name: 'Aslam', bags: 500, note: 'ok' }], columns);
    expect(csv).toBe('Name,Bags,Note\r\nAslam,500,ok');
  });

  it('quotes values containing commas, quotes, and newlines', () => {
    const csv = buildCsv(
      [{ name: 'Khan, Co', bags: 10, note: 'line1\nline2' }],
      columns,
    );
    expect(csv).toContain('"Khan, Co"');
    expect(csv).toContain('"line1\nline2"');
  });

  it('escapes embedded double quotes by doubling them', () => {
    const csv = buildCsv([{ name: 'A "B" C', bags: 1, note: null }], columns);
    expect(csv).toContain('"A ""B"" C"');
  });

  it('renders null/undefined as empty cells', () => {
    const csv = buildCsv([{ name: 'X', bags: 0, note: null }], columns);
    expect(csv).toBe('Name,Bags,Note\r\nX,0,');
  });

  it('handles an empty row set (header only)', () => {
    expect(buildCsv([], columns)).toBe('Name,Bags,Note');
  });
});
