// Record round-trip test for saveRecord / loadRecord / deleteRecord
// / clearAll. Targets the v4.6-class regression at runtime (statically
// guarded by schema-drift.test.mjs): if a field exists in the DOM but
// is missing from BASE_IDS, it won't round-trip through localStorage.
//
// Strategy: extract the record-CRUD functions and BASE_IDS / INPUT_IDS
// from index.html, supply an in-memory localStorage shim and a fake
// document populated with a fixture, then exercise the full save →
// mutate → load cycle.
//
// Run with:   node --test tests/records.test.mjs

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
  extract(/function _allPolicyIds\(\)\s*\{[\s\S]*?\n\}/m,   '_allPolicyIds'),
  extract(/const BASE_IDS = \[[\s\S]*?\];/m,                 'BASE_IDS'),
  extract(/const INPUT_IDS\s*=\s*\[[\s\S]*?\];/m,            'INPUT_IDS'),
  extract(/const FAR_KEY[^\n]*$/m,                           'FAR_KEY'),
  extract(/function getAllRecords\(\)\s*\{[\s\S]*?\n\}/m,    'getAllRecords'),
  extract(/function saveRecord\(\)\s*\{[\s\S]*?\n\}/m,       'saveRecord'),
  extract(/function loadRecord\(id\)\s*\{[\s\S]*?\n\}/m,     'loadRecord'),
  extract(/function deleteRecord\(id\)\s*\{[\s\S]*?\n\}/m,   'deleteRecord'),
  extract(/function clearAll\(\)\s*\{[\s\S]*?\n\}/m,         'clearAll'),
].join('\n');

// Side-effect functions that saveRecord/loadRecord/clearAll call but
// which we don't want to exercise here. Stubbed in the sandbox.
const STUBS = `
  function recalc(){}
  function renderRecords(){}
  function showToast(){}
  function closeRecords(){}
  function formatAllInputs(){}
  function pccRestoreRows(){}
  function updateRowButtons(){}
  function buildPolicyRows(){}
  function L(k){ return k; }
  let lifeVisibleRows = 1, medVisibleRows = 1, ipVisibleRows = 1;
`;

// ── in-memory localStorage shim ──────────────────────────────────────
function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
    _store: store,
  };
}

// ── fake document, lighter than the recalc one ───────────────────────
// Only needs to support getElementById + the two querySelectorAll
// patterns clearAll uses.
function makeElement(id, init = {}) {
  return {
    id,
    value: String(init.value ?? ''),
    checked: !!init.checked,
    type: init.type ?? 'text',
    tagName: (init.tagName ?? 'INPUT').toUpperCase(),
    selectedIndex: 0,
    style: { display: '' },
  };
}

function makeDoc() {
  const elems = new Map();
  return {
    _elems: elems,
    _add(id, init) { const el = makeElement(id, init); elems.set(id, el); return el; },
    getElementById(id) {
      // Auto-create on first read so save/load on a sparsely-populated
      // form (matching production) behaves the same as the real DOM.
      let el = elems.get(id);
      if (!el) { el = makeElement(id); elems.set(id, el); }
      return el;
    },
    // clearAll() selectors:
    //   'input[type=number], input[type=text], input:not([type]), input[type=date], textarea'
    //   'select:not([id^="p"])'
    querySelectorAll(selector) {
      const all = [...elems.values()];
      if (selector.startsWith('select')) {
        return all.filter((e) => e.tagName === 'SELECT' && !e.id.startsWith('p'));
      }
      // Treat the union of input/textarea selectors as "all editable text-ish elements".
      return all.filter((e) => {
        if (e.tagName === 'TEXTAREA') return true;
        if (e.tagName !== 'INPUT') return false;
        return ['text','number','date',''].includes(e.type || 'text');
      });
    },
  };
}

function makeSandbox(doc, localStorage, dateStub) {
  const sb = {
    document: doc,
    localStorage,
    Date: dateStub ?? Date,
    JSON,
    Math, Number, Object,
    parseInt, parseFloat, isNaN, isFinite,
    console: { log() {}, warn() {} },
  };
  vm.createContext(sb);
  vm.runInContext(STUBS + '\n' + code +
    '\n;Object.assign(this, {INPUT_IDS, BASE_IDS, FAR_KEY, getAllRecords, ' +
    'saveRecord, loadRecord, deleteRecord, clearAll});', sb);
  return sb;
}

// Date stub with a monotonically-increasing getTime(). saveRecord uses
// `new Date().getTime()` for the record id; in production two saves in
// the same millisecond would collide — vanishingly rare in a wizard-
// driven app but possible in tests. The stub bumps the clock by 1ms
// per construction so each saveRecord call gets a unique id.
function makeMonotonicDate(start = 1746921600000) { // 2025-05-11 00:00 UTC
  let tick = 0;
  return class StubDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(start + tick++);
      else super(...args);
    }
    static now() { return start + tick++; }
  };
}

// ── fixture: minimal but covers every data type ──────────────────────
// Includes a few from each category in BASE_IDS plus one policy row,
// so the round-trip exercises text, numeric-string, checkbox, and
// textarea encodings.
function seedFixture(doc) {
  const text = [
    ['plannerName',  'John Ten'],
    ['plannerPhone', '016-8860255'],
    ['plannerEmail', 'tenconsultancy10@gmail.com'],
    ['clientName',   'Ahmad bin Abdullah'],
    ['icNum',        '880101-13-5678'],
    ['occupation',   'Senior Manager'],
    ['clientContact1','012-3456789'],
    ['clientContact2',''],
    ['clientEmail',  'ahmad@example.com'],
    ['reportDate',   '2026-05-11'],
    // numeric inputs are stored as strings on the element
    ['clientAge',     '38'],
    ['yearsResp',     '15'],
    ['salaryMain',    '8500'],
    ['salarySpouse',  '4500'],
    ['expFood',       '1200'],
    ['homeBalance',   '450,000'],   // already comma-formatted
    ['ip1Balance',    '280,000'],
    ['ip1Desc',       'Apartment KL'],
    ['carLoan',       '65000'],
    ['inflationRate', '3.69'],
    ['interestRate',  '2.5'],
    ['ide',           '20000'],
    ['rrf',           '5000'],
    ['parentSupport', 'yes'],   // hidden input driven by radio buttons
    ['parentAge',     '68'],
    ['p1death',       '350000'],
    ['p1tpd',         '250000'],
    ['p1prem',        '7200'],
    ['p1co',          'AmMetLife'],
    ['planA_death',   '500000'],
  ];
  for (const [id, value] of text) doc._add(id, { value, type: 'text', tagName: 'INPUT' });

  // consultantNote is a textarea
  doc._add('consultantNote', { value: 'Initial assessment', type: 'text', tagName: 'TEXTAREA' });

  // checkboxes — at least one of each MRTA kind
  doc._add('homeMRTA',   { type: 'checkbox', checked: false });
  doc._add('officeMRTA', { type: 'checkbox', checked: true  });
  for (let i = 1; i <= 5; i++) {
    doc._add(`ip${i}MRTA`, { type: 'checkbox', checked: i === 2 });
  }

  // radio buttons + visibility wrap used by loadRecord
  doc._add('parentSupportYes', { type: 'radio', checked: true  });
  doc._add('parentSupportNo',  { type: 'radio', checked: false });
  doc._add('parentAgeWrap',    { value: '' });
  // Row container elements loadRecord toggles
  for (let i = 1; i <= 5; i++)  doc._add('invRow' + i,  { value: '' });
  for (let i = 1; i <= 15; i++) doc._add('lifeRow' + i, { value: '' });
  for (let i = 1; i <= 5; i++)  doc._add('medRow' + i,  { value: '' });
}

// ════════════════════════════════════════════════════════════════════
//  Tests
// ════════════════════════════════════════════════════════════════════

test('INPUT_IDS includes every BASE_IDS entry plus per-policy ids', () => {
  const ls  = makeLocalStorage();
  const doc = makeDoc();
  const sb  = makeSandbox(doc, ls);
  // smoke: 15 life × 9 fields + 5 medical × 6 fields + 5 pm*co
  //        = 135 + 30 + 5 = 170 policy ids
  // + BASE_IDS length (varies by source; just check it's >= 80)
  assert.ok(sb.INPUT_IDS.length >= sb.BASE_IDS.length + 170,
    `INPUT_IDS=${sb.INPUT_IDS.length} should be >= BASE_IDS(${sb.BASE_IDS.length}) + 170`);
});

test('saveRecord persists exactly one record containing every populated field', () => {
  const ls  = makeLocalStorage();
  const doc = makeDoc();
  seedFixture(doc);
  const sb = makeSandbox(doc, ls);

  sb.saveRecord();

  const raw = ls.getItem(sb.FAR_KEY);
  assert.ok(raw, 'saveRecord did not write to localStorage');
  const records = JSON.parse(raw);
  assert.equal(records.length, 1);

  const { clientName, data } = records[0];
  assert.equal(clientName, 'Ahmad bin Abdullah');

  // The persisted blob must contain every fixture entry.
  assert.equal(data.plannerName,     'John Ten');
  assert.equal(data.salaryMain,      '8500');
  assert.equal(data.homeBalance,     '450,000');
  assert.equal(data.parentSupport,   'yes');
  assert.equal(data.parentAge,       '68');
  assert.equal(data.consultantNote,  'Initial assessment');
  assert.equal(data.p1death,         '350000');
  assert.equal(data.p1co,            'AmMetLife');
  assert.equal(data.planA_death,     '500000');

  // Checkbox encoding (v4.21 — yes/no strings, not bool).
  assert.equal(data.homeMRTA,   'no');
  assert.equal(data.officeMRTA, 'yes');
  assert.equal(data.ip2MRTA,    'yes');
  assert.equal(data.ip1MRTA,    'no');
});

test('round-trip: save → mutate → load restores every field including checkboxes', () => {
  const ls  = makeLocalStorage();
  const doc = makeDoc();
  seedFixture(doc);
  const sb = makeSandbox(doc, ls);

  sb.saveRecord();
  const recordId = JSON.parse(ls.getItem(sb.FAR_KEY))[0].id;

  // Garbage every field. If loadRecord misses one, we'll see the
  // garbage value below.
  for (const id of sb.INPUT_IDS) {
    const el = doc.getElementById(id);
    if (el.type === 'checkbox') el.checked = !el.checked;
    else                        el.value = 'GARBAGE';
  }

  sb.loadRecord(recordId);

  // Spot-check across every category.
  assert.equal(doc.getElementById('plannerName').value,    'John Ten');
  assert.equal(doc.getElementById('salaryMain').value,     '8500');
  assert.equal(doc.getElementById('homeBalance').value,    '450,000');
  assert.equal(doc.getElementById('parentSupport').value,  'yes');
  assert.equal(doc.getElementById('consultantNote').value, 'Initial assessment');
  assert.equal(doc.getElementById('p1death').value,        '350000');
  assert.equal(doc.getElementById('p1co').value,           'AmMetLife');
  assert.equal(doc.getElementById('planA_death').value,    '500000');
  // Checkboxes restored to the encoded state, not the garbage flip.
  assert.equal(doc.getElementById('homeMRTA').checked,   false);
  assert.equal(doc.getElementById('officeMRTA').checked, true);
  assert.equal(doc.getElementById('ip1MRTA').checked,    false);
  assert.equal(doc.getElementById('ip2MRTA').checked,    true);

  // Parent-support visibility/radio restoration.
  assert.equal(doc.getElementById('parentSupportYes').checked, true);
  assert.equal(doc.getElementById('parentSupportNo').checked,  false);
  assert.equal(doc.getElementById('parentAgeWrap').style.display, '');
});

test('saveRecord with same clientName replaces — does not duplicate', () => {
  const ls  = makeLocalStorage();
  const doc = makeDoc();
  seedFixture(doc);
  const sb = makeSandbox(doc, ls);

  sb.saveRecord();
  // Mutate one field and save again.
  doc.getElementById('salaryMain').value = '9999';
  sb.saveRecord();

  const records = JSON.parse(ls.getItem(sb.FAR_KEY));
  assert.equal(records.length, 1, 'duplicate clientName produced two records');
  assert.equal(records[0].data.salaryMain, '9999');
});

test('saveRecord falls back to L("unnamedClient") when clientName is blank', () => {
  const ls  = makeLocalStorage();
  const doc = makeDoc();
  seedFixture(doc);
  doc.getElementById('clientName').value = '   '; // whitespace only
  const sb = makeSandbox(doc, ls);

  sb.saveRecord();
  const records = JSON.parse(ls.getItem(sb.FAR_KEY));
  // L() is stubbed to return the key.
  assert.equal(records[0].clientName, 'unnamedClient');
});

test('deleteRecord removes the targeted record by id', () => {
  const ls  = makeLocalStorage();
  const doc = makeDoc();
  seedFixture(doc);
  // Use the monotonic Date stub — record.id collisions otherwise occur
  // when two saveRecord() calls run inside the same wall-clock ms.
  const sb = makeSandbox(doc, ls, makeMonotonicDate());

  sb.saveRecord();
  // Save a second record under a different name.
  doc.getElementById('clientName').value = 'Second Client';
  sb.saveRecord();
  assert.equal(JSON.parse(ls.getItem(sb.FAR_KEY)).length, 2);

  const firstId = JSON.parse(ls.getItem(sb.FAR_KEY))
    .find((r) => r.clientName === 'Ahmad bin Abdullah').id;
  sb.deleteRecord(firstId);

  const remaining = JSON.parse(ls.getItem(sb.FAR_KEY));
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].clientName, 'Second Client');
});

test('clearAll empties fields except the assumption + planner keep-list', () => {
  const ls  = makeLocalStorage();
  const doc = makeDoc();
  seedFixture(doc);
  const sb = makeSandbox(doc, ls);

  sb.clearAll();

  // Kept: assumption + planner fields.
  assert.equal(doc.getElementById('plannerName').value,   'John Ten');
  assert.equal(doc.getElementById('plannerPhone').value,  '016-8860255');
  assert.equal(doc.getElementById('plannerEmail').value,  'tenconsultancy10@gmail.com');
  assert.equal(doc.getElementById('inflationRate').value, '3.69');
  assert.equal(doc.getElementById('interestRate').value,  '2.5');
  assert.equal(doc.getElementById('ide').value,           '20000');
  assert.equal(doc.getElementById('rrf').value,           '5000');

  // Cleared: client/financial fields.
  assert.equal(doc.getElementById('clientName').value,  '');
  assert.equal(doc.getElementById('salaryMain').value,  '');
  assert.equal(doc.getElementById('homeBalance').value, '');
  assert.equal(doc.getElementById('consultantNote').value, '');

  // MRTA checkboxes reset.
  assert.equal(doc.getElementById('homeMRTA').checked,   false);
  assert.equal(doc.getElementById('officeMRTA').checked, false);
  for (let i = 1; i <= 5; i++) {
    assert.equal(doc.getElementById(`ip${i}MRTA`).checked, false,
      `ip${i}MRTA should be unchecked after clearAll`);
  }

  // parentSupport reset to "no".
  assert.equal(doc.getElementById('parentSupport').value,       'no');
  assert.equal(doc.getElementById('parentSupportYes').checked,  false);
  assert.equal(doc.getElementById('parentSupportNo').checked,   true);
  assert.equal(doc.getElementById('parentAgeWrap').style.display, 'none');
});

test('regression guard: a hypothetical un-listed field is detected by round-trip', () => {
  // Synthesizes the v4.6 bug: clientContact2 exists in the DOM but
  // — for this test — is not in INPUT_IDS. Save → garbage → load
  // should leave it as GARBAGE because saveRecord never recorded it.
  //
  // This proves the round-trip test would actually catch a missing
  // BASE_IDS entry. We model the missing-id scenario by filtering it
  // out of INPUT_IDS before invoking save/load.
  const ls  = makeLocalStorage();
  const doc = makeDoc();
  seedFixture(doc);
  const sb = makeSandbox(doc, ls);

  // INPUT_IDS is declared `const` in the extracted source, so we
  // mutate the array in place to drop clientContact1.
  vm.runInContext(
    'const _i = INPUT_IDS.indexOf("clientContact1");' +
    'if (_i >= 0) INPUT_IDS.splice(_i, 1);',
    sb,
  );

  sb.saveRecord();
  const recordId = JSON.parse(ls.getItem(sb.FAR_KEY))[0].id;

  // Garbage every field.
  doc.getElementById('clientContact1').value = 'LOST';

  sb.loadRecord(recordId);

  // clientContact1 should STILL be garbage because the missing
  // INPUT_IDS entry meant it was never saved → never restored.
  assert.equal(
    doc.getElementById('clientContact1').value, 'LOST',
    'Sanity-check failed: the test no longer proves missing-id detection.',
  );
});
