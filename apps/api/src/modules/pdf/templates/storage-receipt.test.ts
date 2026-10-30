import { describe, it, expect } from 'vitest';
import { renderStorageReceiptHtml } from '../pdf.service';
import type { StorageReceiptData } from '../pdf.service';

const SAMPLE: StorageReceiptData = {
  facilityName: 'Test Cold Store',
  facilityCity: 'Lahore',
  lotNumber: 'LOT-260410-0001',
  inboundDate: '2026-04-10',
  entryDate: '2026-04-10',
  ownerName: 'Ghulam Hussain',
  ownerNameUrdu: 'غلام حسین',
  commodityName: 'POTATO',
  varietyName: 'Cardinal',
  quantityBags: 500,
  acceptedWeightKg: 10200,
  declaredWeightKg: 10500,
  weightDisputeFlag: true,
  weightDisputeNote: 'Moisture loss in transit',
  qualityGradeInbound: 'A',
  chamberName: 'Chamber B',
  ratePlanName: 'Potato Seasonal 2026',
  rateAmountPkr: 250,
  rateType: 'SEASONAL_PER_BAG',
  vehicleNumber: 'LHR-1234',
  operatorName: 'Test Operator',
  bookType: 'PACCI',
};

describe('storage-receipt template', () => {
  it('renders without throwing', () => {
    const html = renderStorageReceiptHtml(SAMPLE);
    expect(html).toBeTruthy();
    expect(typeof html).toBe('string');
  });

  it('includes the lot number', () => {
    const html = renderStorageReceiptHtml(SAMPLE);
    expect(html).toContain('LOT-260410-0001');
  });

  it('includes bilingual owner name', () => {
    const html = renderStorageReceiptHtml(SAMPLE);
    expect(html).toContain('Ghulam Hussain');
    expect(html).toContain('غلام حسین');
  });

  it('shows dispute banner when flag is true', () => {
    const html = renderStorageReceiptHtml(SAMPLE);
    expect(html).toContain('Weight Dispute');
    expect(html).toContain('Moisture loss in transit');
  });

  it('hides dispute banner when flag is false', () => {
    const html = renderStorageReceiptHtml({ ...SAMPLE, weightDisputeFlag: false, weightDisputeNote: null });
    expect(html).not.toContain('Weight Dispute');
  });

  it('contains quantity and commodity', () => {
    const html = renderStorageReceiptHtml(SAMPLE);
    expect(html).toContain('500');
    expect(html).toContain('POTATO');
    expect(html).toContain('Cardinal');
  });

  it('shows the marka when present', () => {
    const html = renderStorageReceiptHtml({ ...SAMPLE, marka: 'ABC FARMS' });
    expect(html).toContain('ABC FARMS');
    expect(html).toContain('Marka');
  });

  it('hides the marka row when absent', () => {
    const html = renderStorageReceiptHtml({ ...SAMPLE, marka: null });
    expect(html).not.toContain('Marka');
  });

  // Weight optional (docs/27): a lot with no weight, or a facility that hides weights.
  it('prints the weights when the lot has them', () => {
    const html = renderStorageReceiptHtml(SAMPLE);
    expect(html).toContain('Accepted Weight');
    expect(html).toContain('Quantity &amp; Weight');
    expect(html).toContain('10200 کلو');
  });

  it('prints no weight line or weight heading when the lot has none', () => {
    const html = renderStorageReceiptHtml({
      ...SAMPLE,
      acceptedWeightKg: null,
      declaredWeightKg: null,
      weightDisputeFlag: false,
      weightDisputeNote: null,
    });
    expect(html).not.toContain('Accepted Weight');
    expect(html).not.toContain('Declared Weight');
    expect(html).not.toContain('&amp; Weight');
    expect(html).not.toContain('کلو');
    expect(html).not.toContain('و وزن');
    expect(html).toContain('500'); // the bags still print
  });
});
