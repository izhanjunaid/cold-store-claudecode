import { describe, it, expect } from 'vitest';
import { renderDispatchNoteHtml } from '../pdf.service';
import type { DispatchNoteData } from '../pdf.service';

const SAMPLE: DispatchNoteData = {
  facilityName: 'Test Cold Store',
  facilityCity: 'Lahore',
  dispatchNoteNumber: 'DN-260510-0001',
  lotNumber: 'LOT-260410-0001',
  outboundDate: '2026-05-10',
  withdrawalType: 'PARTIAL',
  commodityName: 'POTATO',
  quantityWithdrawnBags: 50,
  outboundWeightKg: 1000,
  receivingPartyName: 'Khan Traders',
  vehicleNumber: 'LHR-1234',
  operatorName: 'Test Operator',
};

describe('dispatch-note template', () => {
  it('renders without throwing', () => {
    const html = renderDispatchNoteHtml(SAMPLE);
    expect(html).toBeTruthy();
    expect(typeof html).toBe('string');
  });

  it('includes the lot number and dispatch note number', () => {
    const html = renderDispatchNoteHtml(SAMPLE);
    expect(html).toContain('LOT-260410-0001');
    expect(html).toContain('DN-260510-0001');
  });

  it('shows the marka when present', () => {
    const html = renderDispatchNoteHtml({ ...SAMPLE, marka: 'ABC FARMS' });
    expect(html).toContain('ABC FARMS');
    expect(html).toContain('Marka');
  });

  it('hides the marka row when absent', () => {
    const html = renderDispatchNoteHtml({ ...SAMPLE, marka: null });
    expect(html).not.toContain('Marka');
  });
});
