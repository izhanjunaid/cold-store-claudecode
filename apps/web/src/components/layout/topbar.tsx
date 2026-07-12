'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, KeyRound, LogOut, Search, UserCircle } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { useCommandPalette } from '@/components/layout/command-palette';

interface FacilityMe {
  id: string;
  name: string;
}

export function Topbar() {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const { open: openPalette } = useCommandPalette();

  const { data: facility } = useQuery({
    queryKey: ['facility', 'me'],
    queryFn: () => apiClient<FacilityMe>('/v1/facilities/me'),
    staleTime: Infinity,
  });

  const handleLogout = async () => {
    try {
      await apiClient('/v1/auth/logout', { method: 'POST' });
    } catch {
      // Logout even if API fails
    }
    logout();
    router.push('/login');
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b bg-card px-4">
      <div className="text-sm font-medium text-foreground">
        {facility?.name ?? ' '}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={openPalette}
          className="h-8 w-56 justify-between text-muted-foreground"
        >
          <span className="flex items-center gap-2">
            <Search className="h-3.5 w-3.5" aria-hidden />
            Search…
          </span>
          <kbd className="pointer-events-none rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            Ctrl K
          </kbd>
        </Button>

        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 gap-2 px-2">
                <span className="text-sm">{user.name}</span>
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                  {user.role}
                </Badge>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>
                <div className="text-sm font-medium">{user.name}</div>
                <div className="text-xs font-normal text-muted-foreground">{user.email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push('/account')}>
                <UserCircle className="mr-2 h-4 w-4" aria-hidden />
                My account
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push('/change-password')}>
                <KeyRound className="mr-2 h-4 w-4" aria-hidden />
                Change password
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="mr-2 h-4 w-4" aria-hidden />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
