// preparePrintView / restorePrintView row-visibility tests.
//
// These functions run on beforeprint/afterprint. They hide empty
// policy rows so printed reports don't show blank 14-row tables, and
// inject a "no coverage" notice when the entire medical table is
// blank. restorePrintView puts everything back the way it was for
// on-screen editing.
//
// Strategy: extract both functions from index.html and exercise them
// against a fake document where each row is an addressable element
// whose data is governed by per-row id values (p1death etc.).
//
// Run with:   node --test tests/print-view.test.mjs

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
  extract(/^function n\(id\)[^\n]*$/m,                             'n'),
  extract(/^function s\(id\)[^\n]*$/m,                             's'),
  extract(/function preparePrintView\(\)\s*\{[\s\S]*?\n\}/m,       'preparePrintView'),
  extract(/function restorePrintView\(\)\s*\{[\s\S]*?\n\}/m,       'restorePrintView'),
].join('\n');

// Stubs: L() is referenced for the "no coverage" notice; the row
// count globals + MAX constants must exist in scope.
const STUBS = `
  function L(k){ return k; }
  const LIFE_MAX = 15;
  const MED_MAX  = 5;
  let lifeVisibleRows = 1;
  let medVisibleRows  = 1;
`;

// ── DOM model ─────────────────────────────────────────────────────────
// preparePrintView walks #policyLifeBody and #policyMedBody, both <tbody>
// elements with a fixed number of <tr> children. Each <tr> has a
// `style.display`, and the medical first-row td:nth-child(2) is special:
// when the medical table is empty, prep stashes the cell's innerHTML in
// `dataset.printOrig` and overwrites it with the no-coverage notice.
//
// Inputs are read via n(id) and getElementById(id).value, so each row i
// needs id=`lifeRow${i}` (for restore) and the per-row input ids
// p${i}{co,pno,death,...} must resolve to elements with the fixture
// values.

function makeRow(id, td2Html = '') {
  // The first row's second cell holds the policy-company display in
  // production. We model it as one td so the .querySelector hits it.
  const cell = { innerHTML: td2Html, dataset: {} };
  return {
    id,
    style: { display: '' },
    cells: [cell],
    querySelector(sel) {
      if (sel === 'td:nth-child(2)') return cell;
      return null;
    },
  };
}

function makeBody(rowPrefix, count) {
  const rows = Array.from({ length: count }, (_, i) =>
    makeRow(`${rowPrefix}${i + 1}`,
      i === 0 ? '<span class="orig-co-name">AmMetLife</span>' : ''));
  return {
    rows,
    querySelectorAll(sel) {
      assert.equal(sel, 'tr');
      return rows;
    },
  };
}

function makeDoc(inputs = {}) {
  const elems = new Map();
  for (const [id, value] of Object.entries(inputs)) {
    elems.set(id, { id, value: String(value), checked: false, type: 'text' });
  }
  // The two tbody containers.
  const lifeBody = makeBody('lifeRow', 15);
  const medBody  = makeBody('medRow',  5);
  elems.set('policyLifeBody', lifeBody);
  elems.set('policyMedBody',  medBody);
  // Also register the rows by id so restorePrintView can find them.
  for (const r of lifeBody.rows) elems.set(r.id, r);
  for (const r of medBody.rows)  elems.set(r.id, r);
  return {
    _elems: elems,
    _life:  lifeBody,
    _med:   medBody,
    getElementById(id) {
      if (elems.has(id)) return elems.get(id);
      // Production code uses optional chaining + value-or-'' on these
      // reads, so returning null is safe.
      return null;
    },
  };
}

function makeSandbox(doc) {
  const sb = {
    document: doc,
    Math, Number, parseInt, parseFloat, isNaN, isFinite,
    console: { log() {}, warn() {} },
  };
  vm.createContext(sb);
  vm.runInContext(STUBS + '\n' + code +
    '\n;this.preparePrintView=preparePrintView;' +
    'this.restorePrintView=restorePrintView;' +
    'this.setLife=(v)=>{lifeVisibleRows=v};' +
    'this.setMed=(v)=>{medVisibleRows=v};', sb);
  return sb;
}

// ════════════════════════════════════════════════════════════════════
//  Tests
// ════════════════════════════════════════════════════════════════════

test('preparePrintView: with no life data at all, only row 1 is visible', () => {
  const doc = makeDoc({});
  makeSandbox(doc).preparePrintView();
  const rows = doc._life.rows;
  assert.equal(rows[0].style.display, '',     'row 1 should be visible');
  for (let i = 1; i < 15; i++) {
    assert.equal(rows[i].style.display, 'none',
      `row ${i + 1} should be hidden when life table is empty`);
  }
});

test('preparePrintView: hides empty life rows when some have data', () => {
  // Populate rows 1, 3, 7 with data; the rest should hide.
  const doc = makeDoc({
    p1co: 'AmMetLife', p1death: '350000',
    p3pno: 'AM-2024-8866', p3prem: '7200',
    p7ci: '100000',
  });
  makeSandbox(doc).preparePrintView();
  const rows = doc._life.rows;
  const visible = rows.map((r) => r.style.display !== 'none');
  // Rows with data → visible; rows without → hidden.
  assert.deepEqual(visible, [
    true,  false, true,  false, false, false, true,
    false, false, false, false, false, false, false, false,
  ]);
});

test('preparePrintView: a row counts as having data if ANY of co/pno/numeric fields is set', () => {
  // Single-field triggers per row.
  const cases = [
    { id: 'p2co',    val: 'Hong Leong' },   // company name alone
    { id: 'p4pno',   val: 'POL-12345'  },   // policy number alone
    { id: 'p6prem',  val: '500'        },   // premium alone
    { id: 'p9death', val: '100000'     },   // death alone
  ];
  for (const c of cases) {
    const doc = makeDoc({ [c.id]: c.val });
    makeSandbox(doc).preparePrintView();
    // The row index for each fixture:
    const i = parseInt(c.id.match(/p(\d+)/)[1], 10) - 1;
    assert.notEqual(doc._life.rows[i].style.display, 'none',
      `row ${i + 1} should be visible when only ${c.id} is set`);
  }
});

test('preparePrintView: zero-valued numeric fields do NOT count as data', () => {
  // n() returns 0 for empty input; > 0 check filters those out.
  const doc = makeDoc({
    p1death: '0', p1tpd: '0', p1prem: '0',
  });
  makeSandbox(doc).preparePrintView();
  // No row has data → fallback path → only row 1 visible (the
  // "empty table" rendering).
  assert.equal(doc._life.rows[0].style.display, '');
  for (let i = 1; i < 15; i++) {
    assert.equal(doc._life.rows[i].style.display, 'none');
  }
});

test('preparePrintView: medical table with no data injects "no coverage" notice', () => {
  const doc = makeDoc({});
  makeSandbox(doc).preparePrintView();
  const firstMedTd = doc._med.rows[0].cells[0];
  assert.ok(firstMedTd.innerHTML.includes('noMedCard'),
    'first medical row td should now contain the i18n key "noMedCard"');
  // The original HTML must be stashed for restorePrintView.
  assert.equal(firstMedTd.dataset.printOrig,
    '<span class="orig-co-name">AmMetLife</span>');
});

test('preparePrintView: medical table with data does NOT inject notice', () => {
  const doc = makeDoc({ p1rb: '200', p1ll: '1000000' });
  makeSandbox(doc).preparePrintView();
  const firstMedTd = doc._med.rows[0].cells[0];
  assert.equal(firstMedTd.innerHTML, '<span class="orig-co-name">AmMetLife</span>',
    'first med row td should be untouched when medical data is present');
  assert.equal(firstMedTd.dataset.printOrig, undefined);
});

test('restorePrintView: makes lifeVisibleRows rows visible, hides the rest', () => {
  const doc = makeDoc({});
  const sb  = makeSandbox(doc);
  // Pretend the user added 4 life rows; preparePrintView hid them all
  // because the table was empty.
  sb.preparePrintView();
  sb.setLife(4);

  sb.restorePrintView();
  const visible = doc._life.rows.map((r) => r.style.display !== 'none');
  assert.deepEqual(visible.slice(0, 4), [true, true, true, true]);
  assert.deepEqual(visible.slice(4),    Array(11).fill(false));
});

test('restorePrintView: restores the medical first-row td from dataset.printOrig', () => {
  const doc = makeDoc({}); // empty medical table → notice gets injected
  const sb  = makeSandbox(doc);
  sb.preparePrintView();

  // Sanity: prep injected the notice.
  const firstMedTd = doc._med.rows[0].cells[0];
  assert.ok(firstMedTd.innerHTML.includes('noMedCard'));
  assert.equal(firstMedTd.dataset.printOrig,
    '<span class="orig-co-name">AmMetLife</span>');

  sb.restorePrintView();
  // td restored to its original innerHTML and the marker deleted.
  assert.equal(firstMedTd.innerHTML, '<span class="orig-co-name">AmMetLife</span>');
  assert.equal(firstMedTd.dataset.printOrig, undefined);
});

test('prepare → restore is a no-op for the visible row count when data is present', () => {
  // Populate life rows 1–3 and med row 1.
  const doc = makeDoc({
    p1co: 'AmMetLife', p1death: '350000',
    p2co: 'AIA',       p2death: '200000',
    p3co: 'Allianz',   p3prem:  '5000',
    p1rb: '200', p1ll: '1000000',
  });
  const sb = makeSandbox(doc);
  sb.setLife(3);
  sb.setMed(1);

  sb.preparePrintView();
  // After prep: rows 1–3 visible, 4–15 hidden.
  for (let i = 0; i < 3; i++)  assert.notEqual(doc._life.rows[i].style.display, 'none');
  for (let i = 3; i < 15; i++) assert.equal(doc._life.rows[i].style.display,    'none');

  sb.restorePrintView();
  // After restore: rows 1–lifeVisibleRows visible, rest hidden — the
  // same shape, because lifeVisibleRows matches the populated count.
  for (let i = 0; i < 3; i++)  assert.notEqual(doc._life.rows[i].style.display, 'none');
  for (let i = 3; i < 15; i++) assert.equal(doc._life.rows[i].style.display,    'none');
});
