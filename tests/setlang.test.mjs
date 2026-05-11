// setLang(lang) DOM-traversal test.
//
// Targets the v4.9 / v4.12 sigNote class of bugs where setLang's
// traversal logic skipped certain element shapes (elements with
// children that aren't TH/TD) leading to labels that never updated
// when the user switched language. Static i18n.test.mjs only catches
// missing dictionary keys; this suite catches the traversal bugs.
//
// Run with:   node --test tests/setlang.test.mjs

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
  extract(/const I18N\s*=\s*\{[\s\S]*?\n\};/m,                              'I18N'),
  extract(/function L\(key\)[^\n]*$/m,                                      'L'),
  extract(/function setLang\(lang\)\s*\{[\s\S]*?\n\}/m,                     'setLang'),
].join('\n');

// recalc, renderRecords are called but their effects aren't observed
// here. Stub them.
const STUBS = `
  let currentLang = 'zh';
  function recalc(){}
  function renderRecords(){}
`;

// ── DOM model ────────────────────────────────────────────────────────
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

// One element factory covering every shape setLang touches.
function makeElement(opts = {}) {
  return {
    id:           opts.id ?? '',
    tagName:      (opts.tagName ?? 'SPAN').toUpperCase(),
    textContent:  opts.textContent ?? '',
    innerHTML:    opts.innerHTML   ?? '',
    placeholder:  opts.placeholder ?? '',
    value:        opts.value       ?? '',
    children:     opts.children    ?? [],
    childNodes:   opts.childNodes  ?? [],
    options:      opts.options     ?? [],
    classList:    makeClassList(),
    dataset:      opts.dataset     ?? {},
    _attrs:       new Map(Object.entries(opts.attrs ?? {})),
    getAttribute(name) { return this._attrs.get(name) ?? null; },
    setAttribute(name, value) { this._attrs.set(name, value); },
  };
}

function makeDoc() {
  const byId       = new Map();
  const byI18n     = [];         // every element with data-i18n
  const langBtns   = [];
  const fabItems   = [];
  let   fabHdr     = null;
  let   drHdr      = null;
  let   drSave     = null;
  let   profileSav = null;       // .profile-save-row .btn-save

  const doc = {
    _byId: byId,
    _byI18n: byI18n,
    _addI18n(key, opts = {}) {
      const el = makeElement({
        ...opts,
        attrs: { 'data-i18n': key, ...(opts.attrs || {}) },
      });
      byI18n.push(el);
      if (el.id) byId.set(el.id, el);
      return el;
    },
    _addId(id, opts = {}) {
      const el = makeElement({ id, ...opts });
      byId.set(id, el);
      return el;
    },
    _addLangBtn(lang) {
      const el = makeElement({
        tagName: 'BUTTON', dataset: { lang },
        attrs: { class: 'lang-btn' },
      });
      langBtns.push(el);
      return el;
    },
    _setFabHdr(el)    { fabHdr     = el; },
    _addFabItem(el)   { fabItems.push(el); },
    _setDrHdr(el)     { drHdr      = el; },
    _setDrSave(el)    { drSave     = el; },
    _setProfSave(el)  { profileSav = el; },
    getElementById(id) {
      let el = byId.get(id);
      if (!el) { el = makeElement({ id }); byId.set(id, el); }
      return el;
    },
    querySelectorAll(sel) {
      if (sel === '[data-i18n]')     return byI18n;
      if (sel === '.lang-btn')       return langBtns;
      if (sel === '.fab-panel .fab-item') return fabItems;
      if (sel === 'select[id^="p"][id$="co"], select[id^="pm"][id$="co"]')
        return [];   // no selects in this lightweight model
      return [];
    },
    querySelector(sel) {
      if (sel === '.fab-panel-hdr span')                     return fabHdr;
      if (sel === '.drawer-hdr h3')                          return drHdr;
      if (sel === '.drawer-foot .btn-save')                  return drSave;
      if (sel === '.profile-save-row .btn-save')             return profileSav;
      if (sel === '[data-i18n="sigNote"]') {
        return byI18n.find((e) => e.getAttribute('data-i18n') === 'sigNote') ?? null;
      }
      return null;
    },
  };
  return doc;
}

function makeSandbox(doc) {
  const sb = {
    document: doc, Math, Number, Array, Object,
    parseInt, parseFloat, isNaN, isFinite,
    console: { log() {}, warn() {} },
  };
  vm.createContext(sb);
  vm.runInContext(STUBS + '\n' + code +
    '\n;Object.assign(this, {setLang, L, getCurLang:()=>currentLang});', sb);
  return sb;
}

// ════════════════════════════════════════════════════════════════════
//  Tests
// ════════════════════════════════════════════════════════════════════

test('setLang: updates currentLang and triggers data-i18n text-only elements', () => {
  const doc = makeDoc();
  // Text-only label: no children → textContent gets set.
  const label = doc._addI18n('lClientName', { tagName: 'LABEL' });

  const sb = makeSandbox(doc);
  sb.setLang('en');
  assert.equal(sb.getCurLang(), 'en');
  assert.equal(label.textContent, 'Client Name');

  sb.setLang('bm');
  assert.equal(sb.getCurLang(), 'bm');
  // The bm dictionary may use a different string; just confirm it changed.
  assert.notEqual(label.textContent, 'Client Name');
});

test('setLang: TH/TD with child elements use innerHTML (subtext preservation)', () => {
  const doc = makeDoc();
  const th = doc._addI18n('thCoverage', {
    tagName: 'TH',
    children: [{ tagName: 'SPAN' }], // has a child, so textContent path is skipped
  });
  makeSandbox(doc).setLang('en');
  // innerHTML should be the english translation (not "" left over).
  assert.ok(th.innerHTML.length > 0,
    'TH with children should have innerHTML set to the translation');
});

test('setLang: element with children that is NOT TH/TD is intentionally skipped', () => {
  const doc = makeDoc();
  // A LABEL with a child icon span — historic v4.9 bug: would not
  // update. setLang() guards by `el.children.length === 0` for
  // textContent and only allows innerHTML for TH/TD. Pin this quirk.
  const label = doc._addI18n('lClientName', {
    tagName: 'LABEL',
    children: [{ tagName: 'SPAN' }],
    textContent: '原始',
    innerHTML:   '<span>icon</span>原始',
  });
  makeSandbox(doc).setLang('en');
  // textContent must be unchanged (children.length > 0 → skipped),
  // and the element is not TH/TD so innerHTML is also skipped.
  assert.equal(label.textContent, '原始');
  assert.equal(label.innerHTML,   '<span>icon</span>原始');
});

test('setLang: sigNote (has children, has data-i18n) gets innerHTML via step 10', () => {
  const doc = makeDoc();
  // Replicates the v4.12 fix: sigNote has child elements (<strong>),
  // so the generic loop skips it, but step 10 explicitly calls
  // querySelector('[data-i18n="sigNote"]') and sets innerHTML.
  const sig = doc._addI18n('sigNote', {
    tagName: 'P',
    children: [{ tagName: 'STRONG' }],
    innerHTML: '舊文',
  });
  makeSandbox(doc).setLang('en');
  assert.notEqual(sig.innerHTML, '舊文',
    'sigNote should be updated by the explicit step-10 fallback');
});

test('setLang: marks the active .lang-btn and de-activates the others', () => {
  const doc = makeDoc();
  const zh = doc._addLangBtn('zh');
  const en = doc._addLangBtn('en');
  const bm = doc._addLangBtn('bm');
  // Seed: zh active
  zh.classList.add('active');

  makeSandbox(doc).setLang('en');
  assert.ok(!zh.classList.contains('active'), 'zh should lose active class');
  assert.ok( en.classList.contains('active'), 'en should gain active class');
  assert.ok(!bm.classList.contains('active'));
});

test('setLang: updates policy-number placeholders for all 15 rows', () => {
  const doc = makeDoc();
  for (let i = 1; i <= 15; i++) doc._addId(`p${i}pno`);
  makeSandbox(doc).setLang('en');
  for (let i = 1; i <= 15; i++) {
    const el = doc.getElementById(`p${i}pno`);
    assert.ok(el.placeholder.length > 0,
      `p${i}pno placeholder should be populated`);
  }
});

test('setLang: updates ip${i}Desc placeholders using per-row i18n keys', () => {
  const doc = makeDoc();
  for (let i = 1; i <= 5; i++) doc._addId(`ip${i}Desc`);
  makeSandbox(doc).setLang('en');
  for (let i = 1; i <= 5; i++) {
    const el = doc.getElementById(`ip${i}Desc`);
    assert.ok(el.placeholder.length > 0,
      `ip${i}Desc should have a placeholder set via L('ip${i}Plh')`);
  }
});

test('setLang: home/office desc only updates if value is at a known default', () => {
  const doc = makeDoc();
  // Custom user value → leave alone.
  const hd = doc._addId('homeDesc', { value: 'My Custom House' });
  // Known default → update.
  const od = doc._addId('officeDesc', { value: '自用辦公室' });
  makeSandbox(doc).setLang('en');
  assert.equal(hd.value, 'My Custom House', 'user-edited homeDesc must be preserved');
  assert.notEqual(od.value, '自用辦公室',     'default officeDesc should swap to en');
});

test('setLang: FAB menu items are populated when present', () => {
  const doc = makeDoc();
  // Create 6 fab items per the source loop.
  for (let i = 0; i < 6; i++) doc._addFabItem(makeElement({}));
  doc._setFabHdr(makeElement({}));
  makeSandbox(doc).setLang('en');
  const items = doc.querySelectorAll('.fab-panel .fab-item');
  assert.ok(items[1].textContent.length > 0, 'fabNew label should be set');
  assert.ok(items[2].textContent.length > 0, 'fabDemo label should be set');
  assert.ok(items[3].textContent.length > 0, 'fabProfile label should be set');
  assert.ok(items[5].textContent.length > 0, 'fabPrint label should be set');
});
