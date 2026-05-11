// recalc() golden-snapshot test.
//
// Targets two documented regression classes:
//   v4.12 deathNeed bug — formula must be PV + IDE + totalDebts, not
//                         just PV + IDE
//   v4.13 carLoanBal display bug — the debt-detail table in
//                         financeSummaryTable must include a Car
//                         Loan row whose value matches totalDebts
//
// Strategy: extract recalc() (and the helpers it depends on) from
// index.html, run it against a hand-rolled fake `document` populated
// with the v4.12 demo fixture, then capture the HTML written to each
// output target and the textContent set on cover/print cells. Assert
// against:
//   - hand-computed expected values for the core financial outputs
//     (totalDebts, deathNeed, totalIncome, netCashFlow)
//   - presence of specific substrings in the rendered tables that
//     prove the v4.13 carLoanBal display is intact
//
// Run with:   node --test tests/recalc.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ── extract the source code we need to evaluate ──────────────────────
function extract(pattern, label) {
  const m = src.match(pattern);
  if (!m) throw new Error(`Could not extract ${label} from index.html`);
  return m[0];
}

const code = [
  extract(/const COVER_TABLE = \{[\s\S]*?\n\};/m,                 'COVER_TABLE'),
  extract(/function PV\([\s\S]*?\n\}/m,                           'PV'),
  extract(/function NPER\([\s\S]*?\n\}/m,                         'NPER'),
  extract(/function getCoverRatio\([\s\S]*?\n\}/m,                'getCoverRatio'),
  extract(/^function n\(id\)[^\n]*$/m,                            'n'),
  extract(/^function s\(id\)[^\n]*$/m,                            's'),
  extract(/^function fmt\(v, d=0\) \{[\s\S]*?\n\}/m,              'fmt'),
  extract(/^function fmtRaw\(v, d=0\) \{[\s\S]*?\n\}/m,           'fmtRaw'),
  extract(/^function fmtNum\(v, d=0, suffix=''\) \{[\s\S]*?\n\}/m,'fmtNum'),
  extract(/function statusBadge\([\s\S]*?\n\}/m,                  'statusBadge'),
  extract(/function progressBar\([\s\S]*?\n\}/m,                  'progressBar'),
  extract(/function setHtml\(id, html\)[^\n]*$/m,                 'setHtml'),
  extract(/function recalc\(\) \{[\s\S]*?\n\}\n/m,                'recalc'),
].join('\n');

// ── minimal DOM stub ─────────────────────────────────────────────────
// One generic element shape covers every read/write that recalc()
// makes: inputs (value/checked), output containers (innerHTML/textContent),
// and the few querySelector* calls.
function makeElement(id, init = {}) {
  const el = {
    id,
    value: String(init.value ?? ''),
    checked: !!init.checked,
    textContent: '',
    innerHTML: '',
    type: init.type ?? 'text',
    style: { display: '' },
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    // recalc reads apDisp.childNodes[0].textContent — provide a stub.
    childNodes: [{ textContent: '' }],
    // The only querySelector targets recalc uses: .calc-badge,
    // .ap-date-print, input.ap-date-input. Returning null is safe —
    // recalc guards each call with `&& el && ...`.
    querySelector: () => null,
    querySelectorAll: () => [],
    dataset: {},
  };
  return el;
}

function makeDoc(profile) {
  const elems = new Map();
  // Pre-populate every fixture entry. Anything else gets auto-created
  // on first read so recalc never crashes on a missing id (it would
  // get .value="" → n() returns 0, which matches the production
  // behaviour for an empty form).
  for (const [id, init] of Object.entries(profile)) {
    elems.set(id, makeElement(id, init));
  }
  return {
    getElementById(id) {
      let el = elems.get(id);
      if (!el) { el = makeElement(id); elems.set(id, el); }
      return el;
    },
    querySelectorAll() { return []; },
    _elems: elems,
    _get(id) { return elems.get(id); },
  };
}

// ── L() stub returns key unchanged ───────────────────────────────────
// recalc embeds many L('...') calls into rendered HTML; returning the
// key itself keeps the rendered output readable for substring checks.
const L_STUB = "function L(k){ return k; }";

// Pinned "today" so cover-date / printDate are deterministic. recalc
// reads `new Date()` inside the falsy-fallback path for reportDate; we
// always provide a reportDate to avoid touching that path.
function makeSandbox(doc) {
  const sb = {
    document: doc,
    window: {},                   // recalc reads window._apStatus / _apDate
    Math, Number, parseInt, parseFloat, isNaN, isFinite,
    Date, Object,
    console: { log() {}, warn() {} },
  };
  vm.createContext(sb);
  vm.runInContext(L_STUB + '\nlet currentLang = "zh";\n' + code +
    '\n;this.recalc = recalc;', sb);
  return sb;
}

// ── v4.12 demo profile (from index.html:2690 loadDemo) ───────────────
function demoProfile() {
  const values = {
    plannerName:'John Ten', clientName:'Ahmad bin Abdullah',
    reportDate:'2026-05-11',
    clientAge:38, yearsResp:15,
    salaryMain:8500, salarySpouse:4500, rentalIncome:0, otherIncome:0,
    expFood:1200, expUtil:800, expChild:600, expOther:400,
    homeBalance:450000, homeMonthly:2100,
    officeBalance:0,    officeMonthly:0,
    ip1Balance:280000,  ip1Monthly:1200,
    ip2Balance:0, ip2Monthly:0, ip3Balance:0, ip3Monthly:0,
    ip4Balance:0, ip4Monthly:0, ip5Balance:0, ip5Monthly:0,
    carLoan:65000, carMonthly:1100, ccPersonal:15000,
    inflationRate:3.69, interestRate:2.5, ide:20000, rrf:5000,
    // policy 1 only
    p1death:350000, p1tpd:250000, p1pa:100000,
    p1ci:100000, p1eci:50000, p1dis:2000, p1prem:7200,
    p1rb:150, p1ll:500000, p1al:100000, p1dh:100, p1ciw:1200, p1tpdw:0,
  };
  const profile = {};
  for (const [id, v] of Object.entries(values)) profile[id] = { value: v };
  // Checkboxes: MRTA off for home + ip1, on for office (per loadDemo default).
  profile.homeMRTA   = { type:'checkbox', checked:false };
  profile.officeMRTA = { type:'checkbox', checked:false };
  for (let i = 1; i <= 5; i++) {
    profile[`ip${i}MRTA`] = { type:'checkbox', checked:false };
  }
  return profile;
}

// Lightweight "extract a RM amount from rendered HTML" — used to dig
// numbers out of the financeSummaryTable rows. recalc renders amounts
// as "RM 1,234,567" via fmtRaw.
function rmToNumber(rmString) {
  const m = rmString.match(/RM\s+([\d,]+)/);
  if (!m) return null;
  return Number(m[1].replace(/,/g, ''));
}

// ════════════════════════════════════════════════════════════════════
//  Tests
// ════════════════════════════════════════════════════════════════════

test('recalc runs to completion on the demo fixture without throwing', () => {
  const doc = makeDoc(demoProfile());
  makeSandbox(doc).recalc();
  // Each documented output target must have non-empty HTML afterwards.
  const targets = [
    'financeSummaryKpi','financeSummaryTable','needsTable',
    'riskRatioTable','gapComparison','medicalKpi','medicalRecommend',
    'recommendations','actionPlan',
  ];
  for (const t of targets) {
    const html = doc._get(t)?.innerHTML ?? '';
    assert.ok(html.length > 0, `recalc did not populate #${t}`);
  }
});

test('totalDebts row matches the sum of all debt components (v4.13 regression)', () => {
  const doc = makeDoc(demoProfile());
  makeSandbox(doc).recalc();
  const html = doc._get('financeSummaryTable').innerHTML;

  // Pull the RM values out of the labelled rows. Labels come back as
  // the i18n key thanks to L_STUB. Some labels are wrapped in <b> (the
  // total row), some aren't (the four detail rows) — accept either.
  const row = (key) => {
    const re = new RegExp(
      `<td>(?:<b>)?${key}(?:</b>)?</td>\\s*<td[^>]*>(?:<b>)?\\s*(RM\\s*[\\d,]+|—)`,
    );
    const m = html.match(re);
    return m ? rmToNumber(m[1]) : null;
  };

  const homeBal = row('fsHomeBal');   // home + office balance (no-MRTA)
  const invBal  = row('fsInvBal');    // investment property balance
  const carBal  = row('fsCarBal');    // ← the row added in v4.13
  const ccp     = row('fsCCP');       // credit card + personal loan
  const total   = row('fsTotalDebt'); // total debt

  // The v4.13 fix specifically added the fsCarBal row. If it
  // disappears or the i18n key gets renamed, this assertion fails.
  assert.equal(carBal, 65000,
    'fsCarBal row is missing or its value does not match the input. ' +
    'v4.13 explicitly added this row to the debt-detail table.');

  // All four component rows must sum to totalDebts.
  assert.equal(
    homeBal + invBal + carBal + ccp, total,
    `debt-detail rows (${homeBal}+${invBal}+${carBal}+${ccp}) do not sum to ` +
    `the displayed total (${total}). Check fsCarBal isn't being silently dropped.`,
  );
  // And the total must equal what the user entered.
  assert.equal(total, 450000 + 280000 + 65000 + 15000);
});

test('deathNeed includes IDE + totalDebts (v4.12 regression)', () => {
  const doc = makeDoc(demoProfile());
  makeSandbox(doc).recalc();
  const html = doc._get('needsTable').innerHTML;

  // needsTable renders three rows: nDeath / nTPD / nCI. Pull the
  // "need" cell out of the death row.
  const m = html.match(/<td><b>nDeath<\/b>[\s\S]*?<td class="need-val"[^>]*>RM\s+([\d,]+)/);
  assert.ok(m, 'Could not find nDeath need-cell in needsTable HTML');
  const deathNeed = Number(m[1].replace(/,/g, ''));

  // Hand-computed reference:
  //   realRate     = (0.025 - 0.0369) / 1.0369    ≈ -0.011477
  //   annExpDeath  = (monthlyExpBase - annPremium/12) * 12
  //                = ((3000 + 600) - 600) * 12   = 36,000
  //   PV(rr, 15, -36000) ≈ 592,798
  //   IDE          = 20,000
  //   totalDebts   = 450,000 + 280,000 + 65,000 + 15,000 = 810,000
  //   deathNeed    = PV + IDE + totalDebts ≈ 1,422,798
  //
  // The v4.12 BUG would have given PV + IDE ≈ 612,798 — half the
  // correct figure. We assert a tight window around the correct
  // value, so reverting the v4.12 fix would fail loudly.
  assert.ok(
    deathNeed >= 1_400_000 && deathNeed <= 1_450_000,
    `deathNeed=${deathNeed} is outside the v4.12-correct range ` +
    `[1,400,000 .. 1,450,000]. If this fails near 600,000–620,000 the ` +
    `+ totalDebts term has been lost; if it's far above, IDE/RRF/PV math changed.`,
  );

  // Sanity: must be greater than (IDE + totalDebts) alone — proves PV
  // term is also present.
  assert.ok(deathNeed > 20_000 + 810_000,
    'deathNeed should exceed (IDE + totalDebts) — the PV term is missing.');
});

test('financialSummary cashflow KPI reflects income minus total monthly expense', () => {
  const doc = makeDoc(demoProfile());
  makeSandbox(doc).recalc();
  const html = doc._get('financeSummaryKpi').innerHTML;

  // KPI block renders income / expense / cashflow / debt / premium.
  // Cashflow line is "RM +5,000" or "RM -X" depending on sign. With
  // the demo fixture the values are:
  //   income       = 13,000
  //   totalExpense = unsettledMonthlyExp = 3000 + 600 + 2100 + 1200 + 1100 = 8,000
  //   cashflow     = +5,000
  assert.ok(html.includes('RM +5,000'),
    'cashflow KPI should read "RM +5,000" for the demo fixture; got: ' +
    (html.match(/RM\s*[+\-][\d,]+/) || [''])[0]);
});

test('totalCI in needsTable equals ciBenefit + earlyCI', () => {
  const doc = makeDoc(demoProfile());
  makeSandbox(doc).recalc();
  const html = doc._get('needsTable').innerHTML;
  // Demo has p1ci=100,000 and p1eci=50,000 → totalCI=150,000.
  const m = html.match(/<td><b>nCI<\/b>[\s\S]*?<td class="current-val"[^>]*>RM\s+([\d,]+)/);
  assert.ok(m, 'Could not find nCI current-cell in needsTable HTML');
  assert.equal(Number(m[1].replace(/,/g, '')), 150_000);
});

test('empty fixture (zeroed form) produces no NaN or "RM NaN" output', () => {
  // Regression guard: blank inputs everywhere should render em dashes
  // and zero KPIs, never "RM NaN" or "Infinity".
  const profile = {};
  for (const id of ['inflationRate','interestRate']) profile[id] = { value: 0 };
  const doc = makeDoc(profile);
  makeSandbox(doc).recalc();
  for (const t of ['financeSummaryKpi','financeSummaryTable','needsTable','riskRatioTable']) {
    const html = doc._get(t).innerHTML;
    assert.ok(!html.includes('NaN'),      `#${t} contains "NaN":\n${html.slice(0, 200)}`);
    assert.ok(!html.includes('Infinity'), `#${t} contains "Infinity":\n${html.slice(0, 200)}`);
  }
});
