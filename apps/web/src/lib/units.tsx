'use client';

import { useContext } from 'react';
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';

/**
 * The unit goods are counted in (docs/32 section 2.4). Each kind of goods has its own:
 * potatoes in bags, apples in crates. A count on screen carries the unit of its goods,
 * never the fixed word "bags".
 */
export interface Unit {
  /** One unit, lower case: "bag", "crate". */
  one: string;
  /** Several, lower case: "bags", "crates". */
  many: string;
}

interface GoodsRef {
  id: string;
  name: string;
  unit_label?: string;
  unit_name?: string;
  is_active?: boolean;
}

const BAG: Unit = { one: 'bag', many: 'bags' };
const MIXED: Unit = { one: 'unit', many: 'units' };
const STALE = 5 * 60 * 1000;

// A component rendered with no query provider (a few unit tests) reads nothing and
// falls back to "bags", the word every screen used before.
const detached = new QueryClient();

function unitOf(g: GoodsRef): Unit {
  const many = (g.unit_label ?? 'bags').toLowerCase();
  return { one: (g.unit_name ?? many.replace(/s$/, '')).toLowerCase(), many };
}

export function useUnits() {
  const client = useContext(QueryClientContext);
  const { data } = useQuery(
    {
      queryKey: qk.reference.commodities,
      queryFn: () => apiClient<GoodsRef[]>('/v1/commodities'),
      staleTime: STALE,
      enabled: client !== undefined,
    },
    client ?? detached,
  );
  const goods = Array.isArray(data) ? data : [];
  const active = goods.filter((g) => g.is_active !== false).map(unitOf);
  // The word for a total across goods: their shared unit, or "units" when they differ.
  const any: Unit =
    active.length === 0 ? BAG : active.every((u) => u.many === active[0]!.many) ? active[0]! : MIXED;
  return {
    any,
    /** The unit of one kind of goods, by its name or id; the store-wide word when unknown. */
    of(goodsNameOrId?: string | null): Unit {
      const g = goodsNameOrId ? goods.find((x) => x.id === goodsNameOrId || x.name === goodsNameOrId) : undefined;
      return g ? unitOf(g) : any;
    },
  };
}

/** The unit word beside a count: `<Units of={lot.commodity_name} />` renders "crates". */
export function Units({ of, one, title }: { of?: string | null; one?: boolean; title?: boolean }) {
  const unit = useUnits().of(of);
  const word = one ? unit.one : unit.many;
  return <>{title ? word.charAt(0).toUpperCase() + word.slice(1) : word}</>;
}
