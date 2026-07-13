'use client';

type Json = Record<string, unknown> | null;

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * Renders the before/after of one audit-log row. INSERT shows only new values,
 * DELETE only old, UPDATE shows both with changed fields highlighted. Values are
 * already masked server-side (password hashes / SMTP secret → "***").
 */
export function AuditDiff({
  action,
  oldValues,
  newValues,
}: {
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  oldValues: Json;
  newValues: Json;
}) {
  const keys = [...new Set([...Object.keys(oldValues ?? {}), ...Object.keys(newValues ?? {})])].sort();

  if (keys.length === 0) {
    return <p className="px-4 py-2 text-xs text-muted-foreground">No field-level detail recorded.</p>;
  }

  const showOld = action !== 'INSERT';
  const showNew = action !== 'DELETE';

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="px-4 py-1.5 font-medium">Field</th>
            {showOld && <th className="px-4 py-1.5 font-medium">Before</th>}
            {showNew && <th className="px-4 py-1.5 font-medium">After</th>}
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const oldV = oldValues?.[k];
            const newV = newValues?.[k];
            const changed = action === 'UPDATE' && fmtVal(oldV) !== fmtVal(newV);
            return (
              <tr key={k} className={changed ? 'bg-amber-50 dark:bg-amber-950/30' : undefined}>
                <td className="px-4 py-1.5 font-medium">{k}</td>
                {showOld && <td className="px-4 py-1.5 font-mono text-muted-foreground break-all">{fmtVal(oldV)}</td>}
                {showNew && (
                  <td className={`px-4 py-1.5 font-mono break-all ${changed ? 'font-semibold' : 'text-muted-foreground'}`}>
                    {fmtVal(newV)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
