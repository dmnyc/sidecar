'use strict';

// Unit coverage for the price chart's series maths in sidepanel.js:
// decimateSeries() and nearestTimeIndex().
//
// Both exist because the chart gained historical ranges. ALL arrives as ~32,000
// hourly points from mempool.space drawn into a 300-unit viewBox — measured, only
// ~1,400 land on distinct x positions, so the rest overplot and the SVG path
// string runs to 379 KB. Spreading that many arguments through Math.min(...series)
// also flirts with a call-stack overflow.
//
// The decimator's contract is what these tests pin: fewer points, but the same
// visible shape. Keeping one point per bucket would be smaller still and wrong —
// it flattens exactly the volatility a price chart exists to show.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

function lift(pattern, label) {
  const m = source.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in sidepanel.js');
  return m[0];
}

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(
  lift(/function decimateSeries\(values, times, buckets\)\s*\{[\s\S]*?\n  \}/, 'decimateSeries') + '\n' +
  lift(/function nearestTimeIndex\(times, target\)\s*\{[\s\S]*?\n  \}/, 'nearestTimeIndex') + '\n' +
  'globalThis.decimateSeries = decimateSeries; globalThis.nearestTimeIndex = nearestTimeIndex;',
  ctx
);
const { decimateSeries, nearestTimeIndex } = ctx;

const HOUR = 3600 * 1000;

// An hourly series with a known spike and trough buried mid-way, so decimation has
// something specific it must not lose.
function makeSeries(n, { spikeAt, spikeTo, dipAt, dipTo } = {}) {
  const values = [], times = [];
  for (let i = 0; i < n; i++) {
    times.push(1_600_000_000_000 + i * HOUR);
    values.push(100 + Math.sin(i / 7) * 5);
  }
  if (spikeAt != null) values[spikeAt] = spikeTo;
  if (dipAt != null) values[dipAt] = dipTo;
  return { values, times };
}

test('a series already small enough is returned untouched', () => {
  const s = makeSeries(120);
  const out = decimateSeries(s.values, s.times, 300);
  assert.equal(out.values, s.values, 'same array reference — no copying work done');
  assert.equal(out.times, s.times);
});

test('a long series is thinned to roughly two points per bucket', () => {
  const s = makeSeries(32000);
  const out = decimateSeries(s.values, s.times, 300);
  assert.ok(out.values.length <= 602, 'got ' + out.values.length + ', expected <= 602');
  assert.ok(out.values.length >= 300, 'should not collapse below one point per bucket');
  assert.equal(out.values.length, out.times.length, 'values and times must stay the same length');
});

test('the extremes survive — this is the point of keeping two per bucket', () => {
  const s = makeSeries(32000, { spikeAt: 15000, spikeTo: 9999, dipAt: 20000, dipTo: 1 });
  const out = decimateSeries(s.values, s.times, 300);
  assert.equal(Math.max(...out.values), 9999, 'the spike must not be averaged away');
  assert.equal(Math.min(...out.values), 1, 'the trough must not be averaged away');
});

test('the final point is always kept — it is what the balance is showing', () => {
  const s = makeSeries(32000);
  s.values[31999] = 777;
  const out = decimateSeries(s.values, s.times, 300);
  assert.equal(out.values[out.values.length - 1], 777);
  assert.equal(out.times[out.times.length - 1], s.times[31999]);
});

test('time stays monotonic, so the trace never doubles back', () => {
  const s = makeSeries(32000, { spikeAt: 15000, spikeTo: 9999, dipAt: 15001, dipTo: 1 });
  const out = decimateSeries(s.values, s.times, 300);
  for (let i = 1; i < out.times.length; i++) {
    assert.ok(out.times[i] >= out.times[i - 1], 'time went backwards at index ' + i);
  }
});

// Uneven spacing is the norm, not an edge case: mempool's early history steps in
// days while recent points step in hours.
test('handles wildly uneven spacing without dropping the sparse end', () => {
  const values = [], times = [];
  for (let i = 0; i < 400; i++) { times.push(1_200_000_000_000 + i * 7 * 24 * HOUR); values.push(1 + i); }
  const base = times[times.length - 1];
  for (let i = 1; i <= 5000; i++) { times.push(base + i * HOUR); values.push(1000 + (i % 50)); }
  const out = decimateSeries(values, times, 300);
  assert.ok(out.values.length <= 602);
  assert.equal(Math.min(...out.values), 1, 'the oldest sparse point must survive');
  assert.equal(out.times[0], times[0], 'the series must still start where it started');
});

test('a zero time span is left alone rather than divided by', () => {
  const n = 1000;
  const values = Array.from({ length: n }, (_, i) => i);
  const times = Array.from({ length: n }, () => 1_600_000_000_000); // all identical
  const out = decimateSeries(values, times, 300);
  assert.equal(out.values.length, n, 'no span to bucket by — return as-is');
});

test('nearestTimeIndex picks the closest point, not the preceding one', () => {
  const times = [0, 100, 200, 300, 400];
  assert.equal(nearestTimeIndex(times, 0), 0);
  assert.equal(nearestTimeIndex(times, 149), 1, '149 is nearer 100');
  assert.equal(nearestTimeIndex(times, 151), 2, '151 is nearer 200');
  assert.equal(nearestTimeIndex(times, 400), 4);
});

test('nearestTimeIndex clamps outside the range', () => {
  const times = [1000, 2000, 3000];
  assert.equal(nearestTimeIndex(times, -5000), 0);
  assert.equal(nearestTimeIndex(times, 99999), 2);
});

test('nearestTimeIndex survives degenerate input', () => {
  assert.equal(nearestTimeIndex([], 5), 0);
  assert.equal(nearestTimeIndex([42], 5), 0);
});

// The reason x maps from time rather than index: on ALL, index 8% is ~2013 while
// time 8% is ~2011. A pointer at 8% across the element must find the point that is
// actually drawn there.
test('scrubbing an unevenly spaced series lands where the trace is drawn', () => {
  const times = [0, 10, 20, 30, 40, 1000, 2000, 3000]; // dense start, sparse tail
  const frac = 0.5;
  const target = times[0] + frac * (times[times.length - 1] - times[0]);
  const byTime = nearestTimeIndex(times, target);
  const byIndex = Math.round(frac * (times.length - 1));
  assert.equal(byTime, 5, 'half-way through the TIME span is the 1000 point');
  assert.notEqual(byTime, byIndex, 'index mapping would have picked a different point');
});
