import type { Prisma, PrismaClient } from '@coldchain/db';
import {
  businessDate,
  fromIsoDate,
  round2,
  type CreateCreditApprovalRequestType,
  type CreditApprovalResponseType,
} from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { advisoryXactLock } from '../../common/advisory-lock';
import { creditExposure } from '../invoice/receivables';

type Db = PrismaClient | Prisma.TransactionClient;

export type ActiveApproval = {
  id: string;
  partyId: string;
  maxOutstandingPkr: number;
  validUntil: Date | null;
  approvedBy: string;
};

const expired = (validUntil: Date | null) => validUntil != null && validUntil < fromIsoDate(businessDate());

/** The party's live approval, unless it has lapsed (`valid_until` is the last business day it holds). */
export async function findActiveApproval(db: Db, facilityId: string, partyId: string): Promise<ActiveApproval | null> {
  const row = await db.partyCreditApproval.findFirst({ where: { facilityId, partyId, revokedAt: null } });
  if (!row || expired(row.validUntil)) return null;
  return {
    id: row.id,
    partyId: row.partyId,
    maxOutstandingPkr: Number(row.maxOutstandingPkr),
    validUntil: row.validUntil,
    approvedBy: row.approvedBy,
  };
}

/** What a truck still owes, per billing party, that a standing approval would have to cover. */
export type PartyCreditNeed = {
  partyId: string;
  /** Cheques recorded but not cleared: owed at the gate, though the ledger already counts them paid. */
  uncleared: number;
};

/**
 * Does a standing approval cover every party that still owes on a truck? Each party needs a
 * live approval whose ceiling holds its whole exposure (both books, from the ledger — the
 * truck's own finalized bills are already in it) plus its uncleared cheques. One helper for the
 * gate preview and the release, so the guard is never shown READY for a truck the release then refuses.
 */
export async function standingCreditCover(
  db: Db,
  facilityId: string,
  needs: PartyCreditNeed[],
): Promise<{ covered: boolean; approvals: ActiveApproval[] }> {
  const approvals: ActiveApproval[] = [];
  if (needs.length === 0) return { covered: false, approvals };
  for (const need of needs) {
    const approval = await findActiveApproval(db, facilityId, need.partyId);
    if (!approval) return { covered: false, approvals: [] };
    const exposure = await creditExposure(db, facilityId, need.partyId);
    if (round2(exposure + need.uncleared) > approval.maxOutstandingPkr + 0.005) return { covered: false, approvals: [] };
    approvals.push(approval);
  }
  return { covered: true, approvals };
}

export class CreditApprovalService {
  constructor(private prisma: PrismaClient) {}

  async get(facilityId: string, partyId: string, canSeeAmount: boolean): Promise<CreditApprovalResponseType> {
    await this.assertParty(this.prisma, facilityId, partyId);
    const row = await this.prisma.partyCreditApproval.findFirst({ where: { facilityId, partyId, revokedAt: null } });
    return this.format(this.prisma, row, canSeeAmount);
  }

  /** Approve (or replace the approval of) a party. The old one is revoked, not edited, so the history stays. */
  async grant(
    facilityId: string,
    partyId: string,
    userId: string,
    body: CreateCreditApprovalRequestType,
  ): Promise<CreditApprovalResponseType> {
    if (body.valid_until && body.valid_until < businessDate()) {
      throw Errors.VALIDATION_ERROR('The approval would already have lapsed: pick today or a later date', 'valid_until');
    }
    return this.prisma.$transaction(async (tx) => {
      await advisoryXactLock(tx, `${facilityId}:credit-approval:${partyId}`);
      await this.assertParty(tx, facilityId, partyId);
      const now = new Date();
      await tx.partyCreditApproval.updateMany({
        where: { facilityId, partyId, revokedAt: null },
        data: { revokedAt: now, revokedBy: userId, revokeReason: 'Replaced by a new approval' },
      });
      const row = await tx.partyCreditApproval.create({
        data: {
          facilityId,
          partyId,
          maxOutstandingPkr: body.max_outstanding_pkr,
          validUntil: body.valid_until ? fromIsoDate(body.valid_until) : null,
          approvedBy: userId,
          approvedAt: now,
          note: body.note?.trim() || null,
        },
      });
      return this.format(tx, row, true);
    });
  }

  async revoke(facilityId: string, partyId: string, userId: string, reason: string): Promise<CreditApprovalResponseType> {
    return this.prisma.$transaction(async (tx) => {
      await advisoryXactLock(tx, `${facilityId}:credit-approval:${partyId}`);
      await this.assertParty(tx, facilityId, partyId);
      const { count } = await tx.partyCreditApproval.updateMany({
        where: { facilityId, partyId, revokedAt: null },
        data: { revokedAt: new Date(), revokedBy: userId, revokeReason: reason },
      });
      if (count === 0) throw Errors.VALIDATION_ERROR('This party has no standing credit approval to revoke');
      return this.format(tx, null, true);
    });
  }

  private async assertParty(db: Db, facilityId: string, partyId: string) {
    const party = await db.party.findFirst({ where: { id: partyId, facilityId }, select: { id: true } });
    if (!party) throw Errors.PARTY_NOT_FOUND();
  }

  private async format(
    db: Db,
    row: {
      id: string;
      maxOutstandingPkr: Prisma.Decimal;
      validUntil: Date | null;
      approvedBy: string;
      approvedAt: Date;
      note: string | null;
    } | null,
    canSeeAmount: boolean,
  ): Promise<CreditApprovalResponseType> {
    if (!row) {
      return { approved: false, id: null, max_outstanding_pkr: null, valid_until: null, approved_by_name: null, approved_at: null, note: null };
    }
    const approver = await db.user.findUnique({ where: { id: row.approvedBy }, select: { name: true } });
    return {
      approved: !expired(row.validUntil),
      id: row.id,
      max_outstanding_pkr: canSeeAmount ? Number(row.maxOutstandingPkr) : null,
      valid_until: row.validUntil ? row.validUntil.toISOString().slice(0, 10) : null,
      approved_by_name: approver?.name ?? null,
      approved_at: row.approvedAt.toISOString(),
      note: canSeeAmount ? row.note : null,
    };
  }
}
