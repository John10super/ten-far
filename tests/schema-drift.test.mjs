// Schema-drift check: asserts that every persistable <input>/<select>/
// <textarea> in index.html is referenced by INPUT_IDS in the save/load
// pipeline. Designed to catch the v4.6 class of bug, where new fields
// were added to the form but the author forgot to extend BASE_IDS, so
// values silently dropped on save.
//
// Strategy: parse the static HTML for input ids, parse the BASE_IDS
// array and the _allPolicyIds() shape from the source, and compare.
// An explicit allowlist documents the small number of intentionally
// non-persisted controls (radio drivers, etc).
//
// Run with:   node --test tests/schema-drift.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ── extract every static input/select/textarea id from the markup ────
const DOM_IDS = (() => {
  const ids = new Set();
  const re = /<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) ids.add(m[1]);
  return ids;
})();

// ── parse BASE_IDS literal from the source ──────────────────────────
const BASE_IDS = (() => {
  const m = src.match(/const BASE_IDS\s*=\s*\[([\s\S]*?)\];/);
  if (!m) throw new Error('Could not locate BASE_IDS in index.html');
  return new Set(m[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1)));
})();

// ── policy-id template patterns produced by _allPolicyIds() ─────────
// Mirrors the function body at index.html:2814. If the function shape
// changes, the test below will fail loudly with a clear diff.
const POLICY_FIELDS    = ['co','pno','death','tpd','pa','ci','eci','dis','prem'];
const MEDICAL_FIELDS   = ['rb','ll','al','dh','ciw','tpdw'];
const POLICY_TEMPLATES = [
  ...POLICY_FIELDS.map((f) => `p\${i}${f}`),
  'pm${i}co',
  ...MEDICAL_FIELDS.map((f) => `p\${i}${f}`),
];

// ── allowlist: IDs that are intentionally NOT persisted ──────────────
// Keep this list short and well-justified. Anything added here is a
// signal that the schema is doing something unusual and should be
// reviewed.
const NOT_PERSISTED = new Set([
  // Radio inputs that drive the hidden #parentSupport value, which IS
  // persisted. Restored from `parentSupport` on load, not stored
  // independently.
  'parentSupportYes',
  'parentSupportNo',
  // V2 Auth screen fields — intentionally NOT in client records.
  // Auth credentials live in `far_user_v1` localStorage key, separate
  // from `far_records_v2` (client data). This separation is what
  // allows "reset password without losing client records".
  'loginEmail',
  'loginPassword',
  'regName',
  'regEmail',
  'regPassword',
  'regConfirmPassword',
  'resetEmail',
  'resetPassword',
  'resetConfirmPassword',
]);

// ── helpers ──────────────────────────────────────────────────────────
const isTemplate = (id) => id.includes('${');

test('every static DOM input is either persisted or explicitly allowlisted', () => {
  const missing = [];
  for (const id of DOM_IDS) {
    if (isTemplate(id)) continue;          // policy-row templates handled below
    if (BASE_IDS.has(id)) continue;
    if (NOT_PERSISTED.has(id)) continue;
    missing.push(id);
  }
  assert.deepEqual(
    missing,
    [],
    'These input IDs exist in the DOM but are NOT in BASE_IDS and NOT in the ' +
    'NOT_PERSISTED allowlist. Either add them to BASE_IDS or document why ' +
    'they are excluded by adding them to the allowlist in this test.\n' +
    'Missing IDs: ' + JSON.stringify(missing),
  );
});

test('every BASE_IDS entry has a matching DOM input', () => {
  const orphans = [...BASE_IDS].filter((id) => !DOM_IDS.has(id));
  assert.deepEqual(
    orphans,
    [],
    'BASE_IDS references IDs that have no corresponding <input>/<select>/' +
    '<textarea> in the static markup. These entries are dead code.\n' +
    'Orphans: ' + JSON.stringify(orphans),
  );
});

test('policy-row templates in DOM match _allPolicyIds() field list', () => {
  const domTemplates = new Set([...DOM_IDS].filter(isTemplate));
  const expected     = new Set(POLICY_TEMPLATES);
  const inDomNotExpected = [...domTemplates].filter((id) => !expected.has(id));
  const expectedNotInDom = [...expected].filter((id) => !domTemplates.has(id));
  assert.deepEqual(
    { inDomNotExpected, expectedNotInDom },
    { inDomNotExpected: [], expectedNotInDom: [] },
    'Policy-row template IDs are out of sync with POLICY_FIELDS/MEDICAL_FIELDS.\n' +
    'If buildPolicyRows() changed, update _allPolicyIds() and the field arrays ' +
    'in this test together.',
  );
});

test('_allPolicyIds() in source produces the same shape this test models', () => {
  // Lightweight smoke check: confirm the source still uses the exact
  // field list we model above. If someone reorders or renames a field
  // we want to know.
  const fn = src.match(/function _allPolicyIds\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fn, 'Could not locate _allPolicyIds() in index.html');
  for (const f of POLICY_FIELDS) {
    assert.ok(
      new RegExp(`\\bp\\$\\{i\\}${f}\\b`).test(fn[0]),
      `_allPolicyIds() is missing the life-policy field "${f}"`,
    );
  }
  for (const f of MEDICAL_FIELDS) {
    assert.ok(
      new RegExp(`\\bp\\$\\{i\\}${f}\\b`).test(fn[0]),
      `_allPolicyIds() is missing the medical field "${f}"`,
    );
  }
  assert.ok(
    /\bpm\$\{i\}co\b/.test(fn[0]),
    '_allPolicyIds() is missing the medical company field "pm${i}co"',
  );
});
