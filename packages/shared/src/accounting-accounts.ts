/**
 * Account-code routing shared by the API and the web client.
 *
 * This lives in `shared` rather than in the API's journal-entry templates because the
 * mapping was being re-derived in the browser (`method === 'CASH' ? '1010' : '1020'`),
 * which silently mis-routes anything that is not CASH — MOBILE_WALLET belongs to 1030,
 * not 1020. One definition, consumed by both sides.
 *
 * Only routing that is genuinely duplicated lives here. Account codes that are part of
 * the accounting *definition* of a journal template (2010, 2040, 6080 …) stay next to
 * the templates that use them.
 */

/** Where a receipt or disbursement lands, by payment method. */
export const PAYMENT_METHOD_ASSET_ACCOUNT: Record<string, string> = {
  CASH: '1010',
  CHEQUE: '1020',
  BANK_TRANSFER: '1020',
  MOBILE_WALLET: '1030',
};

/**
 * The default "paid from / paid into" account offered when a caller does not choose one.
 * Named so the intent is visible at the call sites that previously hardcoded '1020'.
 */
export const DEFAULT_BANK_ACCOUNT_CODE = '1020';

/**
 * Payment methods are a closed enum: an unmapped value is a programming error, and a
 * silent fallback would misclassify the posting (audit finding F-10). Fail loudly.
 */
export function assetAccountForPaymentMethod(method: string): string {
  const account = PAYMENT_METHOD_ASSET_ACCOUNT[method];
  if (!account) throw new Error(`No asset account mapping for payment method '${method}'`);
  return account;
}

/**
 * Where a *received* payment lands, by payment method (phase/25).
 *
 * Deliberately separate from assetAccountForPaymentMethod/PAYMENT_METHOD_ASSET_ACCOUNT,
 * which is shared by disbursement flows too (peshgi issuance, employee-advance issuance,
 * expense payments) where a cheque the facility *writes* is still an immediate bank
 * movement. A cheque the facility *receives* is not yet bank funds — it can still bounce —
 * so it parks in 1025 "Cheques in Hand (Under Collection)" until POST
 * /v1/payments/:id/clear moves it to 1020. Every other payment method is unaffected and
 * simply delegates to the shared mapping.
 */
export function receiptAssetAccountForPaymentMethod(method: string): string {
  if (method === 'CHEQUE') return '1025';
  return assetAccountForPaymentMethod(method);
}
