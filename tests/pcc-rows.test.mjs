// Plan-Comparison row-toggle tests for pccRowOn / pccRowOff /
// pccRowToggle / pccRestoreRows.
//
// These functions show/hide optional rows in the plan-comparison
// table (TPD, CI, ECI, Medical-Card) and clear the underlying
// per-plan inputs when a row is toggled off. pccRestoreRows is called
// from loadRecord to re-show rows that have data.
//
// Run with:   node --test tests/pcc-rows.test.mjs

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

// The pcc* functions in source end with `recalc();}` on the same
// line — there's no `\n}` for a `\}\s*$/m` regex to anchor to.
// Capture up to the next top-level `function ` declaration instead.
const code = [
  extract(/function pccRowOn\(type\)\{[\s\S]*?(?=\nfunction )/m,         'pccRowOn'),
  extract(/function pccRowOff\(type\)\{[\s\S]*?(?=\nfunction )/m,        'pccRowOff'),
  extract(/function pccRowToggle\(type\)\{[\s\S]*?(?=\nfunction )/m,     'pccRowToggle'),
  extract(/function pccRestoreRows\(\)\{[\s\S]*?(?=\nfunction )/m,       'pccRestoreRows'),
].join('\n');

const STUBS = `function recalc(){}`;

function makeClassList() {
  const set = new Set();
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    contains: (c) => set.has(c),
    toggle: (c, force) => {
      const want = force === undefined ? !set.has(c) : !!force;
      if (want) set.add(c); else set.delete(c);
      return want;
    },
  };
}

function makeElement(opts = {}) {
  return {
    id:    opts.id    ?? '',
    value: opts.value ?? '',
    style: { display: opts.display ?? '' },
    classList: makeClassList(),
  };
}

function makeDoc() {
  const elems = new Map();
  // pcc-mc-rows class collection — separate so querySelectorAll
  // can return them as a stable list.
  const mcRows = [];
  return {
    _elems: elems,
    _add(id, init) { const e = makeElement({ id, ...init }); elems.set(id, e); return e; },
    _addMcRow(el)  { mcRows.push(el); return el; },
    getElementById(id) {
      let el = elems.get(id);
      if (!el) { el = makeElement({ id }); elems.set(id, el); }
      return el;
    },
    querySelectorAll(sel) {
      if (sel === '.pcc-mc-rows') return mcRows;
      return [];
    },
  };
}

function makeSandbox(doc) {
  const sb = {
    document: doc, Math, Number, parseInt, parseFloat, isNaN, isFinite,
    console: { log() {}, warn() {} },
  };
  vm.createContext(sb);
  vm.runInContext(STUBS + '\n' + code +
    '\n;Object.assign(this, {pccRowOn, pccRowOff, pccRowToggle, pccRestoreRows});', sb);
  return sb;
}

// Build the full set of pcc elements: rows, buttons, plan inputs, mc
// fields. Returns the doc populated with everything.
function setupDoc() {
  const doc = makeDoc();
  // Row containers
  for (const type of ['tpd', 'ci', 'eci']) {
    doc._add(`pcc_row_${type}`,    { display: 'none' });
    doc._add(`addcov_${type}_btn`);
  }
  doc._add('addcov_mc_btn');
  // Two mc rows (the actual table has more, but we just need >0)
  doc._addMcRow(doc._add('pcc_mc_row_a', { display: 'none' }));
  doc._addMcRow(doc._add('pcc_mc_row_b', { display: 'none' }));
  // Per-plan inputs
  for (const pl of ['A','B','C']) {
    for (const t of ['tpd','ci','eci']) doc._add(`plan${pl}_${t}`);
    for (const f of ['rb','al','ll']) doc._add(`plan${pl}_mc_${f}`);
    doc._add(`plan${pl}_mc_cp`);
  }
  return doc;
}

// ════════════════════════════════════════════════════════════════════
//  Tests
// ════════════════════════════════════════════════════════════════════

test('pccRowOn: shows the targeted row and marks the button active', () => {
  const doc = setupDoc();
  makeSandbox(doc).pccRowOn('tpd');
  assert.equal(doc.getElementById('pcc_row_tpd').style.display, 'table-row');
  assert.ok(doc.getElementById('addcov_tpd_btn').classList.contains('pcc-addcov-active'));
});

test('pccRowOn("mc"): shows every .pcc-mc-rows element and marks button active', () => {
  const doc = setupDoc();
  makeSandbox(doc).pccRowOn('mc');
  assert.equal(doc.getElementById('pcc_mc_row_a').style.display, 'table-row');
  assert.equal(doc.getElementById('pcc_mc_row_b').style.display, 'table-row');
  assert.ok(doc.getElementById('addcov_mc_btn').classList.contains('pcc-addcov-active'));
});

test('pccRowOff: hides the row, clears plan A/B/C inputs, removes button active class', () => {
  const doc = setupDoc();
  const sb  = makeSandbox(doc);
  // Pre-populate the three plan inputs and mark active.
  for (const pl of ['A','B','C']) doc.getElementById(`plan${pl}_tpd`).value = '99000';
  sb.pccRowOn('tpd');

  sb.pccRowOff('tpd');

  assert.equal(doc.getElementById('pcc_row_tpd').style.display, 'none');
  assert.ok(!doc.getElementById('addcov_tpd_btn').classList.contains('pcc-addcov-active'));
  for (const pl of ['A','B','C']) {
    assert.equal(doc.getElementById(`plan${pl}_tpd`).value, '',
      `plan${pl}_tpd should be cleared when TPD row is toggled off`);
  }
});

test('pccRowOff("mc"): clears ALL 12 medical-card fields across plans', () => {
  const doc = setupDoc();
  const sb  = makeSandbox(doc);
  // Fill every mc field on every plan.
  for (const pl of ['A','B','C']) {
    for (const f of ['rb','al','ll']) doc.getElementById(`plan${pl}_mc_${f}`).value = '1000';
    doc.getElementById(`plan${pl}_mc_cp`).value = '50';
  }
  sb.pccRowOn('mc');

  sb.pccRowOff('mc');

  for (const pl of ['A','B','C']) {
    for (const f of ['rb','al','ll']) {
      assert.equal(doc.getElementById(`plan${pl}_mc_${f}`).value, '',
        `plan${pl}_mc_${f} should be cleared`);
    }
    assert.equal(doc.getElementById(`plan${pl}_mc_cp`).value, '',
      `plan${pl}_mc_cp should be cleared`);
  }
  for (const r of doc.querySelectorAll('.pcc-mc-rows')) {
    assert.equal(r.style.display, 'none');
  }
});

test('pccRowToggle: flips between on and off based on current state', () => {
  const doc = setupDoc();
  const sb  = makeSandbox(doc);
  // Initial: off (button has no active class)
  sb.pccRowToggle('tpd');
  assert.ok(doc.getElementById('addcov_tpd_btn').classList.contains('pcc-addcov-active'));
  assert.equal(doc.getElementById('pcc_row_tpd').style.display, 'table-row');

  sb.pccRowToggle('tpd');
  assert.ok(!doc.getElementById('addcov_tpd_btn').classList.contains('pcc-addcov-active'));
  assert.equal(doc.getElementById('pcc_row_tpd').style.display, 'none');
});

test('pccRestoreRows: shows tpd/ci/eci rows that have any plan value > 0', () => {
  const doc = setupDoc();
  // Seed: planB_ci has data → ci row should restore.
  doc.getElementById('planB_ci').value = '50000';
  // tpd and eci rows have no plan values → stay hidden.
  makeSandbox(doc).pccRestoreRows();

  assert.equal(doc.getElementById('pcc_row_ci').style.display,  'table-row');
  assert.equal(doc.getElementById('pcc_row_tpd').style.display, 'none');
  assert.equal(doc.getElementById('pcc_row_eci').style.display, 'none');
});

test('pccRestoreRows: handles comma-formatted values when checking presence', () => {
  const doc = setupDoc();
  // The function strips commas before parseFloat — '50,000' should count.
  doc.getElementById('planA_tpd').value = '50,000';
  makeSandbox(doc).pccRestoreRows();
  assert.equal(doc.getElementById('pcc_row_tpd').style.display, 'table-row');
});

test('pccRestoreRows: shows mc rows when any medical-card field has data', () => {
  const doc = setupDoc();
  // Even a non-numeric cp value (text co-payment description) triggers
  // restore — the function checks both numeric and the trimmed cp string.
  doc.getElementById('planA_mc_cp').value = 'RM200 per visit';
  makeSandbox(doc).pccRestoreRows();
  for (const r of doc.querySelectorAll('.pcc-mc-rows')) {
    assert.equal(r.style.display, 'table-row');
  }
});

test('pccRestoreRows: zero-only values do NOT trigger row restoration', () => {
  const doc = setupDoc();
  // All plan values are 0 or empty — no row should restore.
  doc.getElementById('planA_tpd').value = '0';
  doc.getElementById('planB_ci').value  = '';
  makeSandbox(doc).pccRestoreRows();
  for (const type of ['tpd','ci','eci']) {
    assert.equal(doc.getElementById(`pcc_row_${type}`).style.display, 'none');
  }
});
