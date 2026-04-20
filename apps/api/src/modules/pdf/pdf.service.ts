import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { join } from 'path';

// Register equality helper used in the template
Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);

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

export function renderStorageReceiptHtml(data: StorageReceiptData): string {
  return getTemplate()(data);
}

export function renderTransferAcknowledgmentHtml(data: TransferAcknowledgmentData): string {
  return getTransferTemplate()(data);
}

export async function renderStorageReceipt(data: StorageReceiptData): Promise<Buffer> {
  const html = renderStorageReceiptHtml(data);

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
): Promise<Buffer> {
  const html = renderTransferAcknowledgmentHtml(data);

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

export function renderInvoiceHtml(data: InvoicePdfData): string {
  return getInvoiceTemplate()(data);
}

export async function renderInvoice(data: InvoicePdfData): Promise<Buffer> {
  const html = renderInvoiceHtml(data);

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
