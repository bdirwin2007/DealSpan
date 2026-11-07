// DealSpan acceptance checks. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeDeal, InputError} from '../lib/dealspan.js';
import {readSample, readFixtures} from '../lib/samples.js';
import {monthlyPayment, amortizeByYear, irr, minor} from '../lib/math.js';
import {buildWorkbook} from '../lib/excel.js';

const fx = await readFixtures();
const clone = o => JSON.parse(JSON.stringify(o));

// ---------- 1. Valid input ----------
test('1. valid input: Buckeye add-on acquisition produces exact verified earnings and a NEGOTIATE verdict', async () => {
  const r = analyzeDeal(await readSample('buckeye-landscaping'), fx);
  assert.equal(r.earnings.claimedSde, '410000.00');
  assert.equal(r.earnings.verifiedSde, '331200.00'); // 158,200 + 95,000 + 48,500 + 12,300 + 14,200 + 3,000
  assert.equal(r.verified.ebitda, '246200.00'); // minus $85,000 replacement manager
  assert.equal(r.recommendation.verdict, 'NEGOTIATE');
  assert.equal(r.recommendation.suggestedOffer, '894000.00');
  assert.equal(r.football.length, 5);
  for (const b of r.football) assert.ok(minor(b.low) <= minor(b.mid) && minor(b.mid) <= minor(b.high), b.method + ' bar is ordered');
  // Every method values the business lower on verified earnings than on the seller's numbers
  for (const b of r.football) assert.ok(minor(b.mid) < minor(b.sellerMid), b.method + ' verified < seller');
  assert.ok(r.findings.some(f => f.area === 'Qualitative') && r.findings.some(f => f.area === 'Earnings'));
});

test('1b. clean deal PROCEEDs, weak deal WALKs', async () => {
  assert.equal(analyzeDeal(await readSample('clearwater-hvac'), fx).recommendation.verdict, 'PROCEED');
  const d = analyzeDeal(await readSample('maple-street-diner'), fx);
  assert.equal(d.recommendation.verdict, 'WALK');
  assert.ok(d.assumptions.some(a => a.includes('SBA 7(a) rate')), 'defaults are disclosed');
});

// ---------- 2. Missing / invalid input ----------
test('2a. invalid input lists every field problem', async () => {
  const d = clone(await readSample('buckeye-landscaping'));
  d.target.asking_price_usd = '$1.1M'; d.target.industry = 'bakery'; d.target.addbacks[0].documented = 'maybe'; delete d.buyer.cash_available_usd;
  assert.throws(() => analyzeDeal(d, fx), e => {
    assert.ok(e instanceof InputError);
    const fields = e.errors.map(x => x.field);
    for (const f of ['target.asking_price_usd', 'target.industry', 'target.addbacks[0].documented', 'buyer.cash_available_usd']) assert.ok(fields.includes(f), f);
    return true;
  });
});

test('2b. missing supporting documents become findings and missing-input notes, not crashes', async () => {
  const d = clone(await readSample('buckeye-landscaping'));
  const cur = d.target.financials[2]; delete cur.tax_net_income_usd; delete cur.tax_revenue_usd; delete cur.bank_deposits_usd; d.target.qualitative = {};
  const r = analyzeDeal(d, fx);
  assert.ok(r.missingInputs.includes('Tax return net income for FY2025'));
  assert.ok(r.findings.some(f => f.rule === 'unverified_base' && f.severity === 'high'));
  assert.equal(r.earnings.verifiedSde, '344000.00'); // falls back to P&L 171,000, labeled NOT tax-verified
  assert.match(r.earnings.bridge[0].label, /NOT tax-verified/);
  assert.ok(r.qualitative.every(q => q.note === 'Not answered yet'));
});

test('2c. impossible DCF settings are rejected', async () => {
  const d = clone(await readSample('buckeye-landscaping'));
  d.valuation.terminal_growth_bps = 2400;
  assert.throws(() => analyzeDeal(d, fx), e => e.errors.some(x => x.field === 'valuation'));
});

// ---------- 3. Financial / source reconciliation ----------
test('3a. bridge, DCF and sources & uses reconcile exactly', async () => {
  const r = analyzeDeal(await readSample('buckeye-landscaping'), fx);
  const sum = r.earnings.bridge.reduce((s, l) => s + minor(l.verified, {signed: true}), 0n);
  assert.equal(sum, minor(r.earnings.verifiedSde));
  const dcf = r.verified.dcf;
  assert.equal(dcf.years.reduce((s, y) => s + minor(y.pv, {signed: true}), 0n), minor(dcf.pvForecast));
  assert.equal(minor(dcf.pvForecast) + minor(dcf.pvTerminal), minor(dcf.enterpriseValue));
  const s = r.verified.lbo.sources;
  assert.equal(minor(s.buyerEquity) + minor(s.sellerNote) + minor(s.sbaLoan), minor(r.recommendation.askingPrice));
  for (const f of r.findings) for (const e of f.evidence) assert.ok(e.field && e.document, 'finding cites a field and document');
});

test('3b. loan math matches the amortization formula; schedule pays off; IRR is correct', () => {
  const r = 1050 / 120000, exp = 920000 * r / (1 - (1 + r) ** -120);
  assert.ok(Math.abs(Number(monthlyPayment(92000000n, 1050, 120)) / 100 - exp) < 0.01);
  const sched = amortizeByYear(92000000n, 1050, 120, 10);
  assert.equal(sched.years.reduce((t, y) => t + y.principal, 0n), 92000000n);
  assert.equal(sched.years[9].balance, 0n);
  assert.equal(irr([-100000n, 0n, 121000n]), 0.1); // -100 then +121 in year 2 = 10%
});

test('3c. Excel workbook builds with all model tabs', async () => {
  const r = analyzeDeal(await readSample('clearwater-hvac'), fx);
  const buf = await buildWorkbook(r);
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
  assert.ok(buf.length > 10000);
});
