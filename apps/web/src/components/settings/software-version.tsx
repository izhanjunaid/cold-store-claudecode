'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * What this box is running — presented as the stamped spec plate bolted to a
 * compressor: model, serial, date of manufacture, in the plainest possible
 * type. The facility already reads its plant this way.
 *
 * The verdict line above the plate is the reason the panel exists. A version
 * string alone would not have caught the failure this is built for: a client
 * box that could not migrate on any update for months while the app carried on
 * serving the old schema. So the panel answers the question the owner actually
 * has — did the last update finish? — by comparing the migrations shipped in
 * the image against the ones the database has applied.
 */

interface VersionInfo {
  version: string;
  commit: string | null;
  built_at: string | null;
  started_at: string;
  database: {
    migrations_in_image: number | null;
    migrations_applied: number | null;
    latest_migration: string | null;
    latest_applied_at: string | null;
    pending_migrations: string[] | null;
  };
}

/** Small-caps label + monospace value. One row of the plate. */
function Stamp({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd className="truncate font-mono text-xs text-foreground" title={title ?? value}>
        {value}
      </dd>
    </div>
  );
}

export function SoftwareVersion() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    apiClient<VersionInfo>('/v1/system/version')
      .then(setInfo)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return null;
  if (!info) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Software</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-28 animate-pulse rounded-md bg-muted" />
        </CardContent>
      </Card>
    );
  }

  const { database: db } = info;
  const pending = db.pending_migrations;
  // Three states, and the third is not a pass. "Could not tell" must never
  // read like "everything is fine" — that conflation is what let a broken
  // update sit unnoticed in the first place.
  const state: 'current' | 'behind' | 'unknown' =
    pending === null ? 'unknown' : pending.length > 0 ? 'behind' : 'current';

  const verdict = {
    current: 'The database carries every change in this version.',
    behind:
      pending && pending.length === 1
        ? 'The database is missing 1 change from this version — the last update did not finish.'
        : `The database is missing ${pending?.length ?? 0} changes from this version — the last update did not finish.`,
    unknown: 'The database’s update history could not be read.',
  }[state];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Software</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden
            className={cn(
              'mt-1.5 h-2 w-2 shrink-0 rounded-full',
              state === 'current' && 'bg-green-600',
              state === 'behind' && 'bg-destructive',
              state === 'unknown' && 'bg-muted-foreground',
            )}
          />
          <p
            className={cn(
              'text-sm',
              state === 'behind' ? 'font-medium text-destructive' : 'text-muted-foreground',
            )}
          >
            {verdict}
            {state === 'behind' && (
              <span className="mt-1 block font-normal text-muted-foreground">
                Run the update again, or send <span className="font-mono">logs\update.log</span> to
                your ColdChain provider.
              </span>
            )}
          </p>
        </div>

        <dl className="rounded-md border bg-muted/40 px-4 py-1">
          <Stamp label="Version" value={info.version} />
          <div className="border-t" />
          <Stamp
            label="Built"
            value={
              info.built_at
                ? `${formatDate(info.built_at)}${info.commit ? ` · ${info.commit.slice(0, 7)}` : ''}`
                : 'Not a released build'
            }
            title={info.commit ?? undefined}
          />
          <div className="border-t" />
          <Stamp label="Running since" value={formatDateTime(info.started_at)} />
          <div className="border-t" />
          <Stamp
            label="Database"
            value={
              db.migrations_applied === null
                ? 'Unknown'
                : // Not "N of M": a box provisioned before the rebaseline carries
                  // legacy migrations no current image ships, so applied can
                  // exceed shipped and "27 of 25" would read as broken. The
                  // verdict line above already says whether anything is missing.
                  `${db.migrations_applied} changes applied${
                    db.latest_applied_at ? ` · ${formatDate(db.latest_applied_at)}` : ''
                  }`
            }
            title={db.latest_migration ?? undefined}
          />
        </dl>

        <p className="text-xs text-muted-foreground">
          Quote the version and build when you contact support.
        </p>
      </CardContent>
    </Card>
  );
}
