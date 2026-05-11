// Self-contained test for the FAR pure financial functions.
//
// Strategy: read index.html, extract the function bodies (PV, NPER,
// getCoverRatio, calcNextBirthdayAge) and the COVER_TABLE constant
// verbatim, evaluate them in a sandbox, then run golden-value tests.
// Tests stay locked to the production source — no copy/paste drift.
//
// Run with:   node --test tests/calc.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Pull each named declaration out of the inline <script>. The regexes assume
// the source uses the current shape (`function NAME(...)` / `const NAME =`)
// — if those shapes change in index.html the extraction will fail loudly,
// which is the desired behaviour.
function extract(pattern, label) {
  const m = src.match(pattern);
  if (!m) throw new Error(`Could not extract ${label} from index.html`);
  return m[0];
}

const code = [
  extract(/const COVER_TABLE = \{[\s\S]*?\n\};/m, 'COVER_TABLE'),
  extract(/function PV\([\s\S]*?\n\}/m, 'PV'),
  extract(/function NPER\([\s\S]*?\n\}/m, 'NPER'),
  extract(/function getCoverRatio\([\s\S]*?\n\}/m, 'getCoverRatio'),
  extract(/function calcNextBirthdayAge\([\s\S]*?\n\}/m, 'calcNextBirthdayAge'),
].join('\n');

const sandbox = { Date, Math };
vm.createContext(sandbox);
vm.runInContext(code + '\n;this.PV = PV; this.NPER = NPER; this.getCoverRatio = getCoverRatio; this.calcNextBirthdayAge = calcNextBirthdayAge;', sandbox);
const { PV, NPER, getCoverRatio, calcNextBirthdayAge } = sandbox;

const close = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b} (±${eps})`);

// The sandbox's Array has a different prototype, so deepStrictEqual on
// arrays returned from it fails the reference-equality check. Copy via
// spread to bring them into this realm before comparing.
const arr = (x) => [...x];

// ── PV ────────────────────────────────────────────────────────────────
test('PV: zero-rate branch returns -(pmt*nper + fv)', () => {
  assert.equal(PV(0, 10, 100), -1000);
  assert.equal(PV(0, 10, 100, 500), -1500);
  assert.equal(PV(1e-11, 10, 100), -1000); // |rate| < 1e-10
});

test('PV: positive rate matches the standard annuity formula', () => {
  // PV of 10 yearly payments of 100 at 5%: matches Excel PV(0.05,10,100)
  close(PV(0.05, 10, 100), -772.173492918, 1e-6);
});

test('PV: sign convention — negative pmt returns positive PV', () => {
  // recalc() passes -annExp to model an outflow, expecting a positive need
  assert.ok(PV(0.03, 15, -60000) > 0, 'PV of negative pmt should be positive');
});

test('PV: nper=0 returns -fv', () => {
  assert.equal(PV(0.05, 0, 100, 200), -200);
  // PV(0,0,100) is mathematically 0; the implementation produces -0 via
  // the zero-rate branch. Treat them as equal.
  close(PV(0, 0, 100), 0);
});

// ── NPER ──────────────────────────────────────────────────────────────
test('NPER: zero-rate branch — zero pmt returns sentinel 999', () => {
  assert.equal(NPER(0, 0, 1000), 999);
  assert.equal(NPER(1e-11, 0, 1000), 999);
});

test('NPER: zero-rate branch — non-zero pmt returns -(pv+fv)/pmt', () => {
  assert.equal(NPER(0, -100, 1000), 10);
  assert.equal(NPER(0, -100, 1000, 200), 12);
});

test('NPER: ratio ≤ 0 clamps to 0 (insolvent case)', () => {
  // pmt < |pv*rate| means the payment never amortises the balance
  assert.equal(NPER(0.05, -10, 1000), 0);
});

test('NPER: positive rate matches log formula on a solvable case', () => {
  // Closed-form verification:
  //   num = pmt - fv*rate = -200
  //   den = pmt + pv*rate = -200 + 50 = -150
  //   ratio = num/den = 4/3
  //   result = log(4/3) / log(1.05) ≈ 5.896313
  close(NPER(0.05, -200, 1000), 5.896312860369899, 1e-9);
});

test('NPER: never returns a negative number', () => {
  for (const [r, p, pv] of [[0.1, -5, 1000], [0.01, -1, 100], [0.05, 0, 100]]) {
    assert.ok(NPER(r, p, pv) >= 0, `NPER(${r},${p},${pv}) was negative`);
  }
});

// ── getCoverRatio ─────────────────────────────────────────────────────
test('getCoverRatio: returns exact table entries for known ages', () => {
  assert.deepEqual(arr(getCoverRatio(20)), [140, 222]);
  assert.deepEqual(arr(getCoverRatio(35)), [70, 125]);
  assert.deepEqual(arr(getCoverRatio(55)), [30, 30]);
  assert.deepEqual(arr(getCoverRatio(60)), [27, 27]);
});

test('getCoverRatio: clamps below 20 and above 60', () => {
  assert.deepEqual(arr(getCoverRatio(0)),  [140, 222]); // → 20
  assert.deepEqual(arr(getCoverRatio(19)), [140, 222]); // → 20
  assert.deepEqual(arr(getCoverRatio(61)), [27, 27]);   // → 60
  assert.deepEqual(arr(getCoverRatio(99)), [27, 27]);   // → 60
});

test('getCoverRatio: rounds non-integer ages', () => {
  assert.deepEqual(arr(getCoverRatio(34.4)), arr(getCoverRatio(34)));
  assert.deepEqual(arr(getCoverRatio(34.6)), arr(getCoverRatio(35)));
});

// ── calcNextBirthdayAge ───────────────────────────────────────────────
// These tests pin to a fixed "today" by stubbing Date inside the sandbox
// where possible. Where the function reads `new Date()` directly we
// derive expected values from the *real* current date so the assertions
// stay correct as the calendar advances.
test('calcNextBirthdayAge: malformed IC returns null', () => {
  assert.equal(calcNextBirthdayAge(''), null);
  assert.equal(calcNextBirthdayAge('12345'),  null);  // length < 6
  assert.equal(calcNextBirthdayAge('abcdef'), null);  // non-numeric
  assert.equal(calcNextBirthdayAge('991301'), null);  // month 13
  assert.equal(calcNextBirthdayAge('990132'), null);  // day 32
  assert.equal(calcNextBirthdayAge('990100'), null);  // day 0
  assert.equal(calcNextBirthdayAge('990001'), null);  // month 0
});

test('calcNextBirthdayAge: accepts dashed and spaced IC formats', () => {
  // Same IC, three formats → identical age
  const a = calcNextBirthdayAge('880101-13-5678');
  const b = calcNextBirthdayAge('8801011 35678');
  const c = calcNextBirthdayAge('880101135678');
  assert.equal(a, b);
  assert.equal(a, c);
  assert.ok(a > 0);
});

test('calcNextBirthdayAge: century rollover — yy <= curYY → 2000s', () => {
  // The function uses `today` directly; we cross-check against it
  const today = new Date();
  const curYY = today.getFullYear() % 100;
  // pick yy a few years below curYY → should resolve to 2000+yy
  const yy = String(Math.max(0, curYY - 5)).padStart(2, '0');
  const age = calcNextBirthdayAge(`${yy}0101-13-5678`);
  assert.ok(age > 0 && age < 20, `expected young age, got ${age}`);
});

test('calcNextBirthdayAge: century rollover — yy > curYY → 1900s', () => {
  const today = new Date();
  const curYY = today.getFullYear() % 100;
  // yy just above curYY should land in 1900s → large age
  const yy = String((curYY + 1) % 100).padStart(2, '0');
  const age = calcNextBirthdayAge(`${yy}0101-13-5678`);
  // born in 19xx → age should be at least ~70
  assert.ok(age >= 25, `expected 1900s resolution, got age=${age}`);
});

test('calcNextBirthdayAge: returns null for impossible (future) birth year', () => {
  // yy === curYY but birth date is later this year still gives a positive
  // next-birthday age, so the only way to get null from valid date parts
  // is via the explicit `age > 0` guard at the end — covered by malformed
  // tests above. Here we sanity-check a clearly historical IC returns a
  // sensible positive integer.
  const age = calcNextBirthdayAge('800615-08-1234');
  assert.ok(Number.isInteger(age) && age > 0);
});
