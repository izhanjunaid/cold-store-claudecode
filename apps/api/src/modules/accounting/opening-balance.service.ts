import type { PrismaClient } from '@coldchain/db';
import type { EnterOpeningBalancesRequestType } from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { arAccountForParty, type JournalEntryLineDraft } from './templates/types';
import type { JournalEntryService } from './journal-entry.service';

/**
 * Guided opening balances (audit Gap 1): one balanced PACCI entry holding
 * per-party AR lines, cash/bank, and any other balance-sheet lines, with the
 * difference plugged to 3010 Owner's Capital. One-shot — a facility carries
 * exactly one active opening entry; redoing it means reversing the first.
 */

// Per-party receivables must go through party_receivables (they need party
// attribution); peshgi balances belong to the Peshgi module (they need a
// loan record to drive recovery).
const BLOCKED_OTHER_LINE_CODES = new Set(['1110', '1120', '1130', '1140', '1150']);

const EQUITY_PLUG_ACCOUNT = '3010';
const CASH_ACCOUNT = '1010';
const BANK_ACCOUNT = '1020';

export class OpeningBalanceService {
  constructor(
    private prisma: PrismaClient,
    private journalEntry: JournalEntryService,
  ) {}

  async getStatus(facilityId: string) {
    const existing = await this.prisma.journalEntry.findFirst({
      where: { facilityId, sourceTable: 'opening_balances', postingStatus: 'POSTED' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, entryNumber: true, entryDate: true },
    });
    return {
      entered: existing !== null,
      journal_entry_id: existing?.id ?? null,
      entry_number: existing?.entryNumber ?? null,
      as_of_date: existing?.entryDate.toISOString().slice(0, 10) ?? null,
    };
  }

  async enter(facilityId: string, userId: string, body: EnterOpeningBalancesRequestType): Promise<string> {
    for (const line of body.other_lines) {
      if (BLOCKED_OTHER_LINE_CODES.has(line.account_code)) {
        throw Errors.VALIDATION_ERROR(
          `Account ${line.account_code} cannot be used here — enter party receivables under party_receivables and outstanding peshgi through the Peshgi module`,
          'other_lines',
        );
      }
      if (line.debit_pkr > 0 && line.credit_pkr > 0) {
        throw Errors.VALIDATION_ERROR('A line cannot have both debit and credit amounts', 'other_lines');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.journalEntry.findFirst({
        where: { facilityId, sourceTable: 'opening_balances', postingStatus: 'POSTED' },
      });
      if (existing) throw Errors.OPENING_BALANCES_ALREADY_ENTERED();

      const lines: JournalEntryLineDraft[] = [];

      for (const pr of body.party_receivables) {
        const party = await tx.party.findFirst({ where: { id: pr.party_id, facilityId } });
        if (!party) throw Errors.VALIDATION_ERROR(`Party ${pr.party_id} not found`, 'party_receivables');
        lines.push({
          accountCode: arAccountForParty(party.partyType),
          debitAmount: pr.amount_pkr,
          creditAmount: 0,
          partyId: party.id,
          description: `Opening receivable — ${party.name}`,
        });
      }
      if (body.cash_pkr > 0) {
        lines.push({ accountCode: CASH_ACCOUNT, debitAmount: body.cash_pkr, creditAmount: 0, description: 'Opening cash on hand' });
      }
      if (body.bank_pkr > 0) {
        lines.push({ accountCode: BANK_ACCOUNT, debitAmount: body.bank_pkr, creditAmount: 0, description: 'Opening bank balance' });
      }
      for (const ol of body.other_lines) {
        if (ol.debit_pkr === 0 && ol.credit_pkr === 0) continue;
        lines.push({
          accountCode: ol.account_code,
          debitAmount: ol.debit_pkr,
          creditAmount: ol.credit_pkr,
          description: ol.description ?? 'Opening balance',
        });
      }

      if (lines.length === 0) {
        throw Errors.VALIDATION_ERROR('Nothing to post — every opening amount is zero');
      }

      const totalDebit = lines.reduce((s, l) => s + Number(l.debitAmount ?? 0), 0);
      const totalCredit = lines.reduce((s, l) => s + Number(l.creditAmount ?? 0), 0);
      const net = Math.round((totalDebit - totalCredit) * 100) / 100;
      if (net > 0) {
        lines.push({ accountCode: EQUITY_PLUG_ACCOUNT, debitAmount: 0, creditAmount: net, description: 'Opening net assets — owner capital' });
      } else if (net < 0) {
        lines.push({ accountCode: EQUITY_PLUG_ACCOUNT, debitAmount: -net, creditAmount: 0, description: 'Opening net liabilities — owner capital' });
      }

      const posted = await this.journalEntry.postInTransaction(tx, facilityId, userId, {
        entryType: 'ADJUSTMENT',
        bookType: 'PACCI',
        sourceTable: 'opening_balances',
        sourceId: facilityId,
        entryDate: new Date(body.as_of_date),
        description: `Opening balances as of ${body.as_of_date}`,
        lines,
      });
      return posted.id;
    });
  }
}
