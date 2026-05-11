// Profile drawer tests: saveProfile / loadProfile / autoSaveProfile.
//
// Protects the advisor-info persistence layer (planner name/phone/
// email/report-date) which auto-saves on every keystroke and reloads
// on page open. Smaller surface than records.test.mjs — only 4 keys,
// one localStorage entry, no checkboxes.
//
// Run with:   node --test tests/profile.test.mjs

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
  extract(/const PROFILE_KEY\s*=\s*['"][^'"]+['"];?/m,                  'PROFILE_KEY'),
  extract(/const PROFILE_IDS\s*=\s*\[[^\]]+\];?/m,                      'PROFILE_IDS'),
  extract(/function saveProfile\(\)\s*\{[\s\S]*?\n\}/m,                 'saveProfile'),
  extract(/function autoSaveProfile\(\)\s*\{[\s\S]*?\n\}/m,             'autoSaveProfile'),
  extract(/function loadProfile\(\)\s*\{[\s\S]*?\n\}/m,                 'loadProfile'),
].join('\n');

const STUBS = `function showToast(){}`;

function makeLocalStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    _store: store,
  };
}

function makeDoc(values = {}) {
  const elems = new Map();
  for (const [id, value] of Object.entries(values)) {
    elems.set(id, { id, value: String(value), classList: makeClassList() });
  }
  return {
    getElementById(id) {
      let el = elems.get(id);
      if (!el) { el = { id, value: '', classList: makeClassList() }; elems.set(id, el); }
      return el;
    },
    _elems: elems,
  };
}

function makeClassList() {
  const set = new Set();
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    contains: (c) => set.has(c),
    toggle: (c, force) => {
      const present = set.has(c);
      const want = force === undefined ? !present : !!force;
      if (want) set.add(c); else set.delete(c);
      return want;
    },
    _set: set,
  };
}

function makeSandbox(doc, localStorage, timers) {
  const sb = {
    document: doc, localStorage, JSON, Object,
    window: {},
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    console: { log() {}, warn() {} },
  };
  vm.createContext(sb);
  vm.runInContext(STUBS + '\n' + code +
    '\n;Object.assign(this, {PROFILE_KEY, PROFILE_IDS, saveProfile, ' +
    'autoSaveProfile, loadProfile});', sb);
  return sb;
}

// Controllable timers — autoSaveProfile sets a 700ms debounce we want
// to drive manually instead of waiting.
function makeTimers() {
  let pending = null;
  return {
    setTimeout(fn) { pending = fn; return 1; },
    clearTimeout() { pending = null; },
    flush() { if (pending) { const f = pending; pending = null; f(); } },
    hasPending() { return pending !== null; },
  };
}

// ════════════════════════════════════════════════════════════════════
//  Tests
// ════════════════════════════════════════════════════════════════════

test('saveProfile writes all PROFILE_IDS to localStorage', () => {
  const ls  = makeLocalStorage();
  const doc = makeDoc({
    plannerName:  'John Ten',
    plannerPhone: '016-8860255',
    plannerEmail: 'tenconsultancy10@gmail.com',
    reportDate:   '2026-05-11',
  });
  const sb = makeSandbox(doc, ls, makeTimers());

  sb.saveProfile();

  const raw = ls.getItem(sb.PROFILE_KEY);
  assert.ok(raw, 'saveProfile did not write to localStorage');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.plannerName,  'John Ten');
  assert.equal(parsed.plannerPhone, '016-8860255');
  assert.equal(parsed.plannerEmail, 'tenconsultancy10@gmail.com');
  assert.equal(parsed.reportDate,   '2026-05-11');
});

test('loadProfile populates PROFILE_IDS from a previous save', () => {
  const ls  = makeLocalStorage({
    far_advisor_profile: JSON.stringify({
      plannerName:  'Jane',
      plannerPhone: '019-1234567',
      plannerEmail: 'jane@example.com',
      reportDate:   '2025-12-31',
    }),
  });
  const doc = makeDoc();
  const sb  = makeSandbox(doc, ls, makeTimers());

  sb.loadProfile();

  assert.equal(doc.getElementById('plannerName').value,  'Jane');
  assert.equal(doc.getElementById('plannerPhone').value, '019-1234567');
  assert.equal(doc.getElementById('plannerEmail').value, 'jane@example.com');
  assert.equal(doc.getElementById('reportDate').value,   '2025-12-31');
});

test('loadProfile is a no-op when localStorage is empty', () => {
  const ls  = makeLocalStorage();
  const doc = makeDoc({ plannerName: 'pre-existing' });
  const sb  = makeSandbox(doc, ls, makeTimers());

  sb.loadProfile();
  // Pre-existing value untouched.
  assert.equal(doc.getElementById('plannerName').value, 'pre-existing');
});

test('loadProfile recovers from corrupted JSON without throwing', () => {
  const ls  = makeLocalStorage({ far_advisor_profile: 'not-json-{' });
  const doc = makeDoc({ plannerName: 'survivor' });
  const sb  = makeSandbox(doc, ls, makeTimers());
  // Must not throw — production wraps the whole body in try/catch{}.
  sb.loadProfile();
  assert.equal(doc.getElementById('plannerName').value, 'survivor');
});

test('loadProfile skips keys that are not in the stored blob', () => {
  // Save only plannerName; loadProfile must leave the other fields
  // alone, not overwrite them with undefined.
  const ls  = makeLocalStorage({
    far_advisor_profile: JSON.stringify({ plannerName: 'partial' }),
  });
  const doc = makeDoc({
    plannerName:  'old',
    plannerPhone: '999',     // pre-existing, must survive
    plannerEmail: 'a@b',
  });
  const sb = makeSandbox(doc, ls, makeTimers());

  sb.loadProfile();
  assert.equal(doc.getElementById('plannerName').value,  'partial');
  assert.equal(doc.getElementById('plannerPhone').value, '999');
  assert.equal(doc.getElementById('plannerEmail').value, 'a@b');
});

test('autoSaveProfile debounces — multiple calls share one setTimeout', () => {
  const ls     = makeLocalStorage();
  const doc    = makeDoc({ plannerName: 'Debounce' });
  const timers = makeTimers();
  const sb     = makeSandbox(doc, ls, timers);

  sb.autoSaveProfile();
  sb.autoSaveProfile();
  sb.autoSaveProfile();
  // No save yet — debounce timer hasn't fired.
  assert.equal(ls.getItem(sb.PROFILE_KEY), null);
  assert.ok(timers.hasPending());

  timers.flush();
  // Now exactly one save has happened.
  const raw = ls.getItem(sb.PROFILE_KEY);
  assert.ok(raw);
  assert.equal(JSON.parse(raw).plannerName, 'Debounce');
});

test('save → load round-trip preserves every PROFILE_IDS field', () => {
  const ls  = makeLocalStorage();
  const fixture = {
    plannerName:  'Round Trip',
    plannerPhone: '+60 12-345-6789',
    plannerEmail: 'rt@example.com',
    reportDate:   '2026-05-11',
  };
  const doc = makeDoc(fixture);
  const sb  = makeSandbox(doc, ls, makeTimers());

  sb.saveProfile();
  // Wipe the form, then load.
  for (const id of sb.PROFILE_IDS) doc.getElementById(id).value = 'GARBAGE';
  sb.loadProfile();

  for (const id of sb.PROFILE_IDS) {
    assert.equal(doc.getElementById(id).value, fixture[id], `${id} round-trip`);
  }
});
