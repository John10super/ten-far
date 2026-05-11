// i18n key-coverage test.
//
// Protects the v4.9 / v4.12 regression class: a label gets referenced
// from JS or markup but the corresponding key was never added (or got
// removed) from one of the three language dictionaries, so the UI
// shows the raw key string ("apriPending") instead of localised text.
//
// Strategy: eval the I18N literal in a sandbox to get zh/en/bm as
// plain objects, then collect every key referenced from
//   - L('static-string')                  — JS calls
//   - L(`ip${i}Plh`)                      — templated, expand to ip1..ip5
//   - L(curVal) where curVal ∈ {apriPending,apriDone,apriOther} — pinned
//   - data-i18n="key"                     — markup attributes
// and assert each resolves in all three dictionaries.
//
// Run with:   node --test tests/i18n.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ── extract & evaluate the I18N literal ──────────────────────────────
const I18N = (() => {
  const m = src.match(/const I18N\s*=\s*\{[\s\S]*?\n\};/m);
  if (!m) throw new Error('Could not locate I18N literal in index.html');
  const sb = {};
  vm.createContext(sb);
  vm.runInContext(m[0] + '\n;this.I18N = I18N;', sb);
  return sb.I18N;
})();

// ── collect every static L('key') / L("key") reference ──────────────
const STATIC_L_KEYS = (() => {
  const keys = new Set();
  // The L() function itself (`return I18N[currentLang][key]`) contains
  // `L(key)` only in a comment-like context — skip the implementation
  // block to avoid the recursive false positive.
  for (const m of src.matchAll(/\bL\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\)/g)) {
    keys.add(m[1]);
  }
  return keys;
})();

// ── enumerate the one known templated L() call: L(`ip${i}Plh`) ──────
// The five investment-property rows (i=1..5) each render this label.
const TEMPLATED_L_KEYS = new Set(['ip1Plh','ip2Plh','ip3Plh','ip4Plh','ip5Plh']);

// ── dynamic L(curVal) values, pinned from the action-plan select ────
// curVal is one of three apri* strings, all of which also appear as
// static references elsewhere — listed here to make the dependency
// explicit and survive a future refactor that removes the static
// fallbacks.
const DYNAMIC_L_KEYS = new Set(['apriPending', 'apriDone', 'apriOther']);

// ── collect every data-i18n="key" markup reference ──────────────────
const MARKUP_KEYS = (() => {
  const keys = new Set();
  for (const m of src.matchAll(/data-i18n="([A-Za-z_][A-Za-z0-9_]*)"/g)) {
    keys.add(m[1]);
  }
  return keys;
})();

const ALL_REFERENCED = new Set([
  ...STATIC_L_KEYS, ...TEMPLATED_L_KEYS, ...DYNAMIC_L_KEYS, ...MARKUP_KEYS,
]);

// ── sanity: the I18N object actually parsed into three dictionaries ─
test('I18N literal parses into zh, en, bm dictionaries', () => {
  assert.equal(typeof I18N, 'object');
  for (const lang of ['zh', 'en', 'bm']) {
    assert.equal(typeof I18N[lang], 'object', `I18N.${lang} is missing`);
    assert.ok(Object.keys(I18N[lang]).length > 0, `I18N.${lang} is empty`);
  }
});

test('reference collection found a non-trivial number of keys', () => {
  // Cheap smoke check: if a future refactor breaks our regex (e.g.
  // someone switches to L(\`foo\`) for static keys), this catches it.
  assert.ok(STATIC_L_KEYS.size  >= 100, `only ${STATIC_L_KEYS.size} static L() keys found`);
  assert.ok(MARKUP_KEYS.size    >= 100, `only ${MARKUP_KEYS.size} data-i18n keys found`);
});

// ── core assertions: every referenced key resolves in every language ─
for (const lang of ['zh', 'en', 'bm']) {
  test(`every referenced key has an entry in I18N.${lang}`, () => {
    const dict    = I18N[lang];
    const missing = [...ALL_REFERENCED].filter((k) => !(k in dict)).sort();
    assert.deepEqual(
      missing,
      [],
      `I18N.${lang} is missing translations for ${missing.length} referenced ` +
      `key(s). Add them to the ${lang} dictionary (or remove the references).\n` +
      `Missing: ${JSON.stringify(missing)}`,
    );
  });
}

// ── parity check: zh / en / bm have the same key set ─────────────────
test('zh, en, bm dictionaries have identical key sets', () => {
  const zh = new Set(Object.keys(I18N.zh));
  const en = new Set(Object.keys(I18N.en));
  const bm = new Set(Object.keys(I18N.bm));
  const diff = (a, b) => [...a].filter((k) => !b.has(k)).sort();
  const report = {
    in_zh_not_en: diff(zh, en),
    in_zh_not_bm: diff(zh, bm),
    in_en_not_zh: diff(en, zh),
    in_en_not_bm: diff(en, bm),
    in_bm_not_zh: diff(bm, zh),
    in_bm_not_en: diff(bm, en),
  };
  const total = Object.values(report).reduce((s, a) => s + a.length, 0);
  assert.equal(
    total, 0,
    'Language dictionaries have asymmetric key coverage. Every key should ' +
    'exist in all three languages so L() never falls back to the raw key.\n' +
    JSON.stringify(report, null, 2),
  );
});

// ── informational: detect orphan keys (defined but never referenced) ─
// Not a regression — translators sometimes add keys speculatively, and
// some keys are interpolated from runtime values we can't statically
// enumerate (e.g. recMed1/2/3, gapMedNote). Marked as a soft check so
// drift here is visible without breaking the build.
test('orphan keys (defined in zh but never referenced) — informational', () => {
  const zhKeys = new Set(Object.keys(I18N.zh));
  const orphans = [...zhKeys].filter((k) => !ALL_REFERENCED.has(k)).sort();
  if (orphans.length > 0) {
    console.log(
      `\n  ℹ ${orphans.length} I18N keys are defined but never referenced ` +
      `statically.\n  These may be dynamic (e.g. recMed1/2/3 used via runtime ` +
      `branches) or genuinely dead.\n  Orphans: ${JSON.stringify(orphans)}`,
    );
  }
  // Always pass — this is a report, not a gate.
  assert.ok(true);
});
