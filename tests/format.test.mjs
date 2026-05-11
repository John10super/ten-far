// Format / parsing helper tests. Protects:
//   - v4.21 negative-number guard (fmtInput clamps to 0)
//   - v4.21 comma-formatting round-trip (input → display → read)
//   - the comma-strip in n(id) used everywhere recalc() reads values
//   - the NaN/Infinity/0 special cases in fmt / fmtRaw / fmtNum
//
// Self-contained: extracts function bodies from index.html, stubs the
// minimal `document` surface the helpers touch.
//
// Run with:   node --test tests/format.test.mjs

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

// Each helper is a one-or-three-line function — extract by exact name.
const code = [
  extract(/^function n\(id\)[^\n]*$/m,            'n'),
  extract(/^function s\(id\)[^\n]*$/m,            's'),
  extract(/^function fmtInput\(el\)[^\n]*$/m,     'fmtInput'),
  extract(/^function unFmtInput\(el\)[^\n]*$/m,   'unFmtInput'),
  extract(/^function formatAllInputs\(\)[^\n]*$/m,'formatAllInputs'),
  extract(/^function fmt\(v, d=0\) \{[\s\S]*?\n\}/m,                  'fmt'),
  extract(/^function fmtRaw\(v, d=0\) \{[\s\S]*?\n\}/m,               'fmtRaw'),
  extract(/^function fmtNum\(v, d=0, suffix=''\) \{[\s\S]*?\n\}/m,    'fmtNum'),
].join('\n');

// ── minimal DOM stub ──────────────────────────────────────────────────
// Only what these helpers actually touch: getElementById(id).value and
// querySelectorAll(selector).forEach. The stub is rebuilt per test.
function makeDoc(initial = {}) {
  const elems = new Map();
  for (const [id, value] of Object.entries(initial)) {
    elems.set(id, { value: String(value), select() {} });
  }
  return {
    getElementById: (id) => elems.get(id) || null,
    // Tests that exercise formatAllInputs populate this manually.
    _fmtTargets: [],
    querySelectorAll(sel) {
      assert.equal(sel, "input[data-fmt='1']");
      return this._fmtTargets;
    },
    _elems: elems,
  };
}

function makeSandbox(doc) {
  const sb = { document: doc, Math, Number, parseInt, parseFloat, isNaN, isFinite };
  vm.createContext(sb);
  vm.runInContext(
    code + '\n;this.n=n;this.s=s;this.fmtInput=fmtInput;this.unFmtInput=unFmtInput;' +
    'this.formatAllInputs=formatAllInputs;this.fmt=fmt;this.fmtRaw=fmtRaw;this.fmtNum=fmtNum;',
    sb,
  );
  return sb;
}

// ── n(id) ─────────────────────────────────────────────────────────────
test('n: returns 0 when element is missing', () => {
  const { n } = makeSandbox(makeDoc());
  assert.equal(n('nope'), 0);
});

test('n: parses plain numbers', () => {
  const { n } = makeSandbox(makeDoc({ a: '0', b: '42', c: '1234.5' }));
  assert.equal(n('a'), 0);
  assert.equal(n('b'), 42);
  assert.equal(n('c'), 1234.5);
});

test('n: strips comma thousands separators before parsing', () => {
  const { n } = makeSandbox(makeDoc({
    a: '1,234',
    b: '1,234,567',
    c: '10,000.50',
  }));
  assert.equal(n('a'), 1234);
  assert.equal(n('b'), 1234567);
  assert.equal(n('c'), 10000.5);
});

test('n: empty / non-numeric value returns 0 (no NaN leakage)', () => {
  const { n } = makeSandbox(makeDoc({ a: '', b: 'abc', c: '   ' }));
  assert.equal(n('a'), 0);
  assert.equal(n('b'), 0);
  assert.equal(n('c'), 0);
});

test('n: tolerates negative values from raw HTML (caller is expected to clamp)', () => {
  // Note: n() itself does not clamp — fmtInput is the layer that
  // enforces non-negative on blur. This pins the contract so we know
  // if someone changes either side.
  const { n } = makeSandbox(makeDoc({ a: '-50' }));
  assert.equal(n('a'), -50);
});

// ── s(id) ─────────────────────────────────────────────────────────────
test('s: returns the raw string value, empty string for missing element', () => {
  const { s } = makeSandbox(makeDoc({ name: 'Ahmad' }));
  assert.equal(s('name'),    'Ahmad');
  assert.equal(s('missing'), '');
});

// ── fmtInput / unFmtInput round-trip ─────────────────────────────────
test('fmtInput: adds comma thousands separators on blur', () => {
  const { fmtInput } = makeSandbox(makeDoc());
  const el = { value: '1234567' };
  fmtInput(el);
  assert.equal(el.value, '1,234,567');
});

test('fmtInput: empty input is left untouched (no "0" injected)', () => {
  const { fmtInput } = makeSandbox(makeDoc());
  const el = { value: '' };
  fmtInput(el);
  assert.equal(el.value, '');
});

test('fmtInput: v4.21 — strips non-digits and clamps negatives to 0', () => {
  const { fmtInput } = makeSandbox(makeDoc());
  // Negative sign and other punctuation get stripped before parseInt;
  // any leftover that parses negative is clamped via the NaN/<0 guard.
  // Quirk: when the digit-stripped raw is empty (e.g. pure non-digit
  // input like "abc"), the function returns early WITHOUT mutating
  // el.value — original garbage is left in the field. The oninput
  // handlers in markup do a separate strip on every keystroke, so in
  // practice this only matters for pasted text on the very first blur.
  for (const [input, expected] of [
    ['-500',    '500'],     // sign stripped → 500
    ['1,234',   '1,234'],   // already-formatted round-trip
    ['abc',     'abc'],     // empty raw → early return, original kept
    ['12.50',   '1,250'],   // decimal point stripped (text mode is integer-only)
    ['0',       '0'],
  ]) {
    const el = { value: input };
    fmtInput(el);
    assert.equal(el.value, expected, `fmtInput("${input}") → "${el.value}", expected "${expected}"`);
  }
});

test('unFmtInput: removes commas (focus handler)', () => {
  const { unFmtInput } = makeSandbox(makeDoc());
  const el = { value: '1,234,567', select() { this._selected = true; } };
  unFmtInput(el);
  assert.equal(el.value, '1234567');
  assert.equal(el._selected, true, 'should call .select() to ease editing');
});

test('unFmtInput: tolerates element without select()', () => {
  const { unFmtInput } = makeSandbox(makeDoc());
  const el = { value: '1,234' }; // no select method
  unFmtInput(el); // must not throw
  assert.equal(el.value, '1234');
});

test('round-trip: unFmtInput(fmtInput(x)) === x for non-negative integers', () => {
  const { fmtInput, unFmtInput } = makeSandbox(makeDoc());
  for (const x of ['0', '1', '42', '1234', '1234567', '999999999']) {
    const el = { value: x, select() {} };
    fmtInput(el);
    unFmtInput(el);
    assert.equal(el.value, x, `round-trip failed for ${x}: got ${el.value}`);
  }
});

// ── formatAllInputs ───────────────────────────────────────────────────
test('formatAllInputs: applies fmtInput to every [data-fmt="1"] input', () => {
  const doc = makeDoc();
  const a = { value: '1000' }, b = { value: '500000' }, c = { value: '' };
  doc._fmtTargets = [a, b, c];
  const { formatAllInputs } = makeSandbox(doc);
  formatAllInputs();
  assert.equal(a.value, '1,000');
  assert.equal(b.value, '500,000');
  assert.equal(c.value, ''); // empty stays empty
});

// ── fmt / fmtRaw / fmtNum ─────────────────────────────────────────────
test('fmt: zero and non-finite values render as em dash', () => {
  const { fmt } = makeSandbox(makeDoc());
  assert.equal(fmt(0),        '—');
  assert.equal(fmt(NaN),      '—');
  assert.equal(fmt(Infinity), '—');
  assert.equal(fmt(-Infinity),'—');
});

test('fmt: positive values get RM prefix and en-MY grouping', () => {
  const { fmt } = makeSandbox(makeDoc());
  assert.equal(fmt(1234567), 'RM 1,234,567');
  assert.equal(fmt(450000),  'RM 450,000');
});

test('fmt: takes the absolute value of negatives (display only)', () => {
  // The function intentionally displays |v| — sign is conveyed by the
  // surrounding ✓/▼ glyph in needsTable. This pins the behaviour so a
  // refactor doesn't accidentally start showing minus signs.
  const { fmt } = makeSandbox(makeDoc());
  assert.equal(fmt(-1000), 'RM 1,000');
});

test('fmt: respects fraction-digit argument', () => {
  const { fmt } = makeSandbox(makeDoc());
  assert.equal(fmt(1234.5, 2), 'RM 1,234.50');
});

test('fmtRaw: differs from fmt only by rendering 0 as em dash via the same shortcut', () => {
  const { fmt, fmtRaw } = makeSandbox(makeDoc());
  // Both treat 0 as em dash, both treat NaN/Infinity as em dash.
  assert.equal(fmtRaw(0),         '—');
  assert.equal(fmtRaw(NaN),       '—');
  assert.equal(fmtRaw(Infinity),  '—');
  // For non-zero finite values fmt and fmtRaw produce the same output.
  for (const v of [1, 999, 1234567, -50]) {
    assert.equal(fmtRaw(v), fmt(v), `divergence at v=${v}`);
  }
});

test('fmtNum: NaN/Infinity render as em dash, finite values include suffix', () => {
  const { fmtNum } = makeSandbox(makeDoc());
  assert.equal(fmtNum(NaN),                '—');
  assert.equal(fmtNum(Infinity),           '—');
  // fmtNum does NOT special-case 0 (unlike fmt) — this is intentional
  // for the risk-ratio table where "0.0 mo" is a meaningful display.
  assert.equal(fmtNum(0, 1, ' mo'),        '0.0 mo');
  assert.equal(fmtNum(36, 1, ' mo'),       '36.0 mo');
  assert.equal(fmtNum(1234.5, 1),          '1,234.5');
});
