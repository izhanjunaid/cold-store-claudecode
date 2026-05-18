export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function parseDateOnly(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}
