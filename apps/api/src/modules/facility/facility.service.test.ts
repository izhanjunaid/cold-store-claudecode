import { describe, it, expect } from 'vitest';
import { resolveFacilitySettings } from './facility.service';

describe('resolveFacilitySettings — backdating_max_days default', () => {
  it('defaults to a 7-day window for a facility with no explicit setting', () => {
    expect(resolveFacilitySettings(null).backdating_max_days).toBe(7);
  });

  it('honors an explicit stored value over the default', () => {
    expect(resolveFacilitySettings({ backdating_max_days: 30 }).backdating_max_days).toBe(30);
  });

  it('honors an explicit null (unlimited) over the default', () => {
    expect(resolveFacilitySettings({ backdating_max_days: null }).backdating_max_days).toBeNull();
  });
});
