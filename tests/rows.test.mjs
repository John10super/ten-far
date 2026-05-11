// Dynamic-row management tests for the Life / Medical / Investment-
// Property tables. Functions: addLifeRow, removeLifeRow, addMedRow,
// removeMedRow, addInvRow, removeInvRow, updateRowButtons.
//
// All three pairs share the same shape:
//   - add* respects a MAX cap (LIFE_MAX=15, MED_MAX=5, IP_MAX=5)
//   - remove* refuses to drop below 1 visible row
//   - remove* shifts data from rows below the deleted one UP, then
//     clears the now-empty last row (the "delete by collapsing" UX)
//   - updateRowButtons hides the Add button at cap and hides Delete
//     buttons when only 1 row remains
//
// Run with:   node --test tests/rows.test.mjs

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
  extract(/function updateRowButtons\(\)\s*\{[\s\S]*?\n\}/m, 'updateRowButtons'),
  extract(/function addInvRow\(\)\s*\{[\s\S]*?\n\}/m,        'addInvRow'),
  extract(/function removeInvRow\(idx\)\s*\{[\s\S]*?\n\}/m,  'removeInvRow'),
  extract(/function addLifeRow\(\)\s*\{[\s\S]*?\n\}/m,       'addLifeRow'),
  extract(/function removeLifeRow\(idx\)\s*\{[\s\S]*?\n\}/m, 'removeLifeRow'),
  extract(/function addMedRow\(\)\s*\{[\s\S]*?\n\}/m,        'addMedRow'),
  extract(/function removeMedRow\(idx\)\s*\{[\s\S]*?\n\}/m,  'removeMedRow'),
].join('\n');

const STUBS = `
  function recalc() {}
  const LIFE_MAX = 15;
  const MED_MAX  = 5;
  const IP_MAX   = 5;
  let lifeVisibleRows = 1;
  let medVisibleRows  = 1;
  let ipVisibleRows   = 1;
`;

// ── DOM stub: every id auto-creates an element ───────────────────────
function makeElement(id, init = {}) {
  return {
    id,
    value: String(init.value ?? ''),
    checked: !!init.checked,
    type: init.type ?? 'text',
    style: { display: init.display ?? '' },
  };
}

function makeDoc() {
  const elems = new Map();
  return {
    _elems: elems,
    seed(ids, init) { for (const id of ids) elems.set(id, makeElement(id, init)); },
    getElementById(id) {
      let el = elems.get(id);
      if (!el) { el = makeElement(id); elems.set(id, el); }
      return el;
    },
  };
}

// All policy-row ids the row functions touch. Pre-seed so reads find
// real elements with .type, otherwise removeInvRow's checkbox check
// might mis-classify the auto-created defaults.
function seedAllRowIds(doc) {
  // Containers (style.display only matters for these)
  for (let i = 1; i <= 15; i++) doc.seed([`lifeRow${i}`], { display: i === 1 ? '' : 'none' });
  for (let i = 1; i <= 5;  i++) doc.seed([`medRow${i}`],  { display: i === 1 ? '' : 'none' });
  for (let i = 1; i <= 5;  i++) doc.seed([`invRow${i}`],  { display: i === 1 ? '' : 'none' });
  // Life inputs
  const lifeFields = ['co','pno','death','tpd','pa','ci','eci','dis','prem'];
  for (let i = 1; i <= 15; i++) for (const f of lifeFields) doc.seed([`p${i}${f}`]);
  // Medical inputs
  const medFields = ['rb','ll','al','dh','ciw','tpdw'];
  for (let i = 1; i <= 5; i++) for (const f of medFields) doc.seed([`p${i}${f}`]);
  for (let i = 1; i <= 5; i++) doc.seed([`pm${i}co`]);
  // Investment-property inputs
  const ipFields = ['Desc','Balance','Monthly'];
  for (let i = 1; i <= 5; i++) for (const f of ipFields) doc.seed([`ip${i}${f}`]);
  for (let i = 1; i <= 5; i++) doc.seed([`ip${i}MRTA`], { type: 'checkbox' });
  // Buttons updateRowButtons touches
  doc.seed(['addLifeRowBtn','addMedRowBtn','addInvRowBtn']);
  for (let i = 1; i <= 15; i++) doc.seed([`lifeDelBtn${i}`]);
  for (let i = 1; i <= 5;  i++) doc.seed([`medDelBtn${i}`]);
  for (let i = 1; i <= 5;  i++) doc.seed([`invDelBtn${i}`]);
}

function makeSandbox(doc) {
  const sb = {
    document: doc, Math, Number, parseInt, parseFloat, isNaN, isFinite,
    console: { log() {}, warn() {} },
  };
  vm.createContext(sb);
  vm.runInContext(STUBS + '\n' + code +
    '\n;Object.assign(this, {' +
    'addLifeRow, removeLifeRow, addMedRow, removeMedRow, addInvRow, ' +
    'removeInvRow, updateRowButtons,' +
    'getLife:()=>lifeVisibleRows, setLife:(v)=>{lifeVisibleRows=v},' +
    'getMed:()=>medVisibleRows,   setMed:(v)=>{medVisibleRows=v},' +
    'getIp:()=>ipVisibleRows,     setIp:(v)=>{ipVisibleRows=v},' +
    '});', sb);
  return sb;
}

// ════════════════════════════════════════════════════════════════════
//  addLifeRow / removeLifeRow
// ════════════════════════════════════════════════════════════════════

test('addLifeRow: shows the next row and increments the counter', () => {
  const doc = makeDoc(); seedAllRowIds(doc);
  const sb  = makeSandbox(doc);
  assert.equal(sb.getLife(), 1);
  sb.addLifeRow();
  assert.equal(sb.getLife(), 2);
  assert.equal(doc.getElementById('lifeRow2').style.display, '');
});

test('addLifeRow: stops at LIFE_MAX (15) — extra calls are no-ops', () => {
  const doc = makeDoc(); seedAllRowIds(doc);
  const sb  = makeSandbox(doc);
  for (let i = 0; i < 20; i++) sb.addLifeRow();
  assert.equal(sb.getLife(), 15);
  // Extra row beyond the cap remains hidden.
  // (We can't directly observe LIFE_MAX+1 because it doesn't exist.)
});

test('removeLifeRow: refuses to drop below 1 visible', () => {
  const doc = makeDoc(); seedAllRowIds(doc);
  const sb  = makeSandbox(doc);
  sb.removeLifeRow(1);
  assert.equal(sb.getLife(), 1, 'removeLifeRow must not delete the last row');
});

test('removeLifeRow: shifts data from rows below the deleted one UP, clears the last', () => {
  const doc = makeDoc(); seedAllRowIds(doc);
  const sb  = makeSandbox(doc);
  // Populate 3 rows with distinct data, then make 3 visible.
  doc.getElementById('p1co').value = 'A';     doc.getElementById('p1death').value = '100';
  doc.getElementById('p2co').value = 'B';     doc.getElementById('p2death').value = '200';
  doc.getElementById('p3co').value = 'C';     doc.getElementById('p3death').value = '300';
  sb.setLife(3);

  // Delete row 2 → row 3's data should move to row 2; row 3 cleared.
  sb.removeLifeRow(2);

  assert.equal(sb.getLife(), 2);
  assert.equal(doc.getElementById('p1co').value,    'A');
  assert.equal(doc.getElementById('p1death').value, '100');
  assert.equal(doc.getElementById('p2co').value,    'C');  // shifted up
  assert.equal(doc.getElementById('p2death').value, '300');
  assert.equal(doc.getElementById('p3co').value,    '');   // cleared
  assert.equal(doc.getElementById('p3death').value, '');
  assert.equal(doc.getElementById('lifeRow3').style.display, 'none');
});

// ════════════════════════════════════════════════════════════════════
//  addMedRow / removeMedRow
// ════════════════════════════════════════════════════════════════════

test('addMedRow: increments and shows; caps at MED_MAX (5)', () => {
  const doc = makeDoc(); seedAllRowIds(doc);
  const sb  = makeSandbox(doc);
  for (let i = 0; i < 10; i++) sb.addMedRow();
  assert.equal(sb.getMed(), 5);
  for (let i = 2; i <= 5; i++) assert.equal(doc.getElementById('medRow' + i).style.display, '');
});

test('removeMedRow: shifts both medical fields AND pm*co (company name)', () => {
  const doc = makeDoc(); seedAllRowIds(doc);
  const sb  = makeSandbox(doc);
  // Populate 2 medical rows.
  doc.getElementById('p1rb').value = '150'; doc.getElementById('pm1co').value = 'AmMetLife';
  doc.getElementById('p2rb').value = '300'; doc.getElementById('pm2co').value = 'AIA';
  sb.setMed(2);

  sb.removeMedRow(1);

  assert.equal(sb.getMed(), 1);
  assert.equal(doc.getElementById('p1rb').value,  '300');     // shifted up
  assert.equal(doc.getElementById('pm1co').value, 'AIA');     // company shifted too
  assert.equal(doc.getElementById('p2rb').value,  '');        // cleared
  assert.equal(doc.getElementById('pm2co').value, '');
});

// ════════════════════════════════════════════════════════════════════
//  addInvRow / removeInvRow
// ════════════════════════════════════════════════════════════════════

test('addInvRow / removeInvRow: caps at IP_MAX (5), refuses to drop below 1', () => {
  const doc = makeDoc(); seedAllRowIds(doc);
  const sb  = makeSandbox(doc);
  for (let i = 0; i < 10; i++) sb.addInvRow();
  assert.equal(sb.getIp(), 5);
  for (let i = 0; i < 10; i++) sb.removeInvRow(1);
  assert.equal(sb.getIp(), 1, 'removeInvRow must not drop below 1');
});

test('removeInvRow: shifts MRTA checkbox state, not just text values', () => {
  const doc = makeDoc(); seedAllRowIds(doc);
  const sb  = makeSandbox(doc);
  // Two rows: row 1 unchecked, row 2 checked.
  doc.getElementById('ip1Desc').value    = 'Apartment KL';
  doc.getElementById('ip1Balance').value = '280,000';
  doc.getElementById('ip1MRTA').checked  = false;
  doc.getElementById('ip2Desc').value    = 'House Penang';
  doc.getElementById('ip2Balance').value = '500,000';
  doc.getElementById('ip2MRTA').checked  = true;
  sb.setIp(2);

  sb.removeInvRow(1); // delete row 1

  assert.equal(sb.getIp(), 1);
  // Row 2's data (including checkbox=true) should now be in row 1.
  assert.equal(doc.getElementById('ip1Desc').value,    'House Penang');
  assert.equal(doc.getElementById('ip1Balance').value, '500,000');
  assert.equal(doc.getElementById('ip1MRTA').checked,  true);
  // Row 2 cleared.
  assert.equal(doc.getElementById('ip2Desc').value,    '');
  assert.equal(doc.getElementById('ip2Balance').value, '');
  assert.equal(doc.getElementById('ip2MRTA').checked,  false);
});

// ════════════════════════════════════════════════════════════════════
//  updateRowButtons
// ════════════════════════════════════════════════════════════════════

test('updateRowButtons: hides Add button when at cap, shows when below', () => {
  const doc = makeDoc(); seedAllRowIds(doc);
  const sb  = makeSandbox(doc);

  // Below cap → Add visible (style.display = 'inline-flex')
  sb.setLife(1); sb.setMed(1); sb.setIp(1);
  sb.updateRowButtons();
  assert.equal(doc.getElementById('addLifeRowBtn').style.display, 'inline-flex');
  assert.equal(doc.getElementById('addMedRowBtn').style.display,  'inline-flex');
  assert.equal(doc.getElementById('addInvRowBtn').style.display,  'inline-flex');

  // At cap → Add hidden
  sb.setLife(15); sb.setMed(5); sb.setIp(5);
  sb.updateRowButtons();
  assert.equal(doc.getElementById('addLifeRowBtn').style.display, 'none');
  assert.equal(doc.getElementById('addMedRowBtn').style.display,  'none');
  assert.equal(doc.getElementById('addInvRowBtn').style.display,  'none');
});

test('updateRowButtons: hides Delete buttons when only 1 row visible', () => {
  const doc = makeDoc(); seedAllRowIds(doc);
  const sb  = makeSandbox(doc);

  sb.setLife(1); sb.setMed(1); sb.setIp(1);
  sb.updateRowButtons();
  assert.equal(doc.getElementById('lifeDelBtn1').style.display, 'none');
  assert.equal(doc.getElementById('medDelBtn1').style.display,  'none');
  assert.equal(doc.getElementById('invDelBtn1').style.display,  'none');

  sb.setLife(2); sb.setMed(2); sb.setIp(2);
  sb.updateRowButtons();
  // Delete buttons within visible range should be shown.
  assert.equal(doc.getElementById('lifeDelBtn1').style.display, '');
  assert.equal(doc.getElementById('lifeDelBtn2').style.display, '');
});
