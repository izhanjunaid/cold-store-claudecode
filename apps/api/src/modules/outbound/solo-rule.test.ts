import { describe, it, expect } from 'vitest';
import { soloRefusal, type SoloContext } from './solo-rule';

// The one rule the checkout, the previews and the managers' waiting list all read (docs/28 D6).
describe('soloRefusal: may the munshi finish this withdrawal alone?', () => {
  const on: SoloContext = { soloOn: true, perTonCharges: 0, today: '2026-11-08' };
  const pacci = { bookType: 'PACCI' };
  const today = new Date('2026-11-08T00:00:00.000Z');
  const yesterday = new Date('2026-11-07T00:00:00.000Z');

  it('returns SOLO_OFF before anything else', () => {
    expect(soloRefusal({ ...on, soloOn: false, perTonCharges: 2 }, { bookType: 'KATCHI' }, yesterday)).toBe('SOLO_OFF');
  });

  it('then KATCHI, then NOT_TODAY, then PER_TON_CHARGE', () => {
    expect(soloRefusal({ ...on, perTonCharges: 1 }, { bookType: 'KATCHI' }, yesterday)).toBe('KATCHI');
    expect(soloRefusal({ ...on, perTonCharges: 1 }, pacci, yesterday)).toBe('NOT_TODAY');
    expect(soloRefusal({ ...on, perTonCharges: 1 }, pacci, today)).toBe('PER_TON_CHARGE');
  });

  it('a PACCI withdrawal dated today with no per-ton charge passes', () => {
    expect(soloRefusal(on, pacci, today)).toBeNull();
  });
});
