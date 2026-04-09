import { PartyRepository } from './party.repository';
import { Errors } from '../../common/errors';
interface PartyRecord {
  id: string;
  facilityId: string;
  name: string;
  nameUrdu: string | null;
  partyType: string;
  phonePrimary: string;
  phoneSecondary: string | null;
  address: string | null;
  cnic: string | null;
  parentArhtiId: string | null;
  creditLimitPkr: { toNumber(): number } | null;
  creditTermsDays: number;
  isActive: boolean;
  notes: string | null;
  createdAt: Date;
  createdBy: string;
  parentArhti?: { name: string } | null;
}

interface CreatePartyInput {
  facilityId: string;
  name: string;
  nameUrdu?: string;
  partyType: string;
  phonePrimary: string;
  phoneSecondary?: string;
  address?: string;
  cnic?: string;
  parentArhtiId?: string;
  creditLimitPkr?: number;
  creditTermsDays: number;
  notes?: string;
  createdBy: string;
}

interface UpdatePartyInput {
  name?: string;
  nameUrdu?: string;
  partyType?: string;
  phonePrimary?: string;
  phoneSecondary?: string;
  address?: string;
  cnic?: string;
  parentArhtiId?: string | null;
  creditLimitPkr?: number | null;
  creditTermsDays?: number;
  notes?: string;
}

function toResponse(party: PartyRecord) {
  return {
    id: party.id,
    facility_id: party.facilityId,
    name: party.name,
    name_urdu: party.nameUrdu ?? null,
    party_type: party.partyType,
    phone_primary: party.phonePrimary,
    phone_secondary: party.phoneSecondary ?? null,
    address: party.address ?? null,
    cnic: party.cnic ?? null,
    parent_arhti_id: party.parentArhtiId ?? null,
    parent_arhti_name: party.parentArhti?.name ?? null,
    credit_limit_pkr: party.creditLimitPkr ? Number(party.creditLimitPkr) : null,
    credit_terms_days: party.creditTermsDays,
    is_active: party.isActive,
    notes: party.notes ?? null,
    created_at: party.createdAt.toISOString(),
    created_by: party.createdBy,
  };
}

export class PartyService {
  constructor(private readonly repo: PartyRepository) {}

  async list(facilityId: string, query: { type?: string; is_active?: boolean; search?: string; page: number; per_page: number }) {
    const { data, total } = await this.repo.findMany({
      facilityId,
      type: query.type,
      isActive: query.is_active,
      search: query.search,
      page: query.page,
      perPage: query.per_page,
    });

    return {
      data: (data as PartyRecord[]).map(toResponse),
      meta: { page: query.page, per_page: query.per_page, total },
    };
  }

  async getById(facilityId: string, id: string) {
    const party = await this.repo.findById(facilityId, id);
    if (!party) throw Errors.PARTY_NOT_FOUND();
    return toResponse(party as PartyRecord);
  }

  async create(input: CreatePartyInput) {
    const warnings: string[] = [];

    const existing = await this.repo.findByPhone(input.facilityId, input.phonePrimary);
    if (existing) {
      warnings.push(`Phone ${input.phonePrimary} already registered to ${existing.name}`);
    }

    if (input.parentArhtiId) {
      const arhti = await this.repo.findById(input.facilityId, input.parentArhtiId);
      if (!arhti) throw Errors.VALIDATION_ERROR('Parent Arhti not found', 'parent_arhti_id');
      if (arhti.partyType !== 'ARHTI') {
        throw Errors.VALIDATION_ERROR('Parent party must be of type ARHTI', 'parent_arhti_id');
      }
    }

    const party = await this.repo.create({
      facilityId: input.facilityId,
      name: input.name,
      nameUrdu: input.nameUrdu,
      partyType: input.partyType as 'FARMER' | 'TRADER' | 'ARHTI' | 'BUYER' | 'OTHER',
      phonePrimary: input.phonePrimary,
      phoneSecondary: input.phoneSecondary,
      address: input.address,
      cnic: input.cnic,
      parentArhtiId: input.parentArhtiId,
      creditLimitPkr: input.creditLimitPkr,
      creditTermsDays: input.creditTermsDays,
      notes: input.notes,
      createdBy: input.createdBy,
    });

    const response = toResponse(party as PartyRecord);
    return { ...response, warnings: warnings.length > 0 ? warnings : undefined };
  }

  async update(facilityId: string, id: string, input: UpdatePartyInput) {
    const party = await this.repo.findById(facilityId, id);
    if (!party) throw Errors.PARTY_NOT_FOUND();

    if (input.parentArhtiId) {
      const arhti = await this.repo.findById(facilityId, input.parentArhtiId);
      if (!arhti) throw Errors.VALIDATION_ERROR('Parent Arhti not found', 'parent_arhti_id');
      if (arhti.partyType !== 'ARHTI') {
        throw Errors.VALIDATION_ERROR('Parent party must be of type ARHTI', 'parent_arhti_id');
      }
    }

    const updated = await this.repo.update(id, {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.nameUrdu !== undefined && { nameUrdu: input.nameUrdu }),
      ...(input.partyType !== undefined && { partyType: input.partyType as 'FARMER' | 'TRADER' | 'ARHTI' | 'BUYER' | 'OTHER' }),
      ...(input.phonePrimary !== undefined && { phonePrimary: input.phonePrimary }),
      ...(input.phoneSecondary !== undefined && { phoneSecondary: input.phoneSecondary }),
      ...(input.address !== undefined && { address: input.address }),
      ...(input.cnic !== undefined && { cnic: input.cnic }),
      ...(input.parentArhtiId !== undefined && { parentArhtiId: input.parentArhtiId }),
      ...(input.creditLimitPkr !== undefined && { creditLimitPkr: input.creditLimitPkr }),
      ...(input.creditTermsDays !== undefined && { creditTermsDays: input.creditTermsDays }),
      ...(input.notes !== undefined && { notes: input.notes }),
    });

    return toResponse(updated as PartyRecord);
  }

  async deactivate(facilityId: string, id: string) {
    const party = await this.repo.findById(facilityId, id);
    if (!party) throw Errors.PARTY_NOT_FOUND();
    await this.repo.deactivate(id);
    return { message: 'Party deactivated' };
  }
}
