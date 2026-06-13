import { describe, expect, it, vi } from 'vitest';
import { applyApiErrorToForm } from './form-errors';
import { ApiError } from './api-client';

describe('applyApiErrorToForm', () => {
  it('applies a field error when the API names a field', () => {
    const setError = vi.fn();
    const err = new ApiError('Email already exists', {
      code: 'USER_EMAIL_TAKEN',
      status: 409,
      details: { code: 'USER_EMAIL_TAKEN', message: 'Email already exists', field: 'email' },
    });
    const applied = applyApiErrorToForm(err, setError);
    expect(applied).toBe(true);
    expect(setError).toHaveBeenCalledWith('email', {
      type: 'server',
      message: 'Email already exists',
    });
  });

  it('remaps API field names to form field names', () => {
    const setError = vi.fn();
    const err = new ApiError('bad', {
      code: 'X',
      status: 422,
      details: { field: 'quantity_withdrawn_bags' },
    });
    applyApiErrorToForm(err, setError, { quantity_withdrawn_bags: 'quantity' as never });
    expect(setError).toHaveBeenCalledWith('quantity', expect.anything());
  });

  it('returns false when no field is present (caller should toast)', () => {
    const setError = vi.fn();
    const err = new ApiError('Chamber full', {
      code: 'CHAMBER_CAPACITY_EXCEEDED',
      status: 422,
      details: { code: 'CHAMBER_CAPACITY_EXCEEDED', message: 'Chamber full' },
    });
    expect(applyApiErrorToForm(err, setError)).toBe(false);
    expect(setError).not.toHaveBeenCalled();
  });

  it('returns false for non-ApiError values', () => {
    const setError = vi.fn();
    expect(applyApiErrorToForm(new Error('network'), setError)).toBe(false);
    expect(applyApiErrorToForm(null, setError)).toBe(false);
  });
});
