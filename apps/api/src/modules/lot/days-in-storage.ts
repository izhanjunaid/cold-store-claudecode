const DAY_MS = 24 * 60 * 60 * 1000;

export function daysInStorage(inboundDate: Date, asOf: Date = new Date()): number {
  const diff = Math.floor((asOf.getTime() - inboundDate.getTime()) / DAY_MS);
  return Math.max(0, diff);
}
