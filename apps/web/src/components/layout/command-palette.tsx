'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Boxes, Users } from 'lucide-react';
import { apiClientList } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { navItemsForRole } from '@/components/layout/nav-config';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';

interface LotHit {
  id: string;
  lot_number: string;
  marka: string | null;
  commodity?: { name: string } | null;
}

interface PartyHit {
  id: string;
  name: string;
  party_type: string;
  phone_primary: string | null;
}

interface CommandPaletteContextValue {
  open: () => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue>({ open: () => {} });

export function useCommandPalette() {
  return useContext(CommandPaletteContext);
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const router = useRouter();
  const { user } = useAuthStore();

  const open = useCallback(() => setIsOpen(true), []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const navItems = useMemo(() => navItemsForRole(user?.role), [user?.role]);

  const debouncedQuery = useDebounced(query.trim(), 250);
  const searchEnabled = isOpen && debouncedQuery.length >= 2;

  const { data: lotHits } = useQuery({
    queryKey: ['palette', 'lots', debouncedQuery],
    queryFn: () =>
      apiClientList<LotHit>(
        `/v1/lots?search=${encodeURIComponent(debouncedQuery)}&per_page=8`,
      ),
    enabled: searchEnabled,
    staleTime: 30_000,
  });

  const { data: partyHits } = useQuery({
    queryKey: ['palette', 'parties', debouncedQuery],
    queryFn: () =>
      apiClientList<PartyHit>(
        `/v1/parties?search=${encodeURIComponent(debouncedQuery)}&per_page=8`,
      ),
    enabled: searchEnabled,
    staleTime: 30_000,
  });

  const matchingNav = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return navItems;
    return navItems.filter((item) => item.label.toLowerCase().includes(q));
  }, [navItems, query]);

  const go = useCallback(
    (href: string) => {
      setIsOpen(false);
      setQuery('');
      router.push(href);
    },
    [router],
  );

  const lots = lotHits?.data ?? [];
  const parties = partyHits?.data ?? [];

  return (
    <CommandPaletteContext.Provider value={{ open }}>
      {children}
      <CommandDialog open={isOpen} onOpenChange={setIsOpen} shouldFilter={false}>
        <CommandInput
          placeholder="Search screens, lots, parties…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {matchingNav.length > 0 && (
            <CommandGroup heading="Go to">
              {matchingNav.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={item.href}
                    value={`nav-${item.label}`}
                    onSelect={() => go(item.href)}
                  >
                    <Icon className="mr-2 h-4 w-4" aria-hidden />
                    {item.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}
          {lots.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Lots">
                {lots.map((lot) => (
                  <CommandItem
                    key={lot.id}
                    value={`lot-${lot.id}`}
                    onSelect={() => go(`/lots/${lot.id}`)}
                  >
                    <Boxes className="mr-2 h-4 w-4" aria-hidden />
                    <span className="font-mono text-xs">{lot.lot_number}</span>
                    {lot.marka && (
                      <span className="ml-2 text-muted-foreground">{lot.marka}</span>
                    )}
                    {lot.commodity?.name && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {lot.commodity.name}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
          {parties.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Parties">
                {parties.map((party) => (
                  <CommandItem
                    key={party.id}
                    value={`party-${party.id}`}
                    onSelect={() => go(`/parties/${party.id}`)}
                  >
                    <Users className="mr-2 h-4 w-4" aria-hidden />
                    {party.name}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {party.party_type}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>
    </CommandPaletteContext.Provider>
  );
}
