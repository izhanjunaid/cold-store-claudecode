export type Mask = 'phone' | 'cnic' | 'vehicle';

/** Pakistani phone: 03XX-XXXXXXX (11 digits). */
function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 4) return digits;
  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

/** CNIC: #####-#######-# (13 digits). */
function maskCnic(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 13);
  if (digits.length <= 5) return digits;
  if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

/** Vehicle plate: uppercase, alphanumerics + dash/space. */
function maskVehicle(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9 -]/g, '')
    .slice(0, 20);
}

export const MASKS: Record<Mask, (raw: string) => string> = {
  phone: maskPhone,
  cnic: maskCnic,
  vehicle: maskVehicle,
};

export const MASK_PLACEHOLDER: Record<Mask, string> = {
  phone: '0300-1234567',
  cnic: '35201-1234567-1',
  vehicle: 'LEA-1234',
};

/** Exposed for unit tests only. */
export const __maskTestExports = { maskPhone, maskCnic, maskVehicle };
