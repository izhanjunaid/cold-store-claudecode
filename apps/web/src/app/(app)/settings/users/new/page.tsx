'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/layout/page-header';

const ROLES = ['OWNER', 'MANAGER', 'ACCOUNTANT', 'OPERATOR', 'SECURITY'];
const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export default function NewUserPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [nameUrdu, setNameUrdu] = useState('');
  const [role, setRole] = useState('OPERATOR');
  const [initialPassword, setInitialPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (initialPassword.length < 8) return setError('Initial password must be at least 8 characters.');
    setSubmitting(true);
    try {
      const created = await apiClient<{ id: string }>('/v1/users', {
        method: 'POST',
        body: { email, name, name_urdu: nameUrdu.trim() || null, role, initial_password: initialPassword },
      });
      toast.success('User created');
      router.push(`/settings/users/${created.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="Create User" crumb="New" />
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Email <span className="text-destructive">*</span></Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>Name (Urdu, optional)</Label>
              <Input value={nameUrdu} onChange={(e) => setNameUrdu(e.target.value)} dir="rtl" className="font-urdu" />
            </div>
            <div className="space-y-1.5">
              <Label>Role <span className="text-destructive">*</span></Label>
              <select value={role} onChange={(e) => setRole(e.target.value)} className={SELECT_CLASS}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Initial Password <span className="text-destructive">*</span></Label>
              <Input type="text" value={initialPassword} onChange={(e) => setInitialPassword(e.target.value)} required minLength={8} className="font-mono" />
              <p className="text-xs text-muted-foreground">User will be required to change this on first login.</p>
            </div>
            {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => router.push('/settings/users')}>Cancel</Button>
              <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create User'}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
