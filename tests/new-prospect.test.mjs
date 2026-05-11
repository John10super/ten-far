// newProspect test: pins the differences from clearAll.
//
// newProspect != clearAll. Key differences:
//   - confirm() prompt if clientName is non-empty
//   - homeMRTA defaults to TRUE (clearAll → false)
//   - homeDesc/officeDesc get restored to L('homeDescDef')/L('officeDescDef')
//   - buildPolicyRows() is called (rebuild to 1 visible row)
//   - reportDate set to today
//   - showToast and scrollTo on success
//
// Run with:   node --test tests/new-prospect.test.mjs

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

const code = extract(/function newProspect\(\)\s*\{[\s\S]*?\n\}/m, 'newProspect');

const STUBS = `
  let ipVisibleRows = 5;
  function recalc(){}
  function buildPolicyRows(){ globalThis.__buildPolicyRows_calls = (globalThis.__buildPolicyRows_calls||0)+1; }
  function showToast(){ globalThis.__showToast_calls = (globalThis.__showToast_calls||0)+1; }
  function L(k){ return 'L:' + k; }
`;

function makeElement(id, init = {}) {
  return {
    id,
    value:   init.value   ?? '',
    checked: !!init.checked,
    type:    init.type    ?? 'text',
    tagName: (init.tagName ?? 'INPUT').toUpperCase(),
    style:   { display: init.display ?? '' },
  };
}

function makeDoc(initial = {}) {
  const elems = new Map();
  for (const [id, init] of Object.entries(initial)) elems.set(id, makeElement(id, init));
  return {
    _elems: elems,
    _add(id, init) { elems.set(id, makeElement(id, init)); return elems.get(id); },
    getElementById(id) {
      let el = elems.get(id);
      if (!el) { el = makeElement(id); elems.set(id, el); }
      return el;
    },
    // newProspect uses one big querySelectorAll selector for the input wipe.
    querySelectorAll(selector) {
      const all = [...elems.values()];
      if (selector.startsWith('select')) return [];
      // The actual selector is:
      // 'input[type=number], input[type=text]:not([id="homeDesc"]):not([id="officeDesc"]),
      //  input:not([type]):not([id="homeDesc"]):not([id="officeDesc"]),
      //  input[type=date], textarea'
      return all.filter((e) => {
        if (e.tagName === 'TEXTAREA') return true;
        if (e.tagName !== 'INPUT') return false;
        if (e.id === 'homeDesc' || e.id === 'officeDesc') return false;
        return ['text','number','date',''].includes(e.type || 'text');
      });
    },
  };
}

function makeSandbox(doc, opts = {}) {
  const sb = {
    document: doc,
    window: { scrollTo: () => { sb._scrolls = (sb._scrolls || 0) + 1; } },
    Date, JSON, Math, Object, parseInt, parseFloat, isNaN, isFinite,
    confirm: opts.confirm ?? (() => true),
    console: { log() {}, warn() {} },
  };
  vm.createContext(sb);
  vm.runInContext(STUBS + '\n' + code + '\n;this.newProspect = newProspect;', sb);
  // Reset shared spy counters per-sandbox so tests don't cross-contaminate.
  vm.runInContext('globalThis.__buildPolicyRows_calls = 0; globalThis.__showToast_calls = 0;', sb);
  return sb;
}

function seedTypicalForm(doc) {
  // Inputs that should be wiped:
  doc._add('clientName',  { value: 'Ahmad' });
  doc._add('icNum',       { value: '880101-13-5678' });
  doc._add('salaryMain',  { value: '8500' });
  doc._add('homeBalance', { value: '450000' });
  // Keep-list members:
  doc._add('plannerName',   { value: 'John Ten' });
  doc._add('plannerPhone',  { value: '016-8860255' });
  doc._add('plannerEmail',  { value: 'ten@example.com' });
  doc._add('inflationRate', { value: '3.69' });
  doc._add('interestRate',  { value: '2.5' });
  doc._add('ide',           { value: '20000' });
  doc._add('rrf',           { value: '5000' });
  // homeDesc/officeDesc excluded from the wipe selector — values
  // overwritten by the explicit assignments later.
  doc._add('homeDesc',   { value: 'My Custom Home' });
  doc._add('officeDesc', { value: 'My Custom Office' });
  // Checkbox state
  doc._add('homeMRTA',   { type: 'checkbox', checked: false });
  doc._add('officeMRTA', { type: 'checkbox', checked: true  });
  for (let i = 1; i <= 5; i++) doc._add(`ip${i}MRTA`, { type: 'checkbox', checked: true });
  // Row containers
  for (let i = 1; i <= 5; i++) doc._add(`invRow${i}`, { display: '' });
  // reportDate
  doc._add('reportDate', { value: '2020-01-01', type: 'date' });
}

// ════════════════════════════════════════════════════════════════════
//  Tests
// ════════════════════════════════════════════════════════════════════

test('newProspect: bails out when clientName is set and confirm() returns false', () => {
  const doc = makeDoc();
  seedTypicalForm(doc);
  const sb = makeSandbox(doc, { confirm: () => false });

  sb.newProspect();
  // Nothing should have changed.
  assert.equal(doc.getElementById('clientName').value, 'Ahmad');
  assert.equal(doc.getElementById('salaryMain').value, '8500');
});

test('newProspect: proceeds without confirm() when clientName is empty', () => {
  const doc = makeDoc();
  seedTypicalForm(doc);
  doc.getElementById('clientName').value = '';
  let confirmCalled = false;
  const sb = makeSandbox(doc, { confirm: () => { confirmCalled = true; return false; } });

  sb.newProspect();
  assert.equal(confirmCalled, false, 'confirm() must not be called when no clientName');
  // Wipe still happens: salaryMain should be empty.
  assert.equal(doc.getElementById('salaryMain').value, '');
});

test('newProspect: keep-list preserves assumption + planner fields', () => {
  const doc = makeDoc();
  seedTypicalForm(doc);
  const sb = makeSandbox(doc, { confirm: () => true });

  sb.newProspect();

  assert.equal(doc.getElementById('plannerName').value,   'John Ten');
  assert.equal(doc.getElementById('plannerPhone').value,  '016-8860255');
  assert.equal(doc.getElementById('plannerEmail').value,  'ten@example.com');
  assert.equal(doc.getElementById('inflationRate').value, '3.69');
  assert.equal(doc.getElementById('interestRate').value,  '2.5');
  assert.equal(doc.getElementById('ide').value,           '20000');
  assert.equal(doc.getElementById('rrf').value,           '5000');
});

test('newProspect: homeMRTA defaults to TRUE (opposite of clearAll)', () => {
  const doc = makeDoc();
  seedTypicalForm(doc);
  // Force homeMRTA=false to prove it gets set true (not just left alone).
  doc.getElementById('homeMRTA').checked = false;
  const sb = makeSandbox(doc, { confirm: () => true });

  sb.newProspect();

  assert.equal(doc.getElementById('homeMRTA').checked,   true,
    'newProspect MUST set homeMRTA=true (this is the key UX difference from clearAll)');
  assert.equal(doc.getElementById('officeMRTA').checked, false);
});

test('newProspect: clears every ip*MRTA checkbox', () => {
  const doc = makeDoc();
  seedTypicalForm(doc);
  // All ip*MRTA seeded as checked=true.
  const sb = makeSandbox(doc, { confirm: () => true });

  sb.newProspect();

  for (let i = 1; i <= 5; i++) {
    assert.equal(doc.getElementById(`ip${i}MRTA`).checked, false,
      `ip${i}MRTA should be cleared by newProspect`);
  }
});

test('newProspect: hides ip2..5 rows and resets ipVisibleRows to 1', () => {
  const doc = makeDoc();
  seedTypicalForm(doc);
  // All seeded with display=''
  const sb = makeSandbox(doc, { confirm: () => true });

  sb.newProspect();

  assert.equal(doc.getElementById('invRow1').style.display, '');
  for (let i = 2; i <= 5; i++) {
    assert.equal(doc.getElementById(`invRow${i}`).style.display, 'none',
      `invRow${i} should be hidden`);
  }
});

test('newProspect: restores homeDesc/officeDesc to the i18n defaults', () => {
  const doc = makeDoc();
  seedTypicalForm(doc);
  const sb = makeSandbox(doc, { confirm: () => true });

  sb.newProspect();

  // L() is stubbed to return 'L:key', so the assignment is observable.
  assert.equal(doc.getElementById('homeDesc').value,   'L:homeDescDef');
  assert.equal(doc.getElementById('officeDesc').value, 'L:officeDescDef');
});

test('newProspect: sets reportDate to today (ISO date)', () => {
  const doc = makeDoc();
  seedTypicalForm(doc);
  const sb = makeSandbox(doc, { confirm: () => true });

  sb.newProspect();

  const v = doc.getElementById('reportDate').value;
  assert.match(v, /^\d{4}-\d{2}-\d{2}$/, `reportDate "${v}" should be ISO date`);
  // Sanity: today's date.
  const today = new Date().toISOString().split('T')[0];
  assert.equal(v, today);
});

test('newProspect: triggers buildPolicyRows() and showToast() exactly once', () => {
  const doc = makeDoc();
  seedTypicalForm(doc);
  const sb = makeSandbox(doc, { confirm: () => true });

  sb.newProspect();

  const calls = vm.runInContext(
    '({ build: __buildPolicyRows_calls, toast: __showToast_calls })', sb);
  assert.equal(calls.build, 1);
  assert.equal(calls.toast, 1);
});
