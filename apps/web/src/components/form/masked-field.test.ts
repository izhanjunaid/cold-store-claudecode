import { describe, expect, it } from 'vitest';
import { __maskTestExports } from './masks';

const { maskPhone, maskCnic, maskVehicle } = __maskTestExports;

describe('maskPhone', () => {
  it('formats as 04-digit prefix then dash', () => {
    expect(maskPhone('03001234567')).toBe('0300-1234567');
  });
  it('strips non-digits and caps at 11 digits', () => {
    expect(maskPhone('0300-123-4567-99')).toBe('0300-1234567');
  });
  it('leaves short input undashed', () => {
    expect(maskPhone('030')).toBe('030');
  });
});

describe('maskCnic', () => {
  it('formats #####-#######-#', () => {
    expect(maskCnic('3520112345671')).toBe('35201-1234567-1');
  });
  it('caps at 13 digits', () => {
    expect(maskCnic('3520112345671999')).toBe('35201-1234567-1');
  });
});

describe('maskVehicle', () => {
  it('uppercases and keeps alphanumerics, dash, space', () => {
    expect(maskVehicle('lea-1234')).toBe('LEA-1234');
  });
  it('drops disallowed characters', () => {
    expect(maskVehicle('le@a#12')).toBe('LEA12');
  });
});

describe('maskVehicle length', () => {
  it('keeps up to 30 characters — as long as a gate pass, a withdrawal and a lot take', () => {
    const thirty = 'LHR-1234567890-ABCDEFGHIJ-5678';
    expect(thirty).toHaveLength(30);
    expect(maskVehicle(thirty)).toBe(thirty);
    expect(maskVehicle(`${thirty}XYZ`)).toBe(thirty);
  });
});
