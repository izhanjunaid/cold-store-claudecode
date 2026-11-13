'use client';

import { useEffect, useState } from 'react';
import { MANAGER_ALLOW_CODES, MANAGER_ALLOW_TEXT, type ManagerAllowCode, type ManagerAskCode } from '@coldchain/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

/** The words on each choice: what the munshi asked for, in the manager's terms. */
const LABEL: Record<ManagerAllowCode, string> = {
  CHEQUE_OR_TRANSFER: 'Cheque or transfer',
  CREDIT: 'Credit on this bill',
  LEAVE_CHARGE_OFF: 'Leaving charges off',
};

/**
 * What a call asked for, ticked up front, together with what is already allowed (an allowance replaces the list, so
 * leaving the earlier ones out would take them back): the manager confirms or changes it. A plain call ticks nothing new.
 */
const ticked = (ask: ManagerAskCode | null, already: ManagerAllowCode[]): ManagerAllowCode[] => {
  const asked = ask && ask !== 'CALLED' && (MANAGER_ALLOW_CODES as readonly string[]).includes(ask) ? [ask as ManagerAllowCode] : [];
  return MANAGER_ALLOW_CODES.filter((c) => already.includes(c) || asked.includes(c));
};

/**
 * What the manager may choose from (docs/28 O8): the munshi's ask, and what is already allowed. After a plain call that
 * asked for nothing in particular, all three; the manager decides.
 */
const choices = (ask: ManagerAskCode | null, already: ManagerAllowCode[]): readonly ManagerAllowCode[] =>
  ask === 'CALLED' ? MANAGER_ALLOW_CODES : MANAGER_ALLOW_CODES.filter((c) => c === ask || already.includes(c));

/**
 * A manager allows what the munshi asked for (docs/28 O8-O11): the munshi then finishes the checkout. It lasts
 * today; it covers only these things, never a rule the owner keeps for a manager. Errors stay in the dialog.
 */
export function AllowDialog({
  open,
  onOpenChange,
  title,
  ask,
  already,
  onAllow,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What is being allowed: the dispatch note and the truck. */
  title: string;
  ask: ManagerAskCode | null;
  /** What a manager has already allowed on it today. */
  already: ManagerAllowCode[];
  onAllow: (allows: ManagerAllowCode[]) => Promise<void>;
}) {
  const [picked, setPicked] = useState<ManagerAllowCode[]>(ticked(ask, already));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setPicked(ticked(ask, already));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ask]);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await onAllow(picked);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not allow this');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Allow — {title}</DialogTitle>
          <DialogDescription>
            The munshi can then finish this checkout themselves, today only. Anything not ticked stays a manager’s.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {choices(ask, already).map((code) => (
            <div key={code} className="flex items-center gap-2">
              <Checkbox
                id={`allow-${code}`}
                checked={picked.includes(code)}
                onCheckedChange={(c) => setPicked((prev) => (c ? [...prev, code] : prev.filter((x) => x !== code)))}
              />
              <Label htmlFor={`allow-${code}`}>{LABEL[code]}</Label>
              <span className="text-xs text-muted-foreground">({MANAGER_ALLOW_TEXT[code]})</span>
            </div>
          ))}
        </div>
        {error && (
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Go back
          </Button>
          <Button disabled={picked.length === 0 || saving} onClick={submit}>
            Allow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
