import { z } from 'zod';
import { PartyType } from './enums';
import { PaginationQuery } from './common';

export const CreatePartyRequest = z.object({
  name: z.string().min(1).max(200),
  name_urdu: z.string().max(200).optional(),
  party_type: PartyType,
  phone_primary: z.string().min(1).max(20),
  phone_secondary: z.string().max(20).optional(),
  address: z.string().optional(),
  cnic: z.string().max(15).optional(),
  parent_arhti_id: z.string().uuid().optional(),
  credit_limit_pkr: z.number().nonnegative().optional(),
  credit_terms_days: z.number().int().min(0).default(30),
  notes: z.string().optional(),
});

export const UpdatePartyRequest = CreatePartyRequest.partial();

export const PartyListQuery = PaginationQuery.extend({
  type: PartyType.optional(),
  is_active: z.coerce.boolean().optional(),
  search: z.string().optional(),
});

export const PartyResponse = z.object({
  id: z.string().uuid(),
  facility_id: z.string().uuid(),
  name: z.string(),
  name_urdu: z.string().nullable(),
  party_type: PartyType,
  phone_primary: z.string(),
  phone_secondary: z.string().nullable(),
  address: z.string().nullable(),
  cnic: z.string().nullable(),
  parent_arhti_id: z.string().uuid().nullable(),
  parent_arhti_name: z.string().nullable().optional(),
  credit_limit_pkr: z.number().nullable(),
  credit_terms_days: z.number(),
  is_active: z.boolean(),
  notes: z.string().nullable(),
  created_at: z.string(),
  created_by: z.string().uuid(),
  /** Only set on GET :id when a credit limit exists; never the outstanding
   * PKR figure itself, since this endpoint is reachable below ACCOUNTANT. */
  over_credit_limit: z.boolean().optional(),
});
