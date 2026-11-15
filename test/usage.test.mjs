import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchQuota } from '../src/cail-api.mjs';
import { formatUsageReport } from '../src/usage.mjs';

export const quota = {
  object: 'quota', managed_by: 'cloudflare', state: 'estimated', unit: 'microdollar', currency: 'USD',
  limit: 10000000, estimated_used: 2500000, estimated_remaining: 7500000,
  used_percent: 25, remaining_percent: 75, window_seconds: 86400,
  window_technique: 'fixed', calculated_at: 1794690000,
};

test('usage reports account totals, units and UTC period without exposing extra fields', () => {
  const report = formatUsageReport({ ok: true, quota: { ...quota, secret: 'never-show' } });
  assert.equal(report.healthy, true);
  assert.match(report.text, /\$2.50 of \$10.00 \(25%\)/);
  assert.match(report.text, /Remaining\s+\$7.50/);
  assert.match(report.text, /Since\s+2026-11-14 00:00 UTC\n  Resets\s+2026-11-15 00:00 UTC/);
  assert.match(report.text, /Shared across your CAIL keys/);
  assert.ok(!report.text.includes('never-show'));
});

test('usage handles zero, sub-cent, exhausted, over-limit and sliding allowances', () => {
  for (const used of [0, 1, 10000000, 12000000]) {
    const percent = Math.min(100, Math.round(used / quota.limit * 100));
    const report = formatUsageReport({ ok: true, quota: { ...quota, estimated_used: used,
      estimated_remaining: Math.max(0, quota.limit - used), used_percent: percent, remaining_percent: 100 - percent } });
    assert.equal(report.healthy, true);
    if (used === 1) assert.match(report.text, /<\$0.01/);
    if (used >= quota.limit) assert.match(report.text, /Remaining\s+\$0.00/);
  }
  const sliding = formatUsageReport({ ok: true, quota: { ...quota, window_technique: 'sliding' } });
  assert.equal(sliding.healthy, true);
  assert.ok(!sliding.text.includes('Resets'));
  assert.match(sliding.text, /Window\s+1 day \(rolling\)/);
});

test('usage rejects malformed or contradictory estimates instead of showing zero', () => {
  for (const patch of [null, {}, { ...quota, unit: 'dollar' }, { ...quota, estimated_used: -1 },
    { ...quota, estimated_remaining: 0 }, { ...quota, limit: 0 }, { ...quota, calculated_at: Number.MAX_SAFE_INTEGER }]) {
    assert.equal(formatUsageReport({ ok: true, quota: patch }).healthy, false);
  }
});

test('quota reads only the authenticated endpoint, blocks redirects, and has a timeout', async () => {
  let calls = 0;
  const result = await fetchQuota(' secret ', { fetch: async (url, init) => {
    calls++;
    assert.equal(url, 'https://tools.ailab.gc.cuny.edu/v1/quota');
    assert.equal(init.headers.Authorization, 'Bearer secret');
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    return Response.json(quota);
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result, { ok: true, quota });
  const missing = await fetchQuota('', { fetch: () => assert.fail('must not fetch') });
  assert.match(missing.message, /\/login/);
});

test('quota failures never expose response bodies or exception messages', async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    const result = await fetchQuota('secret', { fetch: async () => new Response('secret', { status }) });
    assert.equal(result.ok, false);
    assert.ok(!result.message.includes('secret'));
  }
  const bad = await fetchQuota('secret', { fetch: async () => new Response('secret') });
  assert.equal(bad.ok, false);
  const timeout = await fetchQuota('secret', { fetch: async () => { throw new DOMException('secret', 'TimeoutError'); } });
  assert.match(timeout.message, /timed out/);
  assert.ok(!timeout.message.includes('secret'));
});


test('timestamps preserve non-minute boundaries and ignore local timezone', () => {
  const previous = process.env.TZ;
  try {
    const texts = ['America/New_York', 'Asia/Kolkata', 'Pacific/Auckland'].map((zone) => {
      process.env.TZ = zone;
      return formatUsageReport({ ok: true, quota: { ...quota, window_seconds: 61 } }).text;
    });
    assert.equal(new Set(texts).size, 1);
    assert.match(texts[0], /Resets\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC/);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
