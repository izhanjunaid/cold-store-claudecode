'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import type { UserResponseType } from '@coldchain/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';

import { formatDateTime } from '@/lib/format';
import { PageSkeleton } from '@/components/page-skeleton';
const ROLES = ['OWNER', 'MANAGER', 'ACCOUNTANT', 'OPERATOR', 'SECURITY'];
const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export default function UserDetailPage() {
  const params = useParams();
  const id = params['id'] as string;

  const [user, setUser] = useState<UserResponseType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [nameUrdu, setNameUrdu] = useState('');
  const [role, setRole] = useState('OPERATOR');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const [showReset, setShowReset] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    apiClient<UserResponseType>(`/v1/users/${id}`)
      .then((u) => {
        setUser(u);
        setName(u.name);
        setNameUrdu(u.name_urdu ?? '');
        setRole(u.role);
        setIsActive(u.is_active);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
      .finally(() => setLoading(false));
  }, [id]);

  async function save(overrideActive?: boolean) {
    setSaving(true);
    try {
      const updated = await apiClient<UserResponseType>(`/v1/users/${id}`, {
        method: 'PATCH',
        body: { name, name_urdu: nameUrdu.trim() || null, role, is_active: overrideActive ?? isActive },
      });
      setUser(updated);
      setIsActive(updated.is_active);
      toast.success('User updated');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword() {
    if (newPassword.length < 8) return toast.error('Password must be at least 8 characters');
    setResetting(true);
    try {
      const updated = await apiClient<UserResponseType>(`/v1/users/${id}/reset-password`, {
        method: 'POST',
        body: { new_password: newPassword },
      });
      setUser(updated);
      setShowReset(false);
      setNewPassword('');
      toast.success('Password reset', {
        description: "The user's other sessions were signed out.",
      });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      setResetting(false);
    }
  }

  if (loading) return <PageSkeleton />;
  if (error || !user) return <p className="text-destructive">{error ?? 'User not found'}</p>;

  return (
    <div className="max-w-2xl">
      <PageHeader
        title={user.name}
        crumb={user.name}
        description={user.email}
        actions={
          <>
            <Button variant="outline" onClick={() => setShowReset(true)}>Reset Password</Button>
            <Button variant="outline" className="text-destructive" disabled={!user.is_active} onClick={() => save(false)}>
              {user.is_active ? 'Deactivate' : 'Deactivated'}
            </Button>
          </>
        }
      />

      <Card className="mb-4">
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Name (Urdu)</Label>
            <Input value={nameUrdu} onChange={(e) => setNameUrdu(e.target.value)} dir="rtl" className="font-urdu" />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <select value={role} onChange={(e) => setRole(e.target.value)} className={SELECT_CLASS}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2.5 text-sm">
            <Checkbox checked={isActive} onCheckedChange={(c) => setIsActive(!!c)} />
            Active
          </label>
          <Button onClick={() => save()} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Account Info</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted-foreground">Created</dt>
            <dd>{formatDateTime(user.created_at)}</dd>
            <dt className="text-muted-foreground">Last Login</dt>
            <dd>{user.last_login_at ? formatDateTime(user.last_login_at) : '—'}</dd>
            <dt className="text-muted-foreground">Must Change Password</dt>
            <dd>{user.must_change_password ? 'Yes' : 'No'}</dd>
          </dl>
        </CardContent>
      </Card>

      <Dialog open={showReset} onOpenChange={setShowReset}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reset Password</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            The user must change the password on next login. All existing sessions are revoked.
          </p>
          <div className="space-y-1.5">
            <Label>New Password</Label>
            <Input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} className="font-mono" autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReset(false)}>Cancel</Button>
            <Button onClick={resetPassword} disabled={resetting}>{resetting ? 'Resetting…' : 'Reset Password'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
