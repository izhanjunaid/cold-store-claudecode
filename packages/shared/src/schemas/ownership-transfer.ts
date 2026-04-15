import { z } from 'zod';

export const CreateOwnershipTransferRequest = z
  .object({
    transfer_type: z.enum(['FULL', 'PARTIAL']),
    to_party_id: z.string().uuid(),
    quantity_bags: z.number().int().positive().optional(),
    transfer_price_pkr: z.number().nonnegative().optional(),
    effective_date: z.string().date(),
    notes: z.string().optional(),
  })
  .refine(
    (v) => v.transfer_type === 'FULL' || typeof v.quantity_bags === 'number',
    { message: 'quantity_bags is required for PARTIAL transfers', path: ['quantity_bags'] },
  );

export const OwnershipTransferResponse = z.object({
  transfer_id: z.string().uuid(),
  transfer_type: z.enum(['FULL', 'PARTIAL']),
  effective_date: z.string(),
  from_party_id: z.string().uuid(),
  to_party_id: z.string().uuid(),
  quantity_bags: z.number(),
  transfer_price_pkr: z.number().nullable(),
  parent_lot_id: z.string().uuid(),
  parent_lot_number: z.string(),
  parent_current_balance_bags: z.number(),
  child_lot_id: z.string().uuid().nullable(),
  child_lot_number: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
});
