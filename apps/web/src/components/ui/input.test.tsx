import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Input } from './input';

describe('Input — wheel guard (P2-1)', () => {
  it('blurs a focused number input on wheel, so the value cannot scroll-change', () => {
    render(<Input type="number" defaultValue={100} aria-label="amount" />);
    const el = screen.getByLabelText('amount') as HTMLInputElement;

    el.focus();
    expect(document.activeElement).toBe(el);

    fireEvent.wheel(el, { deltaY: -100 });
    expect(document.activeElement).not.toBe(el);
  });

  it('leaves non-number inputs focused — only numbers are scroll-mutable', () => {
    render(<Input type="text" defaultValue="abc" aria-label="note" />);
    const el = screen.getByLabelText('note') as HTMLInputElement;

    el.focus();
    fireEvent.wheel(el, { deltaY: -100 });
    expect(document.activeElement).toBe(el);
  });

  it('still calls a caller-supplied onWheel', () => {
    const onWheel = vi.fn();
    render(<Input type="number" onWheel={onWheel} aria-label="amount" />);

    fireEvent.wheel(screen.getByLabelText('amount'), { deltaY: -100 });
    expect(onWheel).toHaveBeenCalledOnce();
  });
});
