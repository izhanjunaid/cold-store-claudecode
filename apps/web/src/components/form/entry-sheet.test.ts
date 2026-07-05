import { describe, expect, it } from 'vitest';
import { isEnterAdvanceTarget, nextFocusable } from './entry-sheet';

function fakeEl(tagName: string, role: string | null = null) {
  return { tagName, getAttribute: (n: string) => (n === 'role' ? role : null) };
}

describe('isEnterAdvanceTarget', () => {
  it('advances from plain inputs and selects', () => {
    expect(isEnterAdvanceTarget(fakeEl('INPUT'))).toBe(true);
    expect(isEnterAdvanceTarget(fakeEl('SELECT'))).toBe(true);
  });

  it('leaves Enter alone in textareas (newline)', () => {
    expect(isEnterAdvanceTarget(fakeEl('TEXTAREA'))).toBe(false);
  });

  it('leaves Enter alone on buttons and comboboxes (activate/open)', () => {
    expect(isEnterAdvanceTarget(fakeEl('BUTTON'))).toBe(false);
    expect(isEnterAdvanceTarget(fakeEl('BUTTON', 'combobox'))).toBe(false);
    expect(isEnterAdvanceTarget(fakeEl('INPUT', 'combobox'))).toBe(false);
  });
});

describe('nextFocusable', () => {
  const a = {} as HTMLElement;
  const b = {} as HTMLElement;
  const c = {} as HTMLElement;

  it('returns the element after the current one', () => {
    expect(nextFocusable([a, b, c], a)).toBe(b);
    expect(nextFocusable([a, b, c], b)).toBe(c);
  });

  it('returns null on the last element (caller submits)', () => {
    expect(nextFocusable([a, b, c], c)).toBeNull();
  });

  it('returns null when current is not in the list', () => {
    expect(nextFocusable([a, b], c)).toBeNull();
  });
});
