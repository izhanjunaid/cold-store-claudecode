import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from './auth.store';

const mockUser = {
  id: 'u1',
  email: 'test@test.com',
  name: 'Test User',
  role: 'OWNER',
  facility_id: 'f1',
};

describe('useAuthStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ user: null, isAuthenticated: false });
  });

  it('starts unauthenticated', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
  });

  it('setUser stores tokens and sets authenticated', () => {
    useAuthStore.getState().setUser(mockUser, 'access-tok', 'refresh-tok');
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.user).toEqual(mockUser);
    expect(localStorage.getItem('access_token')).toBe('access-tok');
    expect(localStorage.getItem('refresh_token')).toBe('refresh-tok');
  });

  it('logout clears state and storage', () => {
    useAuthStore.getState().setUser(mockUser, 'at', 'rt');
    useAuthStore.getState().logout();
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(localStorage.getItem('access_token')).toBeNull();
  });

  it('loadFromStorage sets authenticated when token exists', () => {
    localStorage.setItem('access_token', 'some-token');
    useAuthStore.getState().loadFromStorage();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('loadFromStorage stays unauthenticated when no token', () => {
    useAuthStore.getState().loadFromStorage();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});
