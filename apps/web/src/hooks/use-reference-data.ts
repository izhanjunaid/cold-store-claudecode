'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import type { NumberLocale } from '@/lib/format';

const REFERENCE_STALE_TIME = 5 * 60_000;

export interface PartyRef {
  id: string;
  name: string;
  name_urdu?: string | null;
  party_type?: string;
}

export interface CommodityRef {
  id: string;
  name: string;
}

export interface VarietyRef {
  id: string;
  name: string;
  commodity_id: string;
}

export interface ChamberRef {
  id: string;
  name: string;
  commodity_restriction_id: string | null;
  max_capacity_bags: number;
  current_occupancy_bags: number;
  available_capacity_bags: number;
  rack_count?: number;
}

export interface RackRef {
  id: string;
  chamber_id: string;
  name: string;
  max_capacity_bags: number;
  current_occupancy_bags: number;
  position: number;
  is_active: boolean;
  notes: string | null;
}

export interface RatePlanRef {
  id: string;
  name: string;
  commodity_id: string | null;
  rate_type: string;
  rate_amount_pkr: number;
}

export interface FacilitySettings {
  /** Number grouping for every money/count on screen — see lib/format.ts. */
  number_format?: NumberLocale;
  weight_dispute_threshold_kg?: number;
  chamber_capacity_warning_pct?: number;
  backdating_max_days?: number | null;
  gst_enabled?: boolean;
  gst_default_rate?: number;
  [key: string]: unknown;
}

export interface FacilityMe {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  gst_number?: string | null;
  settings?: FacilitySettings;
}

export function useParties() {
  return useQuery({
    queryKey: qk.reference.parties,
    queryFn: () => apiClient<PartyRef[]>('/v1/parties?is_active=true&per_page=100'),
    staleTime: REFERENCE_STALE_TIME,
  });
}

export function useCommodities() {
  return useQuery({
    queryKey: qk.reference.commodities,
    queryFn: () => apiClient<CommodityRef[]>('/v1/commodities'),
    staleTime: REFERENCE_STALE_TIME,
  });
}

export function useVarieties() {
  return useQuery({
    queryKey: qk.reference.varieties,
    queryFn: () => apiClient<VarietyRef[]>('/v1/varieties'),
    staleTime: REFERENCE_STALE_TIME,
  });
}

export function useChambers() {
  return useQuery({
    queryKey: qk.reference.chambers,
    queryFn: () => apiClient<ChamberRef[]>('/v1/chambers?is_active=true'),
    staleTime: REFERENCE_STALE_TIME,
  });
}

/** Active racks of one room (chamber) — for placement/move pickers. */
export function useRacks(chamberId: string | undefined) {
  return useQuery({
    queryKey: ['chambers', 'racks', chamberId ?? 'none'],
    queryFn: () =>
      apiClient<{ racks: RackRef[] }>(`/v1/chambers/${chamberId}`).then((c) =>
        (c.racks ?? []).filter((r) => r.is_active),
      ),
    enabled: !!chamberId,
    staleTime: 30_000,
  });
}

export function useRatePlans() {
  return useQuery({
    queryKey: qk.reference.ratePlans,
    queryFn: () => apiClient<RatePlanRef[]>('/v1/rate-plans?is_active=true'),
    staleTime: REFERENCE_STALE_TIME,
  });
}

/** Facility profile + settings (thresholds, GST, backdating limits). */
export function useFacility() {
  return useQuery({
    queryKey: qk.facility.me,
    queryFn: () => apiClient<FacilityMe>('/v1/facilities/me'),
    staleTime: REFERENCE_STALE_TIME,
  });
}
