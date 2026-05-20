/**
 * Perf baseline harness for Phase 11.7.
 *
 * Hits 10 high-traffic endpoints with autocannon and records p95 latencies
 * to phases/phase-11-baseline.json. Run against a live API on localhost:3001
 * after `pnpm --filter @coldchain/api dev`:
 *
 *   pnpm perf:baseline
 *
 * NFR target (docs/11_non_functional_requirements.md §13): p95 ≤ 500ms for
 * generic API endpoints; report endpoints get a 5s budget.
 */
import autocannon from 'autocannon';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const FACILITY_ID = '00000000-0000-0000-0000-000000000001';

const PERF_BUDGET_DEFAULT_MS = 500;
const PERF_BUDGET_REPORT_MS = 5000;

interface EndpointSpec {
  name: string;
  path: string;
  budgetMs?: number;
}

const ENDPOINTS: EndpointSpec[] = [
  { name: 'parties.list',                path: '/v1/parties' },
  { name: 'lots.list',                   path: '/v1/lots' },
  { name: 'invoices.list',               path: '/v1/invoices' },
  { name: 'payments.list',               path: '/v1/payments' },
  { name: 'reports.dashboard',           path: '/v1/reports/dashboard',           budgetMs: PERF_BUDGET_REPORT_MS },
  { name: 'reports.lot-aging',           path: '/v1/reports/lot-aging',           budgetMs: PERF_BUDGET_REPORT_MS },
  { name: 'reports.receivables-aging',   path: '/v1/reports/receivables-aging',   budgetMs: PERF_BUDGET_REPORT_MS },
  { name: 'reports.commodity-inventory', path: '/v1/reports/commodity-inventory', budgetMs: PERF_BUDGET_REPORT_MS },
  { name: 'reports.weight-variance',     path: '/v1/reports/weight-variance',     budgetMs: PERF_BUDGET_REPORT_MS },
  // party ledger is hit per-party detail; budget aligned with reports.
  { name: 'parties.ledger',              path: '/v1/parties/:id/ledger',          budgetMs: PERF_BUDGET_REPORT_MS },
];

async function login(): Promise<string> {
  const res = await fetch(`${API_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Facility-ID': FACILITY_ID },
    body: JSON.stringify({ email: 'admin@coldchain.pk', password: 'admin123' }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  return (await res.json()).data.access_token;
}

async function resolvePartyId(token: string): Promise<string> {
  const res = await fetch(`${API_URL}/v1/parties?per_page=1`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Facility-ID': FACILITY_ID },
  });
  const body = await res.json();
  const first = body?.data?.[0]?.id;
  if (!first) throw new Error('No parties seeded — run prisma seed first');
  return first;
}

interface Result {
  name: string;
  path: string;
  duration_s: number;
  requests_per_sec_mean: number;
  latency_ms: { mean: number; p50: number; p95: number; p99: number };
  budget_ms: number;
  over_budget: boolean;
}

async function runOne(spec: EndpointSpec, token: string, partyId: string): Promise<Result> {
  const path = spec.path.replace(':id', partyId);
  const url = `${API_URL}${path}`;
  console.log(`  → ${spec.name} (${url})`);

  const result = await autocannon({
    url,
    duration: 30,
    connections: 10,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Facility-ID': FACILITY_ID,
    },
  });

  const budget = spec.budgetMs ?? PERF_BUDGET_DEFAULT_MS;
  return {
    name: spec.name,
    path: spec.path,
    duration_s: result.duration,
    requests_per_sec_mean: result.requests.average,
    latency_ms: {
      mean: result.latency.average,
      p50: result.latency.p50,
      p95: result.latency.p97_5,
      p99: result.latency.p99,
    },
    budget_ms: budget,
    over_budget: result.latency.p97_5 > budget,
  };
}

async function main() {
  console.log(`[perf-baseline] target ${API_URL}`);
  const token = await login();
  const partyId = await resolvePartyId(token);
  console.log(`[perf-baseline] partyId for ledger: ${partyId.slice(0, 8)}…`);

  const results: Result[] = [];
  for (const spec of ENDPOINTS) {
    results.push(await runOne(spec, token, partyId));
  }

  const overBudget = results.filter((r) => r.over_budget);
  const out = {
    generated_at: new Date().toISOString(),
    api_url: API_URL,
    config: { duration_s: 30, connections: 10 },
    endpoints: results,
    summary: {
      total: results.length,
      over_budget: overBudget.length,
      over_budget_names: overBudget.map((r) => r.name),
    },
  };

  const outPath = join(__dirname, '..', 'phases', 'phase-11-baseline.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n[perf-baseline] wrote ${outPath}`);

  console.log('\nResult table:');
  for (const r of results) {
    const flag = r.over_budget ? '⚠ ' : '  ';
    console.log(
      `${flag}${r.name.padEnd(32)} p95=${String(r.latency_ms.p95).padStart(5)}ms  budget=${r.budget_ms}ms  rps=${r.requests_per_sec_mean.toFixed(1)}`,
    );
  }

  if (overBudget.length > 0) {
    console.log(`\n${overBudget.length} endpoint(s) over budget.`);
    process.exit(1);
  }
  console.log('\nAll endpoints within budget.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
