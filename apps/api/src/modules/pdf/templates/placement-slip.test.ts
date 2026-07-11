import { describe, it, expect } from 'vitest';
import { renderPlacementSlipHtml, renderRackLabelsHtml } from '../pdf.service';
import type { PlacementSlipData, RackLabelsData } from '../pdf.service';

const SLIP: PlacementSlipData = {
  facilityName: 'Test Cold Store',
  facilityCity: 'Lahore',
  lotNumber: 'LOT-260710-0001',
  ownerName: 'Ghulam Hussain',
  commodityName: 'POTATO',
  varietyName: 'Cardinal',
  marka: 'GH FARMS',
  roomName: 'Room A',
  placements: [
    { rackName: 'R-1', bags: 300 },
    { rackName: 'R-2', bags: 150 },
  ],
  unplacedBags: 50,
  totalBags: 500,
  operatorName: 'Test Operator',
  generatedAt: '2026-07-10',
};

describe('placement-slip template', () => {
  it('renders without throwing', () => {
    const html = renderPlacementSlipHtml(SLIP);
    expect(html).toBeTruthy();
    expect(typeof html).toBe('string');
  });

  it('includes lot number, room and rack rows', () => {
    const html = renderPlacementSlipHtml(SLIP);
    expect(html).toContain('LOT-260710-0001');
    expect(html).toContain('Room A');
    expect(html).toContain('R-1');
    expect(html).toContain('300');
    expect(html).toContain('R-2');
  });

  it('shows the marka banner when present and hides it when absent', () => {
    expect(renderPlacementSlipHtml(SLIP)).toContain('GH FARMS');
    expect(renderPlacementSlipHtml({ ...SLIP, marka: null })).not.toContain('Marka /');
  });

  it('shows the unplaced row only when bags are unplaced', () => {
    expect(renderPlacementSlipHtml(SLIP)).toContain('Unplaced');
    expect(
      renderPlacementSlipHtml({ ...SLIP, unplacedBags: 0 }),
    ).not.toContain('Unplaced');
  });
});

const LABELS: RackLabelsData = {
  facilityName: 'Test Cold Store',
  roomName: 'Room A',
  racks: [
    { name: 'R-1', maxCapacityBags: 400 },
    { name: 'R-2', maxCapacityBags: 400 },
    { name: 'R-3', maxCapacityBags: 200 },
  ],
};

describe('rack-labels template', () => {
  it('renders one label per rack with room and capacity', () => {
    const html = renderRackLabelsHtml(LABELS);
    expect(html).toContain('R-1');
    expect(html).toContain('R-2');
    expect(html).toContain('R-3');
    expect(html).toContain('400');
    expect((html.match(/Room A/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
