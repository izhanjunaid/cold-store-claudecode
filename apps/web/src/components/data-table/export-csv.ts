/**
 * Builds a CSV string from rows + column descriptors and triggers a
 * browser download. Used by the DataTable toolbar's Export action.
 */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const escape = (raw: unknown): string => {
    if (raw === null || raw === undefined) return '';
    const s = String(raw);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [columns.map((c) => escape(c.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => escape(c.value(row))).join(','));
  }
  return lines.join('\r\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
