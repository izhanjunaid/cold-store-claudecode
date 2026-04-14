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

let _template: HandlebarsTemplateDelegate | null = null;

function getTemplate(): HandlebarsTemplateDelegate {
  if (!_template) {
    const templatePath = join(__dirname, 'templates', 'storage-receipt.html');
    const source = readFileSync(templatePath, 'utf-8');
    _template = Handlebars.compile(source);
  }
  return _template;
}

export function renderStorageReceiptHtml(data: StorageReceiptData): string {
  return getTemplate()(data);
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
