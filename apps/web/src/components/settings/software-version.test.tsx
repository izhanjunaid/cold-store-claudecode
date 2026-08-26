import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const apiClient = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: (...args: unknown[]) => apiClient(...args),
}));

import { SoftwareVersion } from './software-version';

const BASE = {
  version: 'v0.5.0',
  commit: '6f3bcaa1234567',
  built_at: '2026-08-23T09:00:00.000Z',
  started_at: '2026-08-25T06:30:00.000Z',
  database: {
    migrations_in_image: 25,
    migrations_applied: 25,
    latest_migration: '20260822000003_0025_reversal_keeps_original_posted',
    latest_applied_at: '2026-08-23T09:12:00.000Z',
    pending_migrations: [] as string[] | null,
  },
};

describe('SoftwareVersion', () => {
  beforeEach(() => {
    apiClient.mockReset();
    apiClient.mockResolvedValue(BASE);
  });

  it('shows the version and the short commit', async () => {
    render(<SoftwareVersion />);
    await waitFor(() => expect(screen.getByText('v0.5.0')).toBeTruthy());
    // Seven characters is what a person reads back over the phone.
    expect(screen.getByText(/6f3bcaa/)).toBeTruthy();
    expect(screen.queryByText(/6f3bcaa1234567/)).toBeNull();
  });

  it('says the database carries every change when nothing is pending', async () => {
    render(<SoftwareVersion />);
    await waitFor(() =>
      expect(screen.getByText(/carries every change in this version/)).toBeTruthy(),
    );
  });

  it('calls out a half-finished update, and says what to do about it', async () => {
    apiClient.mockResolvedValue({
      ...BASE,
      database: { ...BASE.database, migrations_applied: 23, pending_migrations: ['a', 'b'] },
    });
    render(<SoftwareVersion />);
    await waitFor(() =>
      expect(screen.getByText(/missing 2 changes .* last update did not finish/)).toBeTruthy(),
    );
    expect(screen.getByText(/Run the update again/)).toBeTruthy();
  });

  it('counts one pending change in the singular', async () => {
    apiClient.mockResolvedValue({
      ...BASE,
      database: { ...BASE.database, migrations_applied: 24, pending_migrations: ['a'] },
    });
    render(<SoftwareVersion />);
    await waitFor(() => expect(screen.getByText(/missing 1 change from/)).toBeTruthy());
  });

  it('does NOT read as a pass when the migration history could not be read', async () => {
    // The whole point: "could not tell" must never look like "everything is
    // fine" — that conflation is how a broken update went unnoticed for months.
    apiClient.mockResolvedValue({
      ...BASE,
      database: {
        ...BASE.database,
        migrations_applied: null,
        latest_applied_at: null,
        pending_migrations: null,
      },
    });
    render(<SoftwareVersion />);
    await waitFor(() => expect(screen.getByText(/could not be read/)).toBeTruthy());
    expect(screen.queryByText(/carries every change/)).toBeNull();
  });

  it('says so plainly when the build is not a release', async () => {
    apiClient.mockResolvedValue({ ...BASE, version: 'dev', commit: null, built_at: null });
    render(<SoftwareVersion />);
    await waitFor(() => expect(screen.getByText('dev')).toBeTruthy());
    expect(screen.getByText(/Not a released build/)).toBeTruthy();
  });

  it('renders nothing at all if the endpoint is unavailable', async () => {
    apiClient.mockRejectedValue(new Error('nope'));
    const { container } = render(<SoftwareVersion />);
    await waitFor(() => expect(container.textContent).toBe(''));
  });
});
