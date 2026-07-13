import { create } from 'zustand';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  facility_id: string;
  must_change_password?: boolean;
  two_factor_enabled?: boolean;
  // Effective permission keys from the server (login / /me). The single source
  // of truth for UI gating; see lib/permissions.ts `can()`.
  permissions?: string[];
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  setUser: (user: User, accessToken: string, refreshToken: string) => void;
  logout: () => void;
  loadFromStorage: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,

  setUser: (user, accessToken, refreshToken) => {
    localStorage.setItem('access_token', accessToken);
    localStorage.setItem('refresh_token', refreshToken);
    localStorage.setItem('facility_id', user.facility_id);
    set({ user, isAuthenticated: true });
  },

  logout: () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('facility_id');
    set({ user: null, isAuthenticated: false });
  },

  loadFromStorage: () => {
    const token = localStorage.getItem('access_token');
    if (token) {
      set({ isAuthenticated: true });
    }
  },
}));
