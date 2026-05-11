// Global negative-clamp 'input' listener test.
//
// Pins the behaviour of the capture-phase `document.addEventListener
// ('input', ...)` declared at index.html:3160. The listener clamps
// type=number inputs to 0 when the user types a negative value, with
// an exempt-list for fields that have their own handling
// (inflationRate, interestRate, clientAge, spouseAge, youngDepAge,
// yearsResp, parentAge).
//
// Real-world coverage note: v4.21 converted every currency field to
// type="text" + inline oninput strip — those fields are NOT clamped
// by this listener (type !== 'number' early-return). Defence comes
// from the inline `oninput="this.value=this.value.replace(/-/g,'')"`
// handlers instead. The listener still actively defends the
// policy/medical number fields (p${i}death, p${i}rb, ...) which
// remain type="number".
//
// Run with:   node --test tests/input-listener.test.mjs

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

// Pull both the exempt-set constant and the listener body. We rebuild
// the listener as a callable function in the sandbox so we can fire
// synthetic events at it without standing up a full event-target.
const exemptDecl = extract(/const _NO_NEG_EXEMPT\s*=\s*new Set\([^)]+\);/m, '_NO_NEG_EXEMPT');
const listenerBlock = extract(
  /document\.addEventListener\('input', function\(e\)\{[\s\S]*?\}, true\);/m,
  'input listener',
);

// Recover the listener body (between `function(e){` and the matching
// `}, true);`) so we can wrap it in a regular function.
const bodyMatch = listenerBlock.match(/function\(e\)\{([\s\S]*?)\}, true\);/);
if (!bodyMatch) throw new Error('Could not isolate listener body');
const listenerBody = bodyMatch[1];

const code =
  exemptDecl + '\n' +
  `function clamp(e){ ${listenerBody} }\n`;

function makeSandbox() {
  const sb = {
    Math, Number, parseInt, parseFloat, isNaN, isFinite, Set,
    console: { log() {}, warn() {} },
  };
  vm.createContext(sb);
  vm.runInContext(code + '\n;this.clamp = clamp;', sb);
  return sb;
}

// Build a fake event mirror of `{ target: element }`.
function evt(el) { return { target: el }; }

// ════════════════════════════════════════════════════════════════════
//  Tests
// ════════════════════════════════════════════════════════════════════

test('clamps negative value on a non-exempt type=number field', () => {
  const sb = makeSandbox();
  const el = { id: 'p1death', type: 'number', value: '-500' };
  sb.clamp(evt(el));
  assert.equal(el.value, 0, 'negative value on policy field should clamp to 0');
});

test('leaves positive values untouched on non-exempt type=number fields', () => {
  const sb = makeSandbox();
  const el = { id: 'p1death', type: 'number', value: '350000' };
  sb.clamp(evt(el));
  assert.equal(el.value, '350000');
});

test('leaves zero value untouched (boundary case)', () => {
  const sb = makeSandbox();
  const el = { id: 'p1death', type: 'number', value: '0' };
  sb.clamp(evt(el));
  assert.equal(el.value, '0');
});

test('exempt list: clientAge keeps negative values (inline handler clamps instead)', () => {
  // The listener returns early for exempt ids. The inline oninput
  // on each exempt field does the actual clamping — verified by
  // grepping `oninput="if(this.value<0)this.value=0"` in markup.
  const sb = makeSandbox();
  const el = { id: 'clientAge', type: 'number', value: '-30' };
  sb.clamp(evt(el));
  assert.equal(el.value, '-30',
    'listener must not touch exempt ids (inline handler owns clamping)');
});

test('exempt list: every documented age/rate field is in the set', () => {
  // Pin the contract: a refactor that drops one of these fields
  // would change behaviour.
  const sb = makeSandbox();
  // [...result] copies the cross-realm array into a host Array so
  // deepEqual's prototype check passes.
  const exempt = [...vm.runInContext('[..._NO_NEG_EXEMPT]', sb)].sort();
  assert.deepEqual(exempt, [
    'clientAge', 'inflationRate', 'interestRate', 'parentAge',
    'spouseAge', 'yearsResp', 'youngDepAge',
  ]);
});

test('skips type=text fields entirely (v4.21 currency-field convention)', () => {
  // Currency fields are type="text" + inline oninput strip. The
  // listener short-circuits on the type check so these fields are
  // never touched by it.
  const sb = makeSandbox();
  const el = { id: 'homeBalance', type: 'text', value: '-1000' };
  sb.clamp(evt(el));
  assert.equal(el.value, '-1000',
    'listener must not modify type=text inputs even when value is negative');
});

test('skips type=checkbox / type=date / type=hidden', () => {
  const sb = makeSandbox();
  for (const type of ['checkbox', 'date', 'hidden', 'radio']) {
    const el = { id: 'x', type, value: '-50' };
    sb.clamp(evt(el));
    assert.equal(el.value, '-50', `type="${type}" should be ignored`);
  }
});

test('NaN value (e.g. empty string after partial typing) is left alone', () => {
  const sb = makeSandbox();
  // Empty string → parseFloat → NaN → !isNaN check fails → no mutation.
  const el = { id: 'p1death', type: 'number', value: '' };
  sb.clamp(evt(el));
  assert.equal(el.value, '');
  // Non-numeric text in a number field is unusual but parseFloat('-')
  // returns NaN too; assert no spurious clamp.
  const el2 = { id: 'p1death', type: 'number', value: '-' };
  sb.clamp(evt(el2));
  assert.equal(el2.value, '-');
});

test('decimal negatives clamp to 0', () => {
  const sb = makeSandbox();
  const el = { id: 'p1prem', type: 'number', value: '-12.5' };
  sb.clamp(evt(el));
  assert.equal(el.value, 0);
});
