/**
 * A stored weight, or null when none was recorded (docs/27). A lot stores 0 for "not weighed":
 * its column stays NOT NULL so an older image can still read every lot after a rollback.
 * Every reader of a lot's weight goes through this, never `Number()`.
 */
export function recordedKg(v: { toString(): string } | null | undefined): number | null {
  const kg = v == null ? 0 : Number(v);
  return kg > 0 ? kg : null;
}
