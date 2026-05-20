/**
 * Global setup runs once before any spec. We just hit /v1/_test/reset to
 * wipe the operational tables on the e2e facility. Individual specs may
 * call resetFacility() again from their own beforeEach if they need a
 * clean slate.
 */
import { resetFacility } from './fixtures';

export default async function globalSetup() {
  await resetFacility();
}
