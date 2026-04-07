import { describe, it, expect } from 'vitest';
import { AppError, Errors } from './errors';

describe('AppError', () => {
  it('creates error with correct properties', () => {
    const err = new AppError('TEST_CODE', 'test message', 422, 'field_name');
    expect(err.code).toBe('TEST_CODE');
    expect(err.message).toBe('test message');
    expect(err.statusCode).toBe(422);
    expect(err.field).toBe('field_name');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('Errors factory', () => {
  it('AUTH_INVALID returns 401', () => {
    const err = Errors.AUTH_INVALID();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('AUTH_INVALID');
  });

  it('FORBIDDEN returns 403', () => {
    const err = Errors.FORBIDDEN();
    expect(err.statusCode).toBe(403);
  });

  it('LOT_BALANCE_INSUFFICIENT includes bag counts', () => {
    const err = Errors.LOT_BALANCE_INSUFFICIENT(10, 20);
    expect(err.message).toContain('20');
    expect(err.message).toContain('10');
    expect(err.field).toBe('quantity_withdrawn_bags');
  });

  it('VALIDATION_ERROR accepts custom message and field', () => {
    const err = Errors.VALIDATION_ERROR('bad input', 'email');
    expect(err.statusCode).toBe(400);
    expect(err.field).toBe('email');
  });
});
