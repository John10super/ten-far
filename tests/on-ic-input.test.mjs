// onIcInput test: pinning the IC → age wiring.
//
// onIcInput is the handler bound to the icNum input. It reads the IC,
// calls calcNextBirthdayAge, writes to #clientAge.value, toggles
// #ageAutoTag visibility, and calls recalc() both before and after
// the age update. We test the wiring; calcNextBirthdayAge itself is
// already covered in calc.test.mjs.
//
// Run with:   node --test tests/on-ic-input.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

function extract(pattern, label) {
  const m = src.match(pattern);
  if (!m) throw new Error(`Could not extract ${label} from index.html`);
  return m[0];
}

const code = [
  extract(/function calcNextBirthdayAge\(ic\)\s*\{[\s\S]*?\n\}/m, 'calcNextBirthdayAge'),
  extract(/function onIcInput\(\)\s*\{[\s\S]*?\n\}/m,             'onIcInput'),
].join('\n');

function makeElement(opts = {}) {
  return {
    id:    opts.id    ?? '',
    value: opts.value ?? '',
    style: { display: opts.display ?? '' },
  };
}

function makeDoc(initial = {}) {
  const elems = new Map(Object.entries(initial).map(([id, init]) =>
    [id, makeElement({ id, ...init })]));
  return {
    _elems: elems,
    getElementById(id) {
      let el = elems.get(id);
      if (!el) { el = makeElement({ id }); elems.set(id, el); }
      return el;
    },
  };
}

function makeSandbox(doc, recalcSpy) {
  const sb = {
    document: doc, Date, Math, Number, parseInt, parseFloat, isNaN, isFinite,
    console: { log() {}, warn() {} },
  };
  vm.createContext(sb);
  vm.runInContext(`function recalc(){ globalThis.__recalc_calls = (globalThis.__recalc_calls||0)+1; }\n` +
    code + '\n;this.onIcInput = onIcInput;', sb);
  return sb;
}

// Spy helper — onIcInput calls recalc() before and after.
function countRecalcCalls(sb) {
  // The stub increments a globalThis counter; reset between asserts.
  return vm.runInContext('globalThis.__recalc_calls || 0', sb);
}
function resetRecalcCount(sb) {
  vm.runInContext('globalThis.__recalc_calls = 0;', sb);
}

// ════════════════════════════════════════════════════════════════════
//  Tests
// ════════════════════════════════════════════════════════════════════

test('onIcInput: valid IC populates clientAge and shows the auto tag', () => {
  // Pick a YY that resolves to 1990 reliably (yy > curYY case in
  // 2026 means yy starting from ~27 maps to 1927; use a known-old IC).
  const doc = makeDoc({
    icNum:      { value: '880101-13-5678' },
    clientAge:  { value: '' },
    ageAutoTag: { display: 'none' },
  });
  const sb = makeSandbox(doc);
  resetRecalcCount(sb);

  sb.onIcInput();

  const age = doc.getElementById('clientAge').value;
  assert.ok(parseInt(age, 10) > 0, `clientAge should be a positive integer, got "${age}"`);
  assert.equal(doc.getElementById('ageAutoTag').style.display, 'inline');
  // recalc is called twice on the happy path: once at entry, once
  // after writing the age.
  assert.equal(countRecalcCalls(sb), 2);
});

test('onIcInput: malformed IC hides the auto tag and does NOT overwrite clientAge', () => {
  const doc = makeDoc({
    icNum:      { value: 'abc' },     // calcNextBirthdayAge → null
    clientAge:  { value: '42' },      // pre-existing user value
    ageAutoTag: { display: 'inline' },
  });
  const sb = makeSandbox(doc);
  resetRecalcCount(sb);

  sb.onIcInput();

  // ageAutoTag is hidden; clientAge is left as the user typed it.
  assert.equal(doc.getElementById('ageAutoTag').style.display, 'none');
  assert.equal(doc.getElementById('clientAge').value, '42');
  // recalc is called once (only the entry recalc; the post-update
  // recalc only fires when age !== null).
  assert.equal(countRecalcCalls(sb), 1);
});

test('onIcInput: empty IC hides the tag and triggers exactly one recalc', () => {
  const doc = makeDoc({
    icNum:      { value: '' },
    clientAge:  { value: '' },
    ageAutoTag: { display: 'inline' },
  });
  const sb = makeSandbox(doc);
  resetRecalcCount(sb);

  sb.onIcInput();
  assert.equal(doc.getElementById('ageAutoTag').style.display, 'none');
  assert.equal(countRecalcCalls(sb), 1);
});

test('onIcInput: dashed and spaced IC strings produce the same age', () => {
  const a = (() => {
    const doc = makeDoc({
      icNum: { value: '880101-13-5678' },
      clientAge: { value: '' },
      ageAutoTag: { display: 'none' },
    });
    makeSandbox(doc).onIcInput();
    return doc.getElementById('clientAge').value;
  })();
  const b = (() => {
    const doc = makeDoc({
      icNum: { value: '880101 13 5678' },
      clientAge: { value: '' },
      ageAutoTag: { display: 'none' },
    });
    makeSandbox(doc).onIcInput();
    return doc.getElementById('clientAge').value;
  })();
  assert.equal(a, b);
  assert.ok(a !== '', 'sanity: age must be populated');
});
