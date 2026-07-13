'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import {
  PERMISSION_REGISTRY,
  EDITABLE_ROLES,
  defaultPermissionsForRole,
  isAlwaysOwnerKey,
  type Role,
} from '@coldchain/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { PageHeader } from '@/components/layout/page-header';
import { PageSkeleton } from '@/components/page-skeleton';
import { Lock } from 'lucide-react';

const COLUMNS: Role[] = ['OWNER', ...EDITABLE_ROLES];

interface PermissionsResponse {
  effective: Record<string, string[]>;
}

// Distinct groups, in registry order.
const GROUPS = PERMISSION_REGISTRY.reduce<string[]>((acc, p) => {
  if (!acc.includes(p.group)) acc.push(p.group);
  return acc;
}, []);

export default function PermissionsPage() {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Desired effective permission set per editable role.
  const [checked, setChecked] = useState<Record<string, Set<string>>>({});

  function loadFrom(effective: Record<string, string[]>) {
    const next: Record<string, Set<string>> = {};
    for (const role of EDITABLE_ROLES) next[role] = new Set(effective[role] ?? []);
    setChecked(next);
  }

  useEffect(() => {
    apiClient<PermissionsResponse>('/v1/permissions')
      .then((data) => loadFrom(data.effective))
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
      .finally(() => setLoading(false));
  }, []);

  function toggle(role: Role, key: string) {
    setChecked((prev) => {
      const set = new Set(prev[role]);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      return { ...prev, [role]: set };
    });
  }

  // overrides = delta vs registry defaults for each editable role.
  const overrides = useMemo(() => {
    const out: Record<string, { grant: string[]; revoke: string[] }> = {};
    for (const role of EDITABLE_ROLES) {
      const defaults = new Set(defaultPermissionsForRole(role));
      const desired = checked[role] ?? new Set<string>();
      const grant: string[] = [];
      const revoke: string[] = [];
      for (const p of PERMISSION_REGISTRY) {
        if (p.alwaysOwner) continue;
        const isDefault = defaults.has(p.key);
        const isDesired = desired.has(p.key);
        if (isDesired && !isDefault) grant.push(p.key);
        if (!isDesired && isDefault) revoke.push(p.key);
      }
      if (grant.length || revoke.length) out[role] = { grant, revoke };
    }
    return out;
  }, [checked]);

  const dirty = Object.keys(overrides).length > 0 || false;

  async function save() {
    setSaving(true);
    try {
      const data = await apiClient<PermissionsResponse>('/v1/permissions', {
        method: 'PUT',
        body: { overrides },
      });
      loadFrom(data.effective);
      // The acting owner's own nav/permissions may have changed — refresh /me.
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      toast.success('Permissions saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function resetDefaults() {
    setSaving(true);
    try {
      const data = await apiClient<PermissionsResponse>('/v1/permissions/reset', { method: 'POST', body: {} });
      loadFrom(data.effective);
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      toast.success('Permissions reset to defaults');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageSkeleton />;
  if (error) return <p className="text-destructive">{error}</p>;

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Permissions"
        description="Choose what each role can do. OWNER always has full access. Changes apply to every user of that role."
        actions={
          <div className="flex items-center gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={saving}>Reset to defaults</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset all permissions?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This clears every customization and restores the standard role defaults.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={resetDefaults}>Reset</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save Changes'}</Button>
          </div>
        }
      />

      <Card>
        <CardHeader><CardTitle className="text-sm">Role permission matrix</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <th className="sticky left-0 bg-card px-4 py-2 text-left font-medium">Capability</th>
                {COLUMNS.map((role) => (
                  <th key={role} className="px-3 py-2 text-center font-medium">{role}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {GROUPS.map((group) => (
                <GroupRows
                  key={group}
                  group={group}
                  checked={checked}
                  onToggle={toggle}
                />
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">
        Locked rows (<Lock className="inline h-3 w-3" aria-hidden />) are reserved for OWNER and cannot be delegated.
        Note: KATCHI book access and backdating remain fixed seniority rules and are not shown here.
      </p>
    </div>
  );
}

function GroupRows({
  group,
  checked,
  onToggle,
}: {
  group: string;
  checked: Record<string, Set<string>>;
  onToggle: (role: Role, key: string) => void;
}) {
  const rows = PERMISSION_REGISTRY.filter((p) => p.group === group);
  return (
    <>
      <tr className="bg-muted/40">
        <td colSpan={COLUMNS.length + 1} className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {group}
        </td>
      </tr>
      {rows.map((p) => {
        const locked = isAlwaysOwnerKey(p.key);
        return (
          <tr key={p.key} className="border-b last:border-0 hover:bg-accent/40">
            <td className="sticky left-0 bg-card px-4 py-2">
              <div className="flex items-center gap-1.5">
                <span className="font-medium">{p.label}</span>
                {locked && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Lock className="h-3 w-3 text-muted-foreground" aria-hidden />
                    </TooltipTrigger>
                    <TooltipContent>Reserved for OWNER — cannot be delegated.</TooltipContent>
                  </Tooltip>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{p.description}</p>
            </td>
            {COLUMNS.map((role) => {
              const isOwnerCol = role === 'OWNER';
              const cellChecked = isOwnerCol ? true : (checked[role]?.has(p.key) ?? false);
              const disabled = isOwnerCol || locked;
              return (
                <td key={role} className="px-3 py-2 text-center">
                  <Checkbox
                    checked={cellChecked}
                    disabled={disabled}
                    onCheckedChange={() => onToggle(role, p.key)}
                    aria-label={`${p.label} for ${role}`}
                  />
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}
