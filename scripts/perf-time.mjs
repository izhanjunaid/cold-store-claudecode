// Times the screens a munshi uses all day and the owner's reports, one request at a time.
// Usage: API_URL=http://localhost:3011 node scripts/perf-time.mjs
// Start the API with RATE_LIMIT_MAX raised, against a database filled by scripts/perf-seed.sql.
// Any non-200 answer is printed as FAILED, never as a time (the old perf-baseline.ts timed 429s).
const API = process.env.API_URL ?? 'http://localhost:3011';
const FAC = '00000000-0000-0000-0000-000000000001';
const RUNS = Number(process.env.RUNS ?? 7);

const login = await fetch(`${API}/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Facility-ID': FAC },
  body: JSON.stringify({ email: 'admin@coldchain.pk', password: 'admin123' }),
});
if (!login.ok) throw new Error(`login ${login.status}`);
const headers = { Authorization: `Bearer ${(await login.json()).data.access_token}`, 'X-Facility-ID': FAC };

const get = async (path) => {
  const t = performance.now();
  const res = await fetch(API + path, { headers });
  const body = await res.text();
  return { ms: performance.now() - t, status: res.status, bytes: body.length, body };
};

const party = JSON.parse((await get('/v1/parties?search=Perf%20Party%200042&per_page=1')).body).data[0].id;
const lot = JSON.parse((await get('/v1/lots?search=LOT-PERF-000040&per_page=1')).body).data[0].id;

const ENDPOINTS = [
  ['Lot search (munshi)', '/v1/lots?search=LOT-PERF-0123&per_page=20'],
  ['Lot list, active', '/v1/lots?status=ACTIVE&per_page=50'],
  ['Lot page', `/v1/lots/${lot}`],
  ['Party search', '/v1/parties?search=Party%2001&per_page=20'],
  ['Party ledger', `/v1/parties/${party}/ledger`],
  ['Party statement', `/v1/reports/party-statement/${party}`],
  ['Dispatch desk queue', '/v1/outbound-events?per_page=50'],
  ['Dispatch desk trucks', '/v1/dispatch/trucks'],
  ['Waiting for a manager', '/v1/dispatch/waiting'],
  ['Gate, trucks inside', '/v1/gate-passes?active=true'],
  ['Invoice list', '/v1/invoices?per_page=50'],
  ['Payment list', '/v1/payments?per_page=50'],
  ['Dashboard', '/v1/reports/dashboard'],
  ['Report: lot aging', '/v1/reports/lot-aging'],
  ['Report: receivables aging', '/v1/reports/receivables-aging'],
  ['Report: stock by commodity', '/v1/reports/commodity-inventory'],
  ['Report: seasonal summary', '/v1/reports/seasonal-summary?date_from=2025-12-01&date_to=2026-11-15'],
  ['Trial balance', '/v1/accounting/trial-balance'],
  ['Profit and loss', '/v1/accounting/profit-loss?date_from=2026-07-01&date_to=2026-11-15'],
  ['Balance sheet', '/v1/accounting/balance-sheet?as_of_date=2026-11-15'],
  ['Cash flow', '/v1/accounting/cash-flow?date_from=2026-07-01&date_to=2026-11-15'],
  ['General ledger, farmers receivable, one month', '/v1/accounting/general-ledger?account_code=1110&date_from=2026-06-01&date_to=2026-06-30'],
];

console.log('| Screen or report | Median ms | Slowest ms | Size kB |');
console.log('|---|---|---|---|');
for (const [name, path] of ENDPOINTS) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await get(path));
  const bad = runs.find((r) => r.status !== 200);
  if (bad) {
    console.log(`| ${name} | FAILED ${bad.status} | | ${bad.body.slice(0, 90).replace(/\|/g, '/')} |`);
    continue;
  }
  const ms = runs.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`| ${name} | ${Math.round(ms[ms.length >> 1])} | ${Math.round(ms.at(-1))} | ${Math.round(runs[0].bytes / 1024)} |`);
}
