import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { join } from 'path';

// Register equality helper used in the template
Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);

/** Facility `number_format`. en-PK groups internationally; only en-IN is lakh/crore. */
export type PdfNumberLocale = 'en-PK' | 'en-IN';

export const DEFAULT_PDF_LOCALE: PdfNumberLocale = 'en-PK';

/**
 * `{{money x}}` — the only way an amount should reach a PDF.
 *
 * Templates previously interpolated raw numbers, so an invoice printed
 * `1234567.5` and a salary slip `45000`. Two decimals always: these are
 * documents a customer or an employee is handed and reconciles against, and a
 * dropped trailing zero reads as a different number.
 *
 * The locale is read from the render root rather than module state, so two
 * facilities rendering concurrently cannot pick up each other's setting.
 */
Handlebars.registerHelper('money', function (value: unknown, options: Handlebars.HelperOptions) {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  const locale = (options?.data?.root?.numberLocale as PdfNumberLocale) ?? DEFAULT_PDF_LOCALE;
  return n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
});

export interface StorageReceiptData {
  // Facility
  facilityName: string;
  facilityCity: string;
  // Lot
  lotNumber: string;
  inboundDate: string;
  entryDate: string;
  // Owner
  ownerName: string;
  ownerNameUrdu: string | null;
  // Commodity
  commodityName: string;
  varietyName: string | null;
  // Quantities & weight
  quantityBags: number;
  acceptedWeightKg: number;
  declaredWeightKg: number | null;
  weightDisputeFlag: boolean;
  weightDisputeNote: string | null;
  // Quality
  qualityGradeInbound: string | null;
  // Chamber
  chamberName: string;
  // Rate plan
  ratePlanName: string;
  rateAmountPkr: number;
  rateType: string;
  // Vehicle & operator
  vehicleNumber: string | null;
  operatorName: string;
  // Book type
  bookType: string;
  // Marka (goods-identification mark on the bardana/crates)
  marka?: string | null;
}

export interface TransferAcknowledgmentData {
  facilityName: string;
  facilityCity: string;
  parentLotNumber: string;
  childLotNumber: string | null;
  fromPartyName: string;
  fromPartyNameUrdu: string | null;
  toPartyName: string;
  toPartyNameUrdu: string | null;
  commodityName: string;
  varietyName: string | null;
  quantityBags: number;
  transferPricePkr: number | null;
  effectiveDate: string;
  operatorName: string;
  notes: string | null;
  transferType: 'FULL' | 'PARTIAL';
}

export interface DispatchNoteData {
  facilityName: string;
  facilityCity: string;
  dispatchNoteNumber: string;
  lotNumber: string;
  outboundDate: string;
  withdrawalType: string;
  commodityName: string;
  quantityWithdrawnBags: number;
  outboundWeightKg: number | null;
  receivingPartyName: string | null;
  vehicleNumber: string | null;
  marka?: string | null;
  operatorName: string;
}

let _template: HandlebarsTemplateDelegate | null = null;
let _transferTemplate: HandlebarsTemplateDelegate | null = null;
let _dispatchNoteTemplate: HandlebarsTemplateDelegate | null = null;

function getTemplate(): HandlebarsTemplateDelegate {
  if (!_template) {
    const templatePath = join(__dirname, 'templates', 'storage-receipt.html');
    const source = readFileSync(templatePath, 'utf-8');
    _template = Handlebars.compile(source);
  }
  return _template;
}

function getTransferTemplate(): HandlebarsTemplateDelegate {
  if (!_transferTemplate) {
    const templatePath = join(__dirname, 'templates', 'transfer-acknowledgment.html');
    const source = readFileSync(templatePath, 'utf-8');
    _transferTemplate = Handlebars.compile(source);
  }
  return _transferTemplate;
}

function getDispatchNoteTemplate(): HandlebarsTemplateDelegate {
  if (!_dispatchNoteTemplate) {
    const templatePath = join(__dirname, 'templates', 'dispatch-note.html');
    const source = readFileSync(templatePath, 'utf-8');
    _dispatchNoteTemplate = Handlebars.compile(source);
  }
  return _dispatchNoteTemplate;
}

export function renderStorageReceiptHtml(
  data: StorageReceiptData,
  numberLocale: PdfNumberLocale = DEFAULT_PDF_LOCALE,
): string {
  return getTemplate()({ ...data, numberLocale });
}

export function renderTransferAcknowledgmentHtml(
  data: TransferAcknowledgmentData,
  numberLocale: PdfNumberLocale = DEFAULT_PDF_LOCALE,
): string {
  return getTransferTemplate()({ ...data, numberLocale });
}

export async function renderStorageReceipt(
  data: StorageReceiptData,
  numberLocale: PdfNumberLocale = DEFAULT_PDF_LOCALE,
): Promise<Buffer> {
  const html = renderStorageReceiptHtml(data, numberLocale);

  // Lazy import puppeteer so tests that mock this module don't need Chromium
  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A5',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

export async function renderTransferAcknowledgment(
  data: TransferAcknowledgmentData,
  numberLocale: PdfNumberLocale = DEFAULT_PDF_LOCALE,
): Promise<Buffer> {
  const html = renderTransferAcknowledgmentHtml(data, numberLocale);

  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A5',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

export function renderDispatchNoteHtml(data: DispatchNoteData): string {
  return getDispatchNoteTemplate()(data);
}

export async function renderDispatchNote(data: DispatchNoteData): Promise<Buffer> {
  const html = renderDispatchNoteHtml(data);

  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A5',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

export interface InvoicePdfData {
  facilityName: string;
  facilityCity: string;
  invoiceNumber: string;
  lotNumber: string;
  billingPartyName: string;
  invoiceDate: string;
  periodStart: string;
  periodEnd: string;
  subTotalPkr: number;
  discountLabel: string | null;
  discountAmountPkr: number;
  gstRate: number;
  gstAmountPkr: number;
  totalPkr: number;
  amountPaidPkr: number;
  balanceDuePkr: number;
  status: string;
  isDraft: boolean;
  lineItems: {
    lineType: string;
    description: string;
    quantity: number;
    unitPricePkr: number;
    amountPkr: number;
  }[];
}

let _invoiceTemplate: HandlebarsTemplateDelegate | null = null;

function getInvoiceTemplate(): HandlebarsTemplateDelegate {
  if (!_invoiceTemplate) {
    const templatePath = join(__dirname, 'templates', 'invoice.html');
    const source = readFileSync(templatePath, 'utf-8');
    _invoiceTemplate = Handlebars.compile(source);
  }
  return _invoiceTemplate;
}

export function renderInvoiceHtml(
  data: InvoicePdfData,
  numberLocale: PdfNumberLocale = DEFAULT_PDF_LOCALE,
): string {
  return getInvoiceTemplate()({ ...data, numberLocale });
}

export async function renderInvoice(
  data: InvoicePdfData,
  numberLocale: PdfNumberLocale = DEFAULT_PDF_LOCALE,
): Promise<Buffer> {
  const html = renderInvoiceHtml(data, numberLocale);

  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A5',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

export interface PartyStatementData {
  facilityName: string;
  facilityCity: string;
  partyName: string;
  partyNameUrdu: string | null;
  partyType: string;
  cnic: string | null;
  bookType: string;
  fromDate: string | null;
  toDate: string | null;
  generatedAt: string;
  openingBalancePkr: number;
  totalDebitPkr: number;
  totalCreditPkr: number;
  closingBalancePkr: number;
  entries: Array<{
    date: string;
    type: string;
    reference: string | null;
    description: string;
    debitPkr: number;
    creditPkr: number;
    balancePkr: number;
  }>;
}

let _partyStatementTemplate: HandlebarsTemplateDelegate | null = null;

function getPartyStatementTemplate(): HandlebarsTemplateDelegate {
  if (!_partyStatementTemplate) {
    const templatePath = join(__dirname, 'templates', 'party-statement.html');
    const source = readFileSync(templatePath, 'utf-8');
    _partyStatementTemplate = Handlebars.compile(source);
  }
  return _partyStatementTemplate;
}

export function renderPartyStatementHtml(
  data: PartyStatementData,
  numberLocale: PdfNumberLocale = DEFAULT_PDF_LOCALE,
): string {
  return getPartyStatementTemplate()({ ...data, numberLocale });
}

export async function renderPartyStatement(
  data: PartyStatementData,
  numberLocale: PdfNumberLocale = DEFAULT_PDF_LOCALE,
): Promise<Buffer> {
  const html = renderPartyStatementHtml(data, numberLocale);

  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A5',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

// ============================================================================
// Phase 11 — Deferred PDFs (salary slip, loan acknowledgment, gate pass receipt)
// ============================================================================

async function htmlToA5Pdf(html: string): Promise<Buffer> {
  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A5',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

export interface SalarySlipData {
  facilityName: string;
  runNumber: string;
  payrollPeriod: string;
  employeeName: string;
  employeeNameUrdu: string | null;
  employeeCnic: string | null;
  employeeDesignation: string | null;
  daysWorked: number | null;
  grossPay: number;
  eobiEmployee: number;
  incomeTax: number;
  otherDeductions: number;
  advanceRecovery: number;
  netPay: number;
}

let _salarySlipTemplate: HandlebarsTemplateDelegate | null = null;
function getSalarySlipTemplate(): HandlebarsTemplateDelegate {
  if (!_salarySlipTemplate) {
    const templatePath = join(__dirname, 'templates', 'salary-slip.html');
    const source = readFileSync(templatePath, 'utf-8');
    _salarySlipTemplate = Handlebars.compile(source);
  }
  return _salarySlipTemplate;
}

export function renderSalarySlipHtml(
  data: SalarySlipData,
  numberLocale: PdfNumberLocale = DEFAULT_PDF_LOCALE,
): string {
  return getSalarySlipTemplate()({ ...data, numberLocale });
}

export async function renderSalarySlip(
  data: SalarySlipData,
  numberLocale: PdfNumberLocale = DEFAULT_PDF_LOCALE,
): Promise<Buffer> {
  return htmlToA5Pdf(renderSalarySlipHtml(data, numberLocale));
}

export interface LoanAcknowledgmentData {
  facilityName: string;
  facilityCity: string;
  loanNumber: string;
  partyName: string;
  partyNameUrdu: string | null;
  issueDate: string;
  principalPkr: number;
  sourceAssetAccountCode: string;
  journalEntryId: string | null;
  notes: string | null;
}

let _loanAckTemplate: HandlebarsTemplateDelegate | null = null;
function getLoanAcknowledgmentTemplate(): HandlebarsTemplateDelegate {
  if (!_loanAckTemplate) {
    const templatePath = join(__dirname, 'templates', 'loan-acknowledgment.html');
    const source = readFileSync(templatePath, 'utf-8');
    _loanAckTemplate = Handlebars.compile(source);
  }
  return _loanAckTemplate;
}

export function renderLoanAcknowledgmentHtml(
  data: LoanAcknowledgmentData,
  numberLocale: PdfNumberLocale = DEFAULT_PDF_LOCALE,
): string {
  return getLoanAcknowledgmentTemplate()({ ...data, numberLocale });
}

export async function renderLoanAcknowledgment(
  data: LoanAcknowledgmentData,
  numberLocale: PdfNumberLocale = DEFAULT_PDF_LOCALE,
): Promise<Buffer> {
  return htmlToA5Pdf(renderLoanAcknowledgmentHtml(data, numberLocale));
}

export interface GatePassReceiptData {
  facilityName: string;
  facilityCity: string;
  passNumber: string;
  direction: 'INWARD' | 'OUTWARD';
  vehicleNumber: string;
  driverName: string | null;
  driverPhone: string | null;
  biltyNumber: string | null;
  status: string;
  relatedLotNumber: string | null;
  relatedDispatchNoteNumber: string | null;
  commodityName?: string | null;
  marka?: string | null;
  unitLabel?: string | null;
  declaredQuantity?: number | null;
  authorizedQuantity?: number | null;
  quantityMismatch?: boolean;
  depositorName?: string | null;
  ownerName?: string | null;
  createdAt: string;
  clearedAt: string | null;
  turnaroundLabel: string | null;
  notes: string | null;
}

let _gatePassReceiptTemplate: HandlebarsTemplateDelegate | null = null;
function getGatePassReceiptTemplate(): HandlebarsTemplateDelegate {
  if (!_gatePassReceiptTemplate) {
    const templatePath = join(__dirname, 'templates', 'gate-pass-receipt.html');
    const source = readFileSync(templatePath, 'utf-8');
    _gatePassReceiptTemplate = Handlebars.compile(source);
  }
  return _gatePassReceiptTemplate;
}

export function renderGatePassReceiptHtml(data: GatePassReceiptData): string {
  const hasGoodsInfo = Boolean(
    data.commodityName ||
      data.marka ||
      data.declaredQuantity != null ||
      data.authorizedQuantity != null ||
      data.depositorName ||
      data.ownerName ||
      data.quantityMismatch,
  );
  return getGatePassReceiptTemplate()({ ...data, hasGoodsInfo });
}

export async function renderGatePassReceipt(data: GatePassReceiptData): Promise<Buffer> {
  return htmlToA5Pdf(renderGatePassReceiptHtml(data));
}

// ============================================================================
// Phase 14 — Rooms & Racks (placement slip, rack labels)
// ============================================================================

export interface PlacementSlipData {
  facilityName: string;
  facilityCity: string;
  lotNumber: string;
  ownerName: string;
  commodityName: string;
  varietyName: string | null;
  marka: string | null;
  roomName: string;
  placements: { rackName: string; bags: number }[];
  unplacedBags: number;
  totalBags: number;
  operatorName: string;
  generatedAt: string;
}

let _placementSlipTemplate: HandlebarsTemplateDelegate | null = null;
function getPlacementSlipTemplate(): HandlebarsTemplateDelegate {
  if (!_placementSlipTemplate) {
    const templatePath = join(__dirname, 'templates', 'placement-slip.html');
    const source = readFileSync(templatePath, 'utf-8');
    _placementSlipTemplate = Handlebars.compile(source);
  }
  return _placementSlipTemplate;
}

export function renderPlacementSlipHtml(data: PlacementSlipData): string {
  return getPlacementSlipTemplate()(data);
}

export async function renderPlacementSlip(data: PlacementSlipData): Promise<Buffer> {
  return htmlToA5Pdf(renderPlacementSlipHtml(data));
}

export interface RackLabelsData {
  facilityName: string;
  roomName: string;
  racks: { name: string; maxCapacityBags: number }[];
}

let _rackLabelsTemplate: HandlebarsTemplateDelegate | null = null;
function getRackLabelsTemplate(): HandlebarsTemplateDelegate {
  if (!_rackLabelsTemplate) {
    const templatePath = join(__dirname, 'templates', 'rack-labels.html');
    const source = readFileSync(templatePath, 'utf-8');
    _rackLabelsTemplate = Handlebars.compile(source);
  }
  return _rackLabelsTemplate;
}

export function renderRackLabelsHtml(data: RackLabelsData): string {
  return getRackLabelsTemplate()(data);
}

/** Rack labels print on A4 — four large cut-out labels per sheet. */
export async function renderRackLabels(data: RackLabelsData): Promise<Buffer> {
  const html = renderRackLabelsHtml(data);

  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
