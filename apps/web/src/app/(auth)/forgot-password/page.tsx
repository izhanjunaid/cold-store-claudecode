'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import { validateNewPassword, PASSWORD_MIN_LENGTH_DEFAULT } from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const FACILITY_HEADERS = { 'X-Facility-ID': '00000000-0000-0000-0000-000000000001' };

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await apiClient<{ message: string }>('/v1/auth/forgot-password', {
        method: 'POST',
        body: { email },
        headers: FACILITY_HEADERS,
      });
      setInfo(result.message);
      setStep('reset');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    const policy = validateNewPassword(newPassword);
    if (!policy.ok) {
      setError(policy.reason!);
      return;
    }
    setLoading(true);
    try {
      await apiClient<{ message: string }>('/v1/auth/reset-password', {
        method: 'POST',
        body: { email, code, new_password: newPassword },
        headers: FACILITY_HEADERS,
      });
      router.push('/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <KeyRound className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Reset password</h1>
            <p className="text-sm text-muted-foreground">
              {step === 'request'
                ? 'Enter your email and we will send you a 6-digit code.'
                : 'Enter the code from your email and choose a new password.'}
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6">
            {step === 'request' ? (
              <form onSubmit={requestCode} className="space-y-4">
                {error && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" autoComplete="username" />
                </div>
                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? 'Sending…' : 'Send Code'}
                </Button>
              </form>
            ) : (
              <form onSubmit={resetPassword} className="space-y-4">
                {info && !error && (
                  <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    {info}
                  </div>
                )}
                {error && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="code">6-digit code</Label>
                  <Input
                    id="code"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    required
                    placeholder="123456"
                    className="text-center font-mono text-lg tracking-[0.5em]"
                    autoComplete="one-time-code"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-password">New password</Label>
                  <Input id="new-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={PASSWORD_MIN_LENGTH_DEFAULT} placeholder={`At least ${PASSWORD_MIN_LENGTH_DEFAULT} characters`} autoComplete="new-password" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password">Confirm new password</Label>
                  <Input id="confirm-password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={PASSWORD_MIN_LENGTH_DEFAULT} placeholder="Repeat the new password" autoComplete="new-password" />
                </div>
                <Button type="submit" disabled={loading || code.length !== 6} className="w-full">
                  {loading ? 'Resetting…' : 'Reset Password'}
                </Button>
                <button
                  type="button"
                  onClick={() => { setStep('request'); setError(''); setInfo(''); }}
                  className="w-full text-center text-xs text-muted-foreground hover:text-primary hover:underline"
                >
                  Didn&apos;t get a code? Send again
                </button>
              </form>
            )}
            <p className="mt-4 text-center text-sm text-muted-foreground">
              <Link href="/login" className="hover:text-primary hover:underline">Back to sign in</Link>
            </p>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              No email set up? Ask the owner to reset your password from Settings → Users.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
