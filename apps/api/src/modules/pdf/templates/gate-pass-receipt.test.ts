import { describe, it, expect } from 'vitest';
import { renderGatePassReceiptHtml } from '../pdf.service';
import type { GatePassReceiptData } from '../pdf.service';

const SAMPLE: GatePassReceiptData = {
  facilityName: 'Lahore Cold Store',
  facilityCity: 'Lahore',
  passNumber: 'GP-260510-0001',
  direction: 'INWARD',
  vehicleNumber: 'LHR-1234',
  driverName: 'Akhtar',
  driverPhone: '0300-1234567',
  biltyNumber: 'B-789',
  status: 'CLEARED',
  relatedLotNumber: 'LOT-260510-0001',
  relatedDispatchNoteNumber: null,
  createdAt: '2026-05-10T07:15:00Z',
  clearedAt: '2026-05-10T07:55:00Z',
  turnaroundLabel: '40m',
  notes: 'Driver had bilty in hand',
};

describe('gate-pass-receipt template', () => {
  it('renders without throwing', () => {
    const html = renderGatePassReceiptHtml(SAMPLE);
    expect(html).toBeTruthy();
    expect(typeof html).toBe('string');
  });

  it('includes pass number and vehicle', () => {
    const html = renderGatePassReceiptHtml(SAMPLE);
    expect(html).toContain('GP-260510-0001');
    expect(html).toContain('LHR-1234');
  });

  it('renders INWARD banner', () => {
    const html = renderGatePassReceiptHtml(SAMPLE);
    expect(html).toContain('dir-INWARD');
    expect(html).toContain('INWARD');
  });

  it('renders OUTWARD banner when outbound', () => {
    const html = renderGatePassReceiptHtml({ ...SAMPLE, direction: 'OUTWARD' });
    expect(html).toContain('dir-OUTWARD');
  });

  it('shows turnaround when cleared', () => {
    const html = renderGatePassReceiptHtml(SAMPLE);
    expect(html).toContain('40m');
    expect(html).toContain('Turnaround');
  });

  it('hides turnaround section when not yet cleared', () => {
    const html = renderGatePassReceiptHtml({
      ...SAMPLE,
      status: 'PENDING',
      clearedAt: null,
      turnaroundLabel: null,
    });
    expect(html).not.toContain('Turnaround');
  });

  it('includes Urdu header', () => {
    const html = renderGatePassReceiptHtml(SAMPLE);
    expect(html).toContain('گیٹ پاس');
  });

  it('shows linked lot when present', () => {
    const html = renderGatePassReceiptHtml(SAMPLE);
    expect(html).toContain('LOT-260510-0001');
  });
});
