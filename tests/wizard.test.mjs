// Wizard navigation tests for goToPage / nextPage / prevPage /
// toggleShowAll. The wizard is the 8-page step-by-step flow; this
// suite pins:
//   - clamping at the page-1 / page-8 boundaries
//   - parseInt fallback for non-numeric input
//   - active/completed class transitions on .far-page and .far-step
//   - progress bar width updates
//   - localStorage 'far_current_page' is written
//   - history.replaceState is called (and skipped when skipHash:true)
//   - farShowAll blocks navigation entirely
//   - toggleShowAll flips the flag and the body class
//
// Run with:   node --test tests/wizard.test.mjs

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
  extract(/const FAR_TOTAL_PAGES\s*=\s*\d+;/m,                                'FAR_TOTAL_PAGES'),
  extract(/let farCurrentPage\s*=\s*\d+;/m,                                   'farCurrentPage'),
  extract(/let farShowAll\s*=\s*(?:true|false);/m,                            'farShowAll'),
  extract(/function _farProgress\(n\)\s*\{[\s\S]*?\n\}/m,                     '_farProgress'),
  extract(/function goToPage\(n, opts\)\s*\{[\s\S]*?\n\}/m,                   'goToPage'),
  extract(/function nextPage\(\)[^\n]*$/m,                                    'nextPage'),
  extract(/function prevPage\(\)[^\n]*$/m,                                    'prevPage'),
  extract(/function toggleShowAll\(\)\s*\{[\s\S]*?\n\}/m,                     'toggleShowAll'),
].join('\n');

const STUBS = `function recalc() {}`;

// ── DOM model ────────────────────────────────────────────────────────
// goToPage iterates .far-page / .far-step elements via querySelectorAll
// and toggles classes based on dataset.page. We model FAR_TOTAL_PAGES
// pages and steps, each with its own classList.
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
    _list: () => [...set],
  };
}

function makeDoc(totalPages = 8) {
  const elems = new Map();
  const pages = Array.from({ length: totalPages }, (_, i) => ({
    dataset: { page: String(i + 1) },
    classList: makeClassList(),
  }));
  const steps = Array.from({ length: totalPages }, (_, i) => ({
    dataset: { page: String(i + 1) },
    classList: makeClassList(),
  }));
  // farProgressFill is the only id directly referenced by goToPage/_farProgress.
  elems.set('farProgressFill', { id: 'farProgressFill', style: { width: '' } });
  return {
    _elems: elems,
    _pages: pages,
    _steps: steps,
    _body:  { classList: makeClassList() },
    getElementById(id) {
      if (elems.has(id)) return elems.get(id);
      const el = { id, style: {}, classList: makeClassList() };
      elems.set(id, el);
      return el;
    },
    querySelectorAll(sel) {
      if (sel === '.far-page') return pages;
      if (sel === '.far-step') return steps;
      return [];
    },
    body: null, // assigned below
  };
}

function makeSandbox(doc, localStorage) {
  // history.replaceState recorder
  const history = {
    _calls: [],
    replaceState(_a, _b, url) { this._calls.push(url); },
  };
  // window.scrollTo recorder
  const scrolls = [];
  const win = { scrollTo: (o) => scrolls.push(o), _scrolls: scrolls };
  const sb = {
    document: doc,
    history,
    window: win,
    localStorage,
    Math, Number, parseInt, parseFloat, isNaN, isFinite,
    console: { log() {}, warn() {} },
  };
  doc.body = doc._body; // wire up the body classList
  vm.createContext(sb);
  vm.runInContext(STUBS + '\n' + code +
    '\n;Object.assign(this, {' +
    'goToPage, nextPage, prevPage, toggleShowAll, FAR_TOTAL_PAGES,' +
    'getCur:()=>farCurrentPage,    setCur:(v)=>{farCurrentPage=v},' +
    'getShow:()=>farShowAll,       setShow:(v)=>{farShowAll=v},' +
    '});', sb);
  sb._history = history;
  sb._scrolls = scrolls;
  return sb;
}

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    _store: store,
  };
}

// ════════════════════════════════════════════════════════════════════
//  Tests
// ════════════════════════════════════════════════════════════════════

test('goToPage: navigates to a valid page, sets active classes correctly', () => {
  const doc = makeDoc();
  const sb  = makeSandbox(doc, makeLocalStorage());
  sb.goToPage(3);
  assert.equal(sb.getCur(), 3);
  assert.ok( doc._pages[2].classList.contains('active'),  'page 3 should be active');
  assert.ok(!doc._pages[0].classList.contains('active'), 'page 1 should not be active');
  // Step 3 is active, steps 1–2 are completed, steps 4–8 are neither.
  assert.ok(doc._steps[2].classList.contains('active'));
  assert.ok(doc._steps[0].classList.contains('completed'));
  assert.ok(doc._steps[1].classList.contains('completed'));
  assert.ok(!doc._steps[3].classList.contains('completed'));
});

test('goToPage: clamps below 1 and above FAR_TOTAL_PAGES', () => {
  const doc = makeDoc();
  const sb  = makeSandbox(doc, makeLocalStorage());
  sb.goToPage(0);
  assert.equal(sb.getCur(), 1);
  sb.goToPage(-99);
  assert.equal(sb.getCur(), 1);
  sb.goToPage(999);
  assert.equal(sb.getCur(), sb.FAR_TOTAL_PAGES);
  sb.goToPage(sb.FAR_TOTAL_PAGES + 5);
  assert.equal(sb.getCur(), sb.FAR_TOTAL_PAGES);
});

test('goToPage: parseInt fallback — non-numeric input → page 1', () => {
  const doc = makeDoc();
  const sb  = makeSandbox(doc, makeLocalStorage());
  sb.goToPage('abc');
  assert.equal(sb.getCur(), 1);
  sb.goToPage(undefined);
  assert.equal(sb.getCur(), 1);
  sb.goToPage(NaN);
  assert.equal(sb.getCur(), 1);
});

test('goToPage: updates progress-fill width to n / FAR_TOTAL_PAGES', () => {
  const doc = makeDoc();
  const sb  = makeSandbox(doc, makeLocalStorage());
  sb.goToPage(4); // 4/8 = 50%
  assert.equal(doc.getElementById('farProgressFill').style.width, '50%');
  sb.goToPage(8); // 100%
  assert.equal(doc.getElementById('farProgressFill').style.width, '100%');
});

test('goToPage: writes current page to localStorage', () => {
  const doc = makeDoc();
  const ls  = makeLocalStorage();
  const sb  = makeSandbox(doc, ls);
  sb.goToPage(5);
  assert.equal(ls.getItem('far_current_page'), '5');
});

test('goToPage: writes the URL hash via history.replaceState by default', () => {
  const doc = makeDoc();
  const sb  = makeSandbox(doc, makeLocalStorage());
  sb.goToPage(6);
  assert.deepEqual(sb._history._calls, ['#page-6']);
});

test('goToPage: opts.skipHash suppresses history.replaceState', () => {
  const doc = makeDoc();
  const sb  = makeSandbox(doc, makeLocalStorage());
  sb.goToPage(2, { skipHash: true });
  assert.deepEqual(sb._history._calls, []);
});

test('goToPage: opts.skipScroll suppresses window.scrollTo', () => {
  const doc = makeDoc();
  const sb  = makeSandbox(doc, makeLocalStorage());
  sb.goToPage(2, { skipScroll: true });
  assert.deepEqual(sb._scrolls, []);
  sb.goToPage(3);
  assert.equal(sb._scrolls.length, 1, 'default path should scroll');
});

test('nextPage / prevPage: increment / decrement within bounds', () => {
  const doc = makeDoc();
  const sb  = makeSandbox(doc, makeLocalStorage());
  sb.goToPage(3);
  sb.nextPage(); assert.equal(sb.getCur(), 4);
  sb.prevPage(); assert.equal(sb.getCur(), 3);
});

test('nextPage at last page is a no-op', () => {
  const doc = makeDoc();
  const sb  = makeSandbox(doc, makeLocalStorage());
  sb.goToPage(sb.FAR_TOTAL_PAGES);
  sb.nextPage();
  assert.equal(sb.getCur(), sb.FAR_TOTAL_PAGES);
});

test('prevPage at first page is a no-op', () => {
  const doc = makeDoc();
  const sb  = makeSandbox(doc, makeLocalStorage());
  sb.goToPage(1);
  sb.prevPage();
  assert.equal(sb.getCur(), 1);
});

test('farShowAll=true: goToPage is short-circuited completely', () => {
  const doc = makeDoc();
  const sb  = makeSandbox(doc, makeLocalStorage());
  sb.setShow(true);
  sb.goToPage(5);
  // No navigation happened — current page still default (1) and no
  // history/localStorage writes.
  assert.equal(sb.getCur(), 1);
  assert.equal(sb._history._calls.length, 0);
});

test('toggleShowAll: flips the flag and toggles the body class', () => {
  const doc = makeDoc();
  const sb  = makeSandbox(doc, makeLocalStorage());
  // Provide the labels toggleShowAll touches.
  doc._elems.set('farShowAllLabel', { id:'farShowAllLabel', textContent:'' });
  doc._elems.set('farShowAllIcon',  { id:'farShowAllIcon',  textContent:'' });

  assert.equal(sb.getShow(), false);
  sb.toggleShowAll();
  assert.equal(sb.getShow(), true);
  assert.ok(doc.body.classList.contains('far-show-all'));

  sb.toggleShowAll();
  assert.equal(sb.getShow(), false);
  assert.ok(!doc.body.classList.contains('far-show-all'));
});
