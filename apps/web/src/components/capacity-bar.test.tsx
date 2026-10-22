import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CapacityBar, capacityPct, formatCapacityPct } from './capacity-bar';

describe('capacityPct', () => {
  it('rounds the fill of a room or rack', () => {
    expect(capacityPct(380, 5000)).toBe(8);
    expect(capacityPct(160, 500)).toBe(32);
    expect(capacityPct(0, 500)).toBe(0);
    expect(capacityPct(10, 0)).toBe(0); // a room with no capacity set
  });

  it('is unknown, not zero, when the occupancy was withheld (the gate guard counts blind)', () => {
    expect(capacityPct(null, 5000)).toBeNull();
    expect(capacityPct(undefined, 5000)).toBeNull();
  });
});

describe('formatCapacityPct', () => {
  it('prints a percentage, or a dash when it is unknown', () => {
    expect(formatCapacityPct(8)).toBe('8%');
    expect(formatCapacityPct(0)).toBe('0%'); // a genuinely empty room is 0%
    expect(formatCapacityPct(null)).toBe('—');
  });
});

describe('CapacityBar', () => {
  it('draws the fill for a known occupancy', () => {
    const { container } = render(<CapacityBar occupied={250} capacity={500} />);
    const track = container.firstElementChild as HTMLElement;
    expect((track.firstElementChild as HTMLElement).style.width).toBe('50%');
  });

  it('draws an empty track, no fill, when the occupancy is unknown', () => {
    const { container } = render(<CapacityBar occupied={null} capacity={500} />);
    expect((container.firstElementChild as HTMLElement).childElementCount).toBe(0);
  });
});
