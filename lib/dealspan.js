// DealSpan engine: a small business buying another small business.
// 1) Verify the target's earnings against tax returns, bank deposits and add-back evidence.
// 2) Score strategic fit and risk, and generate questions for the seller.
// 3) Run DCF, LBO, comps and precedents on VERIFIED vs CLAIMED earnings.
// 4) Size SBA financing, value itemized synergies with haircuts, and recommend an offer.
// No LLM. All money is BigInt cents; all rates are integer basis points.
import {parseCSV} from './csv.js';
import {
  minor, amount, divideRound, abs, max0, applyBps, grow, roundDownThousand, multipleBps, fmtMultiple,
  ratio4, pctStr, usd, compound, presentValue, monthlyPayment, amortizeByYear, irr, quartiles, sortBig
} from './math.js';

export class InputError extends Error {
  constructor(errors) { super(errors.map(e => `${e.field}: ${e.message}`).join('; ')); this.errors = errors; }
}

export const INDUSTRIES = ['landscaping', 'hvac', 'restaurant', 'auto_repair', 'commercial_cleaning', 'other'];
export const ADDBACK_CATEGORIES = {
  owner_salary: "Owner's salary or draw", interest: 'Interest expense', depreciation: 'Depreciation', amortization: 'Amortization',
  one_time: 'One-time expense', personal: 'Personal expense run through the business', family_payroll: 'Family member on payroll',
  pro_forma: 'Projected / future savings', other: 'Other'
};

// Defaults: [value, plain-English explanation]. Any default actually used is listed in the report.
export const DEFAULTS = {
  financing: {
    down_payment_bps: [1000, 'Buyer equity 10% of price (SBA 7(a) minimum for acquisitions)'],
    seller_note_bps: [1000, 'Seller note 10% of price'],
    sba_rate_bps: [1050, 'SBA 7(a) rate 10.50% (illustrative; confirm current prime + spread)'],
    sba_term_months: [120, 'SBA 7(a) term 10 years'],
    seller_note_rate_bps: [600, 'Seller note rate 6.00%'],
    seller_note_term_months: [60, 'Seller note term 5 years'],
    closing_costs_bps: [300, 'Closing costs and fees 3% of price, paid by the buyer'],
    target_dscr: ['1.30', 'Target debt service coverage 1.30x'],
    sba_min_dscr: ['1.15', 'SBA minimum debt service coverage 1.15x'],
    stress_bps: [300, 'Rate stress: SBA rate +3.00%']
  },
  valuation: {
    growth_bps: [300, 'Revenue growth 3.0% per year'],
    terminal_growth_bps: [250, 'Long-term growth after year 5: 2.5%'],
    tax_rate_bps: [2100, 'Tax rate 21%'],
    capex_bps: [150, 'Maintenance capex 1.5% of revenue'],
    nwc_bps: [1000, 'Working capital 10% of each new revenue dollar'],
    risk_free_bps: [450, 'Risk-free rate 4.5% (illustrative 10-year Treasury)'],
    equity_premium_bps: [500, 'Equity risk premium 5.0%'],
    size_premium_bps: [1000, 'Small-company size premium 10.0%'],
    specific_risk_bps: [500, 'Company-specific risk 5.0%'],
    comps_discount_low_bps: [6000, 'Public multiples discounted 60% (high end of range) for size and illiquidity'],
    comps_discount_high_bps: [7500, 'Public multiples discounted 75% (low end of range) for size and illiquidity'],
    target_irr_bps: [2500, "Buyer's target return (IRR) 25%"]
  },
  synergies: {
    integration_cost_usd: ['0', 'No one-time integration cost entered'],
    revenue_realization_bps: [7700, 'New-revenue synergies kept at 77% (they fall about 23% short on average), counted at the target EBITDA margin and phased in over 5 years'],
    cost_realization_bps: [8000, 'Cost savings kept at 80%, half in year 1 and all from year 2']
  }
};

// Fit + risk questionnaire. Option value -> null (neutral) | ['strength', note] | ['medium'|'high', note, question for the seller]
export const QUESTIONS = [
  // Strategic fit
  {id: 'offering_overlap', group: 'fit', label: 'What does the target sell compared with you?', why: 'Same or complementary services are easier to run and create synergies.',
    options: {same: ['strength', 'Same services: easy to combine crews, pricing and equipment'], complementary: ['strength', 'Complementary services: room to cross-sell'], unrelated: ['medium', 'Unrelated business: harder to run and fewer synergies', 'What would it take for our team to run this without you?']}},
  {id: 'geography', group: 'fit', label: 'Where does the target operate relative to you?', why: 'Next-door markets add territory while staying easy to manage.',
    options: {same_market: ['strength', 'Same market: easiest to integrate'], next_door: ['strength', 'Next-door market: new territory, close enough to manage'], new_region: ['medium', 'New region: harder to oversee from a distance', 'Who would run the business locally after the sale?']}},
  {id: 'customer_overlap', group: 'fit', label: 'How many customers do you already share?', why: 'Shared customers are not new revenue.',
    options: {low: ['strength', 'Low customer overlap: revenue is additive'], some: null, high: ['medium', 'High customer overlap: some revenue may not be additive', 'Which of your customers already buy from us, and how much?']}},
  {id: 'cross_sell', group: 'fit', label: 'How much room is there to cross-sell?', why: 'Cross-selling is the main source of revenue synergies.',
    options: {low: null, some: null, high: ['strength', 'Clear path to revenue synergies']}},
  {id: 'culture_fit', group: 'fit', label: 'How well do the two cultures fit?', why: 'Culture clashes are a top reason key people leave after a deal.',
    options: {strong: ['strength', 'Strong culture fit'], workable: ['medium', 'Workable culture: expect friction in year one', null], weak: ['high', 'Weak culture fit: retention risk', null]}},
  {id: 'integration_difficulty', group: 'fit', label: 'How hard will integration be?', why: 'Systems, payroll and processes all have to move over.',
    options: {easy: ['strength', 'Easy to integrate'], moderate: ['medium', 'Moderate integration: budget time and money for systems and people', null], hard: ['high', 'Hard integration: synergies will take longer', null]}},
  // Risk
  {id: 'owner_relationships', group: 'risk', label: 'Do key customers or suppliers deal mainly with the current owner?', why: 'If the relationships leave with the seller, revenue can leave too.',
    options: {no: ['strength', 'Relationships are not tied to the owner'], partly: ['medium', 'Some key relationships run through the owner', 'Which customer and supplier relationships do you personally hold, and how will you hand them off?'], yes: ['high', 'Key relationships run through the owner', 'Which customer and supplier relationships do you personally hold, and how will you hand them off?']}},
  {id: 'manager_in_place', group: 'risk', label: 'Is there a manager (not the owner) who runs day-to-day work and is staying?', why: 'A business that runs without the owner is worth more and is safer to buy.',
    options: {yes: ['strength', 'A manager runs daily operations and is staying'], no: ['medium', 'No manager besides the owner runs daily operations', 'Who runs the business when you are away, and would they stay?']}},
  {id: 'owner_hours', group: 'risk', type: 'number', label: 'Hours per week the owner works in the business', why: 'Long owner hours are work your company will have to pay someone to do.',
    rule: v => (v > 55 ? ['high', `Owner works ${v} hours a week`, 'Walk us through a typical week: which tasks only you do?'] : v > 40 ? ['medium', `Owner works ${v} hours a week`, 'Walk us through a typical week: which tasks only you do?'] : null)},
  {id: 'key_employees_staying', group: 'risk', label: 'Have key employees agreed to stay after the sale?', why: 'Losing a lead technician or crew chief can stall the business.',
    options: {yes: ['strength', 'Key employees have agreed to stay'], unknown: ['medium', 'Key employee retention not confirmed', 'Which managers and lead employees have agreed to stay?'], no: ['high', 'Key employees are not staying', 'Which managers and lead employees have agreed to stay?']}},
  {id: 'recurring_revenue_pct', group: 'risk', type: 'number', label: 'What % of revenue is recurring (contracts, memberships, repeat service)?', why: 'Recurring revenue is more predictable, so it is worth more.',
    rule: v => (v < 20 ? ['medium', `Only ${v}% of revenue is recurring`, 'How much revenue is under contract, and for how long?'] : v >= 50 ? ['strength', `${v}% of revenue is recurring`] : null)},
  {id: 'industry_outlook', group: 'risk', label: "How is the target's local market trending?", why: 'A shrinking market makes the growth assumptions risky.',
    options: {growing: ['strength', 'Local market is growing'], stable: null, declining: ['high', 'Local market is declining', 'What is driving the local decline, and how has it shown up in your numbers?']}},
  {id: 'lease_transferable', group: 'risk', label: 'Can the lease be transferred to your company?', why: 'If the landlord says no, you may have to move or renegotiate rent.',
    options: {yes: null, na: null, unknown: ['medium', 'Lease transfer not confirmed', 'Will the landlord consent to assigning the lease, and on what terms?'], no: ['high', 'Lease cannot be transferred', 'Will the landlord sign a new lease with us, and on what terms?']}},
  {id: 'licenses_transferable', group: 'risk', label: 'Do required licenses and permits transfer, or can your team hold them?', why: 'Some licenses are personal to the owner.',
    options: {yes: null, na: null, unknown: ['medium', 'License transfer not confirmed', 'Which licenses are personal to you, and can our team hold them before closing?'], no: ['high', 'Required licenses do not transfer', 'Which licenses are personal to you, and can our team hold them before closing?']}},
  {id: 'customer_contracts_signed', group: 'risk', label: 'Are major customer contracts signed and assignable?', why: 'Unsigned or non-assignable contracts may not survive the sale.',
    options: {yes: null, na: null, no: ['high', 'Major customer contracts are unsigned or not assignable', 'Can you provide signed copies of the major customer contracts, including the assignment clauses?']}},
  {id: 'seller_transition_months', group: 'risk', type: 'number', label: 'How many months will the seller help with the transition?', why: 'A longer handoff protects customer and employee relationships.',
    rule: v => (v === 0 ? ['high', 'Seller offers no transition period', 'Would you commit to a paid transition period in the purchase agreement?'] : v < 3 ? ['medium', `Seller offers only ${v} month(s) of transition`, 'Would you commit to a 6-month paid transition in the purchase agreement?'] : null)},
  {id: 'reason_for_sale', group: 'risk', label: 'Why is the owner selling?', why: 'Retirement is common; a declining business is a warning sign.',
    options: {retirement: null, burnout: null, health: null, other: null, partner_dispute: ['medium', 'Sale driven by a partner dispute', 'Do all partners agree to the sale and its terms?'], declining_business: ['high', 'Owner is selling because the business is declining', 'Why now, and what would make you keep running it?']}},
  {id: 'pending_legal_issues', group: 'risk', label: 'Any lawsuits, tax liens or regulatory issues?', why: 'Liabilities can follow the business.',
    options: {no: null, unknown: ['medium', 'Legal and lien search not done', 'Can you provide lien searches and a list of any claims or disputes?'], yes: ['high', 'Pending legal, lien or regulatory issues', 'Can you provide details and documents for every pending claim, lien or dispute?']}}
];

const SEV = {high: 3, medium: 2, low: 1};

// ---------- Fixtures ----------
export function loadPrecedents(csv) {
  return parseCSV(csv).map((r, i) => ({id: r.precedent_id, row: i + 2, industry: r.industry, sde: minor(r.sde_usd), price: minor(r.sale_price_usd), synthetic: r.synthetic === 'true'}));
}
export function loadSectorMultiples(csv) {
  return Object.fromEntries(parseCSV(csv).map(r => [r.industry, {sector: r.damodaran_sector, multiple: minor(r.ev_ebitda_positive), firms: Number(r.firms), asOf: r.as_of, url: r.source_url}]));
}

// ---------- Input normalization ----------
function normalize(deal) {
  const errors = [], assumptions = [];
  const err = (field, message) => errors.push({field, message});
  const str = (v, field, req = true) => { if (typeof v === 'string' && v.trim()) return v.trim(); if (req) err(field, 'Required'); return null; };
  const money = (v, field, {req = false, signed = false} = {}) => {
    if (v === undefined || v === null || v === '') { if (req) err(field, 'Required'); return null; }
    const text = String(v).trim().replace(/,/g, '');
    try { return minor(text, {signed}); } catch { err(field, `"${v}" is not a valid dollar amount`); return null; }
  };
  const int = (v, field, lo, hi) => {
    if (!Number.isInteger(v) || v < lo || v > hi) { err(field, `Must be a whole number from ${lo} to ${hi}`); return null; }
    return v;
  };
  const section = (obj, name) => {
    const out = {};
    for (const [k, [def, text]] of Object.entries(DEFAULTS[name])) {
      let v = obj?.[k];
      if (v === undefined || v === null || v === '') { v = def; assumptions.push(text); }
      if (k.endsWith('_usd') || k.endsWith('dscr')) out[k] = money(v, `${name}.${k}`);
      else out[k] = int(typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : v, `${name}.${k}`, -5000, 100000);
    }
    return out;
  };

  if (!deal || typeof deal !== 'object') throw new InputError([{field: 'deal', message: 'Deal must be a JSON object'}]);
  const b = deal.buyer || {}, t = deal.target || {};
  const buyer = {
    name: str(b.name, 'buyer.name'), industry: str(b.industry, 'buyer.industry', false) || 'other',
    revenue: money(b.revenue_usd, 'buyer.revenue_usd', {req: true}), ebitda: money(b.ebitda_usd, 'buyer.ebitda_usd', {req: true, signed: true}),
    cash: money(b.cash_available_usd, 'buyer.cash_available_usd', {req: true}),
    existingDebtService: money(b.existing_debt_service_usd ?? '0', 'buyer.existing_debt_service_usd') ?? 0n,
    existingDebt: money(b.existing_debt_usd ?? '0', 'buyer.existing_debt_usd') ?? 0n
  };
  const target = {
    name: str(t.name, 'target.name'), industry: t.industry, location: t.location || '', yearsInBusiness: t.years_in_business ?? null,
    asking: money(t.asking_price_usd, 'target.asking_price_usd', {req: true}),
    managerSalary: money(t.manager_salary_usd, 'target.manager_salary_usd', {req: true}),
    da: money(t.da_usd, 'target.da_usd'), whyThisDeal: typeof t.why_this_deal === 'string' ? t.why_this_deal.trim().slice(0, 600) : '',
    sources: {claim: 'Seller listing / CIM', pnl: 'Seller P&L', tax: 'Tax returns', bank: 'Bank statements', ...(t.sources || {})},
    financials: [], addbacks: [], qualitative: {}
  };
  if (!INDUSTRIES.includes(t.industry)) err('target.industry', `Must be one of ${INDUSTRIES.join(', ')}`);
  if (target.asking !== null && target.asking <= 0n) err('target.asking_price_usd', 'Must be greater than zero');

  const fin = Array.isArray(t.financials) ? t.financials : [];
  if (!fin.length || fin.length > 5) err('target.financials', 'Enter 1 to 5 years of financials, oldest first');
  const seen = new Set();
  fin.forEach((r, i) => {
    const f = `target.financials[${i}]`;
    const period = str(r.period, f + '.period');
    if (period && seen.has(period)) err(f + '.period', `Duplicate year ${period}`); seen.add(period);
    const row = {period, i};
    for (const k of ['claimed_revenue', 'pnl_revenue', 'tax_revenue', 'bank_deposits', 'claimed_sde', 'top_customer_revenue']) row[k] = money(r[k + '_usd'], `${f}.${k}_usd`);
    for (const k of ['pnl_net_income', 'tax_net_income']) row[k] = money(r[k + '_usd'], `${f}.${k}_usd`, {signed: true});
    target.financials.push(row);
  });
  (Array.isArray(t.addbacks) ? t.addbacks : []).forEach((a, i) => {
    const f = `target.addbacks[${i}]`;
    if (!ADDBACK_CATEGORIES[a.category]) err(f + '.category', 'Unknown category');
    for (const k of ['documented', 'buyer_must_replace']) if (!['yes', 'no'].includes(a[k])) err(`${f}.${k}`, 'Must be yes or no');
    if (!seen.has(a.period)) err(f + '.period', `Year ${a.period} is not in the financials`);
    target.addbacks.push({i, period: a.period, category: a.category, description: str(a.description, f + '.description'),
      amount: money(a.amount_usd, f + '.amount_usd', {req: true}), documented: a.documented, buyerMustReplace: a.buyer_must_replace, source: a.source || ''});
  });
  const q = t.qualitative || {};
  for (const Q of QUESTIONS) {
    const v = q[Q.id];
    if (v === undefined || v === null || v === '') { target.qualitative[Q.id] = null; continue; }
    if (Q.type === 'number') { const n = typeof v === 'string' ? Number(v) : v; target.qualitative[Q.id] = int(n, `target.qualitative.${Q.id}`, 0, Q.id === 'recurring_revenue_pct' ? 100 : 168); }
    else if (!(v in Q.options)) err(`target.qualitative.${Q.id}`, `Must be one of ${Object.keys(Q.options).join(', ')}`);
    else target.qualitative[Q.id] = v;
  }
  const financing = section(deal.financing, 'financing');
  const valuation = section(deal.valuation, 'valuation');
  const synergies = section(deal.synergies, 'synergies');
  // Itemized synergies (older deal files may use cost_savings_usd / revenue_synergy_usd lump sums)
  const s = deal.synergies || {};
  let items = Array.isArray(s.items) ? s.items : [];
  if (!items.length) {
    if (s.cost_savings_usd && s.cost_savings_usd !== '0') items.push({type: 'cost', description: 'Cost savings', amount_usd: s.cost_savings_usd});
    if (s.revenue_synergy_usd && s.revenue_synergy_usd !== '0') items.push({type: 'revenue', description: 'New revenue', amount_usd: s.revenue_synergy_usd});
  }
  synergies.items = items.map((it, i) => {
    const f = `synergies.items[${i}]`;
    if (!['cost', 'revenue'].includes(it.type)) err(f + '.type', 'Must be cost or revenue');
    return {i, type: it.type, description: str(it.description, f + '.description'), amount: money(it.amount_usd, f + '.amount_usd', {req: true})};
  });
  if (!synergies.items.length) assumptions.push('No synergies entered');
  if (financing.down_payment_bps !== null && (financing.down_payment_bps < 1 || financing.down_payment_bps + financing.seller_note_bps > 10000)) err('financing.down_payment_bps', 'Down payment must be above 0% and down payment + seller note at most 100%');
  for (const k of ['sba_term_months', 'seller_note_term_months']) if (financing[k] !== null && (financing[k] < 1 || financing[k] > 360)) err('financing.' + k, 'Term must be 1-360 months');
  if (valuation.comps_discount_low_bps > valuation.comps_discount_high_bps) err('valuation.comps_discount_low_bps', 'Low discount must not exceed high discount');
  const r = valuation.risk_free_bps + valuation.equity_premium_bps + valuation.size_premium_bps + valuation.specific_risk_bps;
  if (r - 200 <= valuation.terminal_growth_bps + 200) err('valuation', 'Discount rate must be at least 4 points above long-term growth for the DCF to work');
  if (errors.length) throw new InputError(errors);
  return {buyer, target, financing, valuation, synergies, assumptions, discountBps: r};
}

// ---------- Add-back rules ----------
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function decideAddback(a, all, ownerTaken) {
  const periods = new Set(all.filter(o => o.category === 'one_time' && norm(o.description) === norm(a.description)).map(o => o.period));
  if (a.category === 'pro_forma') return ['rejected', 0n, 'Projected savings are not historical earnings. That upside belongs to the buyer, not the seller'];
  if (a.buyerMustReplace === 'yes' && a.category !== 'owner_salary') return ['rejected', 0n, 'The work still has to be paid for after closing, so the cost does not go away'];
  if (a.category === 'owner_salary') {
    if (ownerTaken.has(a.period)) return ['rejected', 0n, "Only one owner's pay is added back. A replacement manager's salary is deducted separately"];
    ownerTaken.add(a.period);
    return a.documented === 'yes' ? ['accepted', a.amount, 'One owner salary, supported by payroll records'] : ['adjusted', divideRound(a.amount, 2n), 'Owner pay not documented: 50% haircut until payroll records are provided'];
  }
  if (['interest', 'depreciation', 'amortization'].includes(a.category))
    return a.documented === 'yes' ? ['accepted', a.amount, 'Standard non-cash or financing add-back, tied to the tax return'] : ['rejected', 0n, 'Not tied to a tax return or financial statement'];
  if (a.category === 'one_time') {
    if (periods.size >= 2) return ['rejected', 0n, `Called one-time but appears in ${periods.size} years, so it is a normal operating cost`];
    return a.documented === 'yes' ? ['accepted', a.amount, 'Documented and appears in one year only'] : ['adjusted', divideRound(a.amount, 2n), 'Undocumented one-time cost: 50% haircut until an invoice is provided'];
  }
  return a.documented === 'yes' ? ['accepted', a.amount, 'Documented expense that ends at closing'] : ['rejected', 0n, 'No document supports this add-back'];
}

// ---------- Synergies ----------
function synergyItems(n, c) {
  const s = n.synergies;
  return s.items.map(it => {
    const ebitdaImpact = it.type === 'cost' ? it.amount : (c.revenue > 0n ? divideRound(it.amount * c.ebitda, c.revenue) : 0n);
    const kept = applyBps(ebitdaImpact, it.type === 'cost' ? s.cost_realization_bps : s.revenue_realization_bps);
    return {...it, ebitdaImpact, kept};
  });
}
function synergyForYear(n, c, y) {
  let ebitda = 0n, revenue = 0n;
  for (const it of synergyItems(n, c)) {
    const phase = it.type === 'cost' ? (y === 1 ? 5000n : 10000n) : BigInt(Math.min(y, 5) * 2000);
    ebitda += divideRound(it.kept * phase, 10000n);
    if (it.type === 'revenue') revenue += divideRound(applyBps(it.amount, n.synergies.revenue_realization_bps) * phase, 10000n);
  }
  return {ebitda, revenue, integration: y === 1 ? n.synergies.integration_cost_usd : 0n};
}

// ---------- Valuation models for one earnings case ----------
function projections(c, n, withSyn) {
  const v = n.valuation, rows = [];
  let rev = c.revenue;
  for (let y = 1; y <= 5; y++) {
    const prev = rev; rev = grow(rev, v.growth_bps);
    const ebitdaBase = c.revenue > 0n ? divideRound(c.ebitda * rev, c.revenue) : c.ebitda;
    const da = c.revenue > 0n ? divideRound(c.da * rev, c.revenue) : c.da;
    const syn = withSyn ? synergyForYear(n, c, y) : {ebitda: 0n, revenue: 0n, integration: 0n};
    const ebitda = ebitdaBase + syn.ebitda;
    const capex = applyBps(rev, v.capex_bps), nwc = applyBps(rev - prev, v.nwc_bps);
    rows.push({year: y, revenue: rev + syn.revenue, ebitda, da, ebit: ebitda - da, synergyEbitda: syn.ebitda, integration: syn.integration, capex, nwc});
  }
  return rows;
}

function dcf(c, n, {withSyn = false, rateShift = 0, growthShift = 0, exitBps = null} = {}) {
  const v = n.valuation, r = n.discountBps + rateShift, g = v.terminal_growth_bps + growthShift;
  const proj = projections(c, n, withSyn);
  let pvSum = 0n;
  const years = proj.map(p => {
    const tax = applyBps(max0(p.ebit - p.integration), v.tax_rate_bps);
    const fcf = p.ebitda - tax - p.capex - p.nwc - p.integration;
    const pv = presentValue(fcf, compound(r, p.year));
    pvSum += pv;
    return {...p, tax, fcf, pv};
  });
  const last = years[4], df5 = compound(r, 5);
  const tv = divideRound(last.fcf * BigInt(10000 + g), BigInt(r - g));
  const pvTv = presentValue(tv, df5);
  const out = {discountRateBps: r, terminalGrowthBps: g, years, terminalValue: tv, pvTerminal: pvTv, pvForecast: pvSum, enterpriseValue: pvSum + pvTv};
  if (exitBps !== null) {
    const exitTv = applyBps(last.ebitda + c.managerSalary, Number(exitBps)); // price / SDE on year-5 SDE
    const pvExit = presentValue(exitTv, df5);
    out.exitMethod = {multiple: fmtMultiple(BigInt(exitBps)), terminalValue: exitTv, pvTerminal: pvExit, enterpriseValue: pvSum + pvExit};
  }
  out.terminalShareBps = out.enterpriseValue > 0n ? Number((pvTv * 10000n) / out.enterpriseValue) : null;
  return out;
}

function financingAt(price, f, bump = 0) {
  const down = applyBps(price, f.down_payment_bps), note = applyBps(price, f.seller_note_bps), sba = price - down - note;
  const sbaM = monthlyPayment(sba, f.sba_rate_bps + bump, f.sba_term_months), noteM = monthlyPayment(note, f.seller_note_rate_bps, f.seller_note_term_months);
  return {price, down, sellerNote: note, sba, closingCosts: applyBps(price, f.closing_costs_bps), sbaMonthly: sbaM, noteMonthly: noteM, annualDebtService: 12n * (sbaM + noteM)};
}
function maxPriceForDscr(available, f, targetHundredths, bump = 0) {
  if (available <= 0n) return 0n;
  const ref = 100_000_000n, ds = financingAt(ref, f, bump).annualDebtService;
  let p = roundDownThousand((available * ref * 100n) / (targetHundredths * ds));
  while (p > 0n && available * 100n < targetHundredths * financingAt(p, f, bump).annualDebtService) p -= 100000n;
  return p;
}

function lbo(c, n, price, exitBps, withSyn = false) {
  const f = n.financing, v = n.valuation, fin = financingAt(price, f);
  const sba = amortizeByYear(fin.sba, f.sba_rate_bps, f.sba_term_months, 5), note = amortizeByYear(fin.sellerNote, f.seller_note_rate_bps, f.seller_note_term_months, 5);
  const proj = projections(c, n, withSyn);
  const equity0 = fin.down + fin.closingCosts;
  const years = proj.map((p, i) => {
    const interest = sba.years[i].interest + note.years[i].interest, principal = sba.years[i].principal + note.years[i].principal;
    const tax = applyBps(max0(p.ebit - interest - p.integration), v.tax_rate_bps);
    const cashToEquity = p.ebitda - p.capex - p.nwc - tax - interest - principal - p.integration;
    const dscr = interest + principal > 0n ? ratio4(p.ebitda - p.capex, interest + principal) : null;
    return {year: p.year, revenue: p.revenue, ebitda: p.ebitda, capex: p.capex, nwc: p.nwc, interest, principal, tax, cashToEquity, dscr,
      debtBalance: sba.years[i].balance + note.years[i].balance};
  });
  const sde5 = years[4].ebitda + c.managerSalary;
  const exitValue = applyBps(sde5, Number(exitBps)), exitEquity = exitValue - years[4].debtBalance;
  const flows = [-equity0, ...years.map((y, i) => y.cashToEquity + (i === 4 ? exitEquity : 0n))];
  const totalBack = flows.slice(1).reduce((s, x) => s + x, 0n);
  return {sources: {buyerEquity: fin.down, sellerNote: fin.sellerNote, sbaLoan: fin.sba, closingCosts: fin.closingCosts, totalUses: price + fin.closingCosts},
    equityInvested: equity0, years, exitMultiple: fmtMultiple(BigInt(exitBps)), exitSde: sde5, exitValue, exitEquity, irr: irr(flows),
    moic: equity0 > 0n ? ratio4(totalBack, equity0) : null, minDscr: Math.min(...years.map(y => y.dscr ?? Infinity))};
}
function lboMaxPrice(c, n, exitBps, targetBps, cap) {
  let lo = 0n, hi = cap;
  const ok = p => lbo(c, n, p, exitBps).irr * 10000 >= targetBps;
  if (!ok(100000n)) return 0n;
  if (ok(hi)) return hi;
  while (hi - lo > 100000n) { const mid = roundDownThousand((lo + hi) / 2n); if (ok(mid)) lo = mid; else hi = mid; }
  return lo;
}
const finiteOr = (x, alt = null) => (Number.isFinite(x) ? x : alt);

function runCase(label, c, n, fx, detailed) {
  if (c.sde === null || c.revenue === null) return null;
  const out = {label, revenue: c.revenue, sde: c.sde, ebitda: c.ebitda, da: c.da};
  const v = n.valuation, exitBps = fx.prec ? fx.prec.stats.median : 30000n;
  out.dcf = dcf(c, n, {exitBps});
  out.dcfRange = {low: dcf(c, n, {rateShift: 200}).enterpriseValue, mid: out.dcf.enterpriseValue, high: dcf(c, n, {rateShift: -200}).enterpriseValue};
  if (detailed) {
    const rates = [-200, -100, 0, 100, 200], gs = [-100, -50, 0, 50, 100];
    out.dcfGrid = {rates: rates.map(d => n.discountBps + d), growths: gs.map(d => v.terminal_growth_bps + d),
      values: gs.map(dg => rates.map(dr => (n.discountBps + dr - (v.terminal_growth_bps + dg) >= 200 ? dcf(c, n, {rateShift: dr, growthShift: dg}).enterpriseValue : null)))};
  }
  if (fx.sector && c.ebitda > 0n) {
    const m = fx.sector.multiple; // hundredths
    const at = d => divideRound(c.ebitda * m * BigInt(10000 - d), 1000000n);
    const midDisc = Math.round((v.comps_discount_low_bps + v.comps_discount_high_bps) / 2);
    out.comps = {publicMultiple: fmtMultiple(m * 100n), discountRange: `${v.comps_discount_low_bps / 100}%-${v.comps_discount_high_bps / 100}%`,
      appliedLow: fmtMultiple((m * BigInt(10000 - v.comps_discount_high_bps)) / 100n), appliedHigh: fmtMultiple((m * BigInt(10000 - v.comps_discount_low_bps)) / 100n),
      low: at(v.comps_discount_high_bps), mid: at(midDisc), high: at(v.comps_discount_low_bps)};
  }
  if (fx.prec) {
    const k = fx.prec.stats;
    out.precedents = {low: roundDownThousand(applyBps(c.sde, Number(k.q1))), mid: roundDownThousand(applyBps(c.sde, Number(k.median))), high: roundDownThousand(applyBps(c.sde, Number(k.q3)))};
  }
  const f = n.financing, available = c.ebitda - applyBps(c.revenue, v.capex_bps);
  const atAsk = financingAt(n.target.asking, f), stressed = financingAt(n.target.asking, f, f.stress_bps);
  out.financing = {cashAvailableForDebt: available, atAsking: atAsk, dscrAtAsking: atAsk.annualDebtService > 0n ? ratio4(available, atAsk.annualDebtService) : null,
    dscrStressed: stressed.annualDebtService > 0n ? ratio4(available, stressed.annualDebtService) : null, stressedDebtService: stressed.annualDebtService,
    maxPriceTarget: maxPriceForDscr(available, f, f.target_dscr), maxPriceSbaMin: maxPriceForDscr(available, f, f.sba_min_dscr),
    maxPriceStressed: maxPriceForDscr(available, f, f.target_dscr, f.stress_bps)};
  const cap = n.target.asking * 4n;
  out.lbo = lbo(c, n, n.target.asking, exitBps);
  out.lboRange = {low: lboMaxPrice(c, n, exitBps, v.target_irr_bps + 500, cap), mid: lboMaxPrice(c, n, exitBps, v.target_irr_bps, cap), high: lboMaxPrice(c, n, exitBps, v.target_irr_bps - 500, cap)};
  if (detailed) {
    const prices = [8000, 9000, 10000, 11000, 12000].map(p => roundDownThousand(applyBps(n.target.asking, p)));
    const exits = [-10000, -5000, 0, 5000, 10000].map(d => exitBps + BigInt(d)).filter(e => e > 0n);
    out.lboGrid = {prices, exits: exits.map(e => fmtMultiple(e)), irr: exits.map(e => prices.map(p => finiteOr(lbo(c, n, p, e).irr)))};
  }
  return out;
}

// ---------- Main ----------
export function analyzeDeal(deal, {precedentsCsv, sectorCsv}) {
  const n = normalize(deal);
  const {target: T, buyer: B} = n;
  const findings = [], missingInputs = [], askList = [];
  const ask = q => { if (q && !askList.includes(q)) askList.push(q); };
  const add = (rule, severity, area, title, detail, impact, evidence) => findings.push({rule, severity, area, title, detail, impactUsd: impact == null ? null : amount(abs(impact)), _i: impact == null ? 0n : abs(impact), evidence, method: 'deterministic'});
  const fin = T.financials, P = fin[fin.length - 1].period, cur = fin[fin.length - 1];
  const ev = (row, k) => ({field: `target.financials[${row.period}].${k}`, document: T.sources[k.startsWith('claimed') ? 'claim' : k.startsWith('pnl') ? 'pnl' : k.startsWith('tax') ? 'tax' : k === 'bank_deposits' ? 'bank' : 'pnl'], value: row[k] === null ? null : amount(row[k])});

  // 1. Seller claims vs documents
  const reconciliation = fin.map(r => ({period: r.period, sellerClaim: r.claimed_revenue && amount(r.claimed_revenue), pnl: r.pnl_revenue && amount(r.pnl_revenue), taxReturn: r.tax_revenue && amount(r.tax_revenue), bankDeposits: r.bank_deposits && amount(r.bank_deposits)}));
  for (const r of fin) {
    const claim = r.claimed_revenue, tax = r.tax_revenue, bank = r.bank_deposits;
    if (claim !== null && tax === null) { add('missing_tax_support', r === cur ? 'high' : 'medium', 'Earnings', `No tax return revenue for ${r.period}`, `The seller claims ${usd(claim)} but no tax return figure was entered to check it.`, null, [ev(r, 'claimed_revenue')]); missingInputs.push(`Tax return revenue for ${r.period}`); ask(`Please send your ${r.period} business tax return.`); }
    if (claim !== null && tax !== null && tax > 0n) {
      const d = claim - tax;
      const sev = abs(d) * 10000n > 500n * tax ? 'high' : abs(d) * 10000n > 200n * tax ? 'medium' : null;
      if (sev) { add('claim_vs_tax_revenue', sev, 'Earnings', `${r.period} revenue claim is ${pctStr(abs(d), tax)} ${d > 0n ? 'above' : 'below'} the tax return`, `Seller says ${usd(claim)}; the tax return shows ${usd(tax)}. Lenders underwrite to the tax return.`, d, [ev(r, 'claimed_revenue'), ev(r, 'tax_revenue')]); ask(`Why does ${r.period} revenue in your listing (${usd(claim)}) differ from the tax return (${usd(tax)})?`); }
    }
    if (bank !== null && tax !== null && tax > 0n) {
      const d = tax - bank;
      if (d * 10000n > 500n * tax) { add('deposits_below_revenue', 'high', 'Earnings', `${r.period} bank deposits are ${pctStr(d, tax)} below reported revenue`, `Tax return revenue ${usd(tax)} vs. deposits ${usd(bank)}. Revenue that never reached the bank needs an explanation.`, d, [ev(r, 'tax_revenue'), ev(r, 'bank_deposits')]); ask(`Can you reconcile ${r.period} bank deposits to reported revenue, month by month?`); }
      else if (-d * 10000n > 1000n * tax) { add('deposits_above_revenue', 'medium', 'Earnings', `${r.period} deposits exceed reported revenue by ${pctStr(-d, tax)}`, 'Could be loans, transfers or unreported sales. Ask for a deposit breakdown.', d, [ev(r, 'tax_revenue'), ev(r, 'bank_deposits')]); ask(`What explains ${r.period} deposits above reported revenue (loans, transfers, other)?`); }
    }
  }
  if (cur.bank_deposits === null) { add('missing_bank_support', 'medium', 'Earnings', `No bank deposits entered for ${P}`, 'Bank deposits are the independent check on revenue. Request 12 months of statements.', null, []); missingInputs.push(`Bank deposits for ${P}`); ask(`Please send all 12 monthly business bank statements for ${P}.`); }
  if (cur.pnl_net_income !== null && cur.tax_net_income !== null && abs(cur.pnl_net_income - cur.tax_net_income) * 10000n > 500n * (abs(cur.tax_net_income) || 1n))
    add('pnl_vs_tax_profit', 'medium', 'Earnings', `${P} P&L profit differs from the tax return`, `P&L ${usd(cur.pnl_net_income)} vs. tax return ${usd(cur.tax_net_income)}. Verified earnings start from the tax return.`, cur.pnl_net_income - cur.tax_net_income, [ev(cur, 'pnl_net_income'), ev(cur, 'tax_net_income')]);
  const revOf = r => (r.tax_revenue ?? r.claimed_revenue ?? r.pnl_revenue);
  if (fin.length > 1) { const prev = fin[fin.length - 2], a = revOf(prev), b = revOf(cur); if (a && b && (a - b) * 10000n > 1000n * a) add('revenue_decline', 'medium', 'Earnings', `Revenue fell ${pctStr(a - b, a)} year over year`, `${prev.period} ${usd(a)} to ${P} ${usd(b)}.`, a - b, [ev(prev, 'tax_revenue'), ev(cur, 'tax_revenue')]); }
  const baseRev = revOf(cur);
  if (cur.top_customer_revenue !== null && baseRev) {
    const s = cur.top_customer_revenue * 100n;
    if (s > 35n * baseRev) { add('customer_concentration', 'high', 'Fit & risk', `Largest customer is ${pctStr(cur.top_customer_revenue, baseRev)} of revenue`, 'Losing one customer after closing would break the loan math.', null, [ev(cur, 'top_customer_revenue')]); ask('Can we speak with your largest customer before closing, and what are their contract terms?'); }
    else if (s > 20n * baseRev) { add('customer_concentration', 'medium', 'Fit & risk', `Largest customer is ${pctStr(cur.top_customer_revenue, baseRev)} of revenue`, "Confirm that customer's contract is signed and transfers to you.", null, [ev(cur, 'top_customer_revenue')]); ask("What are your largest customer's contract terms, and does it transfer to a new owner?"); }
  }

  // 2. Earnings bridge
  const claimedSde = cur.claimed_sde;
  let base = cur.tax_net_income, baseLabel = `Net income per tax return (${P})`, baseKey = 'tax_net_income';
  if (base === null && cur.pnl_net_income !== null) { base = cur.pnl_net_income; baseKey = 'pnl_net_income'; baseLabel = `Net income per seller P&L (${P}), NOT tax-verified`; add('unverified_base', 'high', 'Earnings', 'Verified earnings start from an unverified P&L', `No ${P} tax return profit was entered.`, null, [ev(cur, 'pnl_net_income')]); missingInputs.push(`Tax return net income for ${P}`); }
  const bridge = []; let verifiedSde = null, daFromAddbacks = 0n;
  if (base !== null) {
    verifiedSde = base;
    bridge.push({label: baseLabel, claimed: amount(base), verified: amount(base), decision: 'base', reason: 'Starting point', evidence: [ev(cur, baseKey)]});
    const owner = new Set();
    for (const a of T.addbacks.filter(x => x.period === P)) {
      const [decision, accepted, reason] = decideAddback(a, T.addbacks, owner);
      verifiedSde += accepted;
      if (['depreciation', 'amortization'].includes(a.category)) daFromAddbacks += accepted;
      const e = [{field: `target.addbacks[${a.i}]`, document: a.source || 'Seller add-back schedule', value: amount(a.amount)}];
      bridge.push({label: a.description, category: ADDBACK_CATEGORIES[a.category], claimed: amount(a.amount), verified: amount(accepted), decision, reason, evidence: e});
      const removed = a.amount - accepted;
      if (removed > 0n) { add('addback_' + decision, removed * 100n >= 5n * (claimedSde ?? verifiedSde) ? 'high' : 'medium', 'Earnings', `Add-back ${decision}: ${a.description}`, `${reason}. Removes ${usd(removed)} from earnings.`, removed, e); ask(`Can you provide documentation for "${a.description}" for every year it appears?`); }
    }
    if (!T.addbacks.length) { add('no_addbacks', 'medium', 'Earnings', 'No add-back schedule entered', "The seller's earnings claim cannot be tested line by line.", null, []); missingInputs.push('Add-back schedule'); ask('Please send your add-back (SDE recast) schedule with support for each line.'); }
  } else { add('no_earnings', 'high', 'Earnings', `No ${P} profit from any document`, 'Enter tax return or P&L net income. Valuation cannot run.', null, []); missingInputs.push(`Net income for ${P}`); }
  if (claimedSde !== null && verifiedSde !== null) {
    const gap = claimedSde - verifiedSde;
    if (gap * 10000n > 500n * claimedSde) add('sde_overstated', 'high', 'Earnings', `Seller's earnings claim is ${pctStr(gap, claimedSde)} higher than the documents support`, `Claimed ${usd(claimedSde)} vs. verified ${usd(verifiedSde)}. Every valuation changes because of this gap.`, gap, [ev(cur, 'claimed_sde')]);
    else if (gap * 10000n > 200n * claimedSde) add('sde_overstated', 'medium', 'Earnings', `Seller's earnings claim is ${pctStr(gap, claimedSde)} above verified`, `Claimed ${usd(claimedSde)} vs. verified ${usd(verifiedSde)}.`, gap, [ev(cur, 'claimed_sde')]);
  }
  if (claimedSde === null) missingInputs.push(`Seller's claimed SDE for ${P}`);
  // D&A for the DCF: entered, else documented depreciation/amortization add-backs, else equal to capex
  const capex0 = baseRev ? applyBps(baseRev, n.valuation.capex_bps) : 0n;
  const da0 = T.da ?? (daFromAddbacks > 0n ? daFromAddbacks : capex0);
  const daSource = T.da !== null ? 'entered' : daFromAddbacks > 0n ? 'from documented depreciation add-backs' : 'assumed equal to capex';
  if (T.da === null) n.assumptions.push(`D&A ${usd(da0)} (${daSource})`);

  // 3. Fit & risk scorecard
  let score = 100;
  const scorecard = QUESTIONS.map(Q => {
    const v = T.qualitative[Q.id];
    let hit = v === null ? ['medium', 'Not answered yet'] : Q.type === 'number' ? Q.rule(v) : Q.options[v];
    let flag = 'ok';
    if (hit) {
      flag = hit[0];
      if (flag === 'strength') score += 3;
      if (flag === 'high' || flag === 'medium') {
        const fitWatch = Q.group === 'fit' && flag === 'medium';
        score -= flag === 'high' ? 12 : fitWatch ? 3 : 5;
        add('fit_' + Q.id, fitWatch ? 'low' : flag, 'Fit & risk', hit[1], Q.why, null, [{field: `target.qualitative.${Q.id}`, document: 'Buyer questionnaire', value: v === null ? 'not answered' : String(v)}]);
        if (v !== null) ask(hit[2]);
      }
    }
    return {id: Q.id, group: Q.group, question: Q.label, answer: v, flag, label: flag === 'strength' ? 'Strength' : flag === 'high' ? 'Risk' : flag === 'medium' ? 'Watch' : 'Neutral', note: hit ? hit[1] : 'No concern'};
  });
  score = Math.max(0, Math.min(100, score));
  const qualBand = score >= 75 ? 'Low risk' : score >= 50 ? 'Moderate risk' : 'High risk';

  // 4. Market data for this industry
  const precRows = loadPrecedents(precedentsCsv).filter(r => r.industry === T.industry && r.sde > 0n);
  const sectors = loadSectorMultiples(sectorCsv);
  const fx = {prec: precRows.length >= 3 ? {rows: precRows, stats: quartiles(sortBig(precRows.map(r => multipleBps(r.price, r.sde))))} : null, sector: sectors[T.industry] || null};
  if (!fx.prec) { add('few_precedents', 'low', 'Valuation', `Fewer than 3 precedent sales for "${T.industry}"`, 'Precedent method skipped; LBO exit uses a 3.0x default.', null, []); missingInputs.push(`Precedents for ${T.industry}`); }
  if (!fx.sector) { add('no_sector_multiple', 'low', 'Valuation', `No public sector multiple mapped for "${T.industry}"`, 'Comps method skipped.', null, []); missingInputs.push(`Public sector multiple for ${T.industry}`); }

  // 5. Models on verified and claimed earnings
  const verifiedRevenue = cur.tax_revenue ?? cur.pnl_revenue ?? cur.claimed_revenue;
  const claimedRevenue = cur.claimed_revenue ?? cur.pnl_revenue ?? cur.tax_revenue;
  const caseOf = (rev, sde) => (sde === null || rev === null ? {revenue: null, sde: null} : {revenue: rev, sde, ebitda: sde - T.managerSalary, managerSalary: T.managerSalary, da: da0});
  const vCase = caseOf(verifiedRevenue, verifiedSde);
  const verified = runCase('Verified', vCase, n, fx, true);
  const claimed = runCase("Seller's numbers", caseOf(claimedRevenue, claimedSde), n, fx, false);

  // 6. Synergies and combined company
  let synergy = null, combined = null;
  if (verified) {
    const withSyn = dcf(vCase, n, {withSyn: true});
    const exitBps = fx.prec ? fx.prec.stats.median : 30000n;
    const lboSyn = lbo(vCase, n, T.asking, exitBps, true);
    const items = synergyItems(n, vCase);
    const keptTotal = items.reduce((s, x) => s + x.kept, 0n);
    synergy = {items: items.map(x => ({type: x.type, description: x.description, entered: amount(x.amount), ebitdaImpact: amount(x.ebitdaImpact), kept: amount(x.kept)})),
      enteredEbitdaTotal: amount(items.reduce((s, x) => s + x.ebitdaImpact, 0n)), keptTotal: amount(keptTotal), integrationCost: amount(n.synergies.integration_cost_usd),
      byYear: projections(vCase, n, true).map(p => ({year: p.year, synergyEbitda: amount(p.synergyEbitda), integrationCost: amount(p.integration)})),
      dcfStandalone: amount(verified.dcf.enterpriseValue), dcfWithSynergies: amount(withSyn.enterpriseValue), synergyValue: amount(withSyn.enterpriseValue - verified.dcf.enterpriseValue),
      irrStandalone: finiteOr(verified.lbo.irr), irrWithSynergies: finiteOr(lboSyn.irr),
      method: `Cost savings keep ${n.synergies.cost_realization_bps / 100}%. New revenue counts at the target's EBITDA margin, then keeps ${n.synergies.revenue_realization_bps / 100}%. Cost savings: half in year 1. Revenue: phased in over 5 years.`,
      message: 'Synergy value belongs to your company. Pay the seller for standalone value and keep synergies as your margin of safety.'};
    const fin0 = verified.financing.atAsking, y1 = projections(vCase, n, true)[0];
    const newDs = fin0.annualDebtService, totalDs = B.existingDebtService + newDs;
    const globalCash = B.ebitda + verified.ebitda - applyBps(verified.revenue, n.valuation.capex_bps);
    const newDebt = fin0.sba + fin0.sellerNote, proEbitda = B.ebitda + vCase.ebitda;
    combined = {buyerRevenue: amount(B.revenue), targetRevenue: amount(verifiedRevenue), proFormaRevenueYear1: amount(B.revenue + y1.revenue),
      buyerEbitda: amount(B.ebitda), targetEbitda: amount(verified.ebitda), synergyEbitdaYear1: amount(y1.synergyEbitda), proFormaEbitdaYear1: amount(B.ebitda + y1.ebitda),
      buyerMargin: B.revenue > 0n ? ratio4(B.ebitda, B.revenue) : null, targetMargin: verifiedRevenue > 0n ? ratio4(vCase.ebitda, verifiedRevenue) : null, combinedMargin: ratio4(proEbitda, B.revenue + verifiedRevenue),
      ebitdaAccretion: B.ebitda > 0n ? ratio4(vCase.ebitda + y1.synergyEbitda, B.ebitda) : null,
      buyerDebt: amount(B.existingDebt), newDebt: amount(newDebt), debtToEbitdaBefore: B.ebitda > 0n ? ratio4(B.existingDebt, B.ebitda) : null, debtToEbitdaAfter: proEbitda > 0n ? ratio4(B.existingDebt + newDebt, proEbitda) : null,
      existingDebtService: amount(B.existingDebtService), newDebtService: amount(newDs), globalDscr: totalDs > 0n ? ratio4(globalCash, totalDs) : null,
      cashNeededAtClose: amount(fin0.down + fin0.closingCosts), buyerCash: amount(B.cash), cashAfterClose: amount(B.cash - fin0.down - fin0.closingCosts)};
    const need = fin0.down + fin0.closingCosts;
    if (B.cash < need) add('buyer_cash_short', 'high', 'Financing', `Your company is ${usd(need - B.cash)} short of the cash needed at closing`, `Down payment plus closing costs ${usd(need)} vs. cash available ${usd(B.cash)}.`, need - B.cash, [{field: 'buyer.cash_available_usd', document: 'Your company profile', value: amount(B.cash)}]);
    const f = verified.financing, tgt = n.financing.target_dscr, flo = n.financing.sba_min_dscr;
    const e = [{field: 'target.asking_price_usd', document: 'Deal terms', value: amount(T.asking)}];
    if (f.cashAvailableForDebt <= 0n) add('no_cash_for_debt', 'high', 'Financing', 'Verified earnings cannot cover a manager salary and loan payments', `After a ${usd(T.managerSalary)} manager salary and capex, ${usd(f.cashAvailableForDebt)} is left.`, f.cashAvailableForDebt, e);
    else if (f.cashAvailableForDebt * 100n < flo * f.atAsking.annualDebtService) add('dscr_below_sba_min', 'high', 'Financing', `On its own, the target covers its loan payments only ${f.dscrAtAsking.toFixed(2)}x`, `Below the SBA ${amount(flo)}x minimum. Lenders would need your company's cash flow to support it.`, T.asking - f.maxPriceSbaMin, e);
    else if (f.cashAvailableForDebt * 100n < tgt * f.atAsking.annualDebtService) add('dscr_below_target', 'medium', 'Financing', `Target covers its loan payments ${f.dscrAtAsking.toFixed(2)}x, below the ${amount(tgt)}x target`, `The price a ${amount(tgt)}x coverage supports is ${usd(f.maxPriceTarget)}.`, T.asking - f.maxPriceTarget, e);
    if (f.cashAvailableForDebt > 0n && f.dscrStressed !== null && f.cashAvailableForDebt * 100n < flo * f.stressedDebtService && f.cashAvailableForDebt * 100n >= flo * f.atAsking.annualDebtService)
      add('fails_rate_stress', 'medium', 'Financing', `A +${n.financing.stress_bps / 100}% rate rise drops coverage to ${f.dscrStressed.toFixed(2)}x`, 'SBA loans are usually variable rate.', null, e);
    if (combined.globalDscr !== null && combined.globalDscr < Number(amount(flo))) add('global_dscr_low', 'high', 'Financing', `Combined company covers all debt only ${combined.globalDscr.toFixed(2)}x`, "Even with your company's cash flow, the debt load is too heavy.", null, e);
    if (verified.lbo.irr * 10000 < n.valuation.target_irr_bps) add('irr_below_target', 'medium', 'Valuation', `At the asking price your return is ${(verified.lbo.irr * 100).toFixed(1)}%, below your ${n.valuation.target_irr_bps / 100}% target`, `The most you can pay and still earn ${n.valuation.target_irr_bps / 100}% is ${usd(verified.lboRange.mid)}.`, T.asking - verified.lboRange.mid, e);
    if (fx.prec) { const m = multipleBps(T.asking, verifiedSde), k = fx.prec.stats, pe = [{field: 'precedents', document: 'DealSpan precedents database (synthetic)', value: fx.prec.rows.map(r => r.id).join(', ')}]; if (m > k.max) add('above_all_precedents', 'high', 'Valuation', `Asking price is ${fmtMultiple(m)} verified earnings, above every comparable sale`, `Comparable sales ranged ${fmtMultiple(k.min)}-${fmtMultiple(k.max)}.`, T.asking - verified.precedents.mid, pe); else if (m > k.q3) add('above_q3_precedents', 'medium', 'Valuation', `Asking price is ${fmtMultiple(m)} verified earnings, in the top quarter of comparable sales`, `Median ${fmtMultiple(k.median)}.`, T.asking - verified.precedents.mid, pe); }
  }

  // 7. Football field (verified bars, claimed midpoints for contrast)
  const bar = (method, vr, cl) => (vr ? {method, low: amount(vr.low), mid: amount(vr.mid), high: amount(vr.high), sellerMid: cl ? amount(cl.mid) : null} : null);
  const football = verified ? [
    bar('DCF (discount rate ±2 pts)', verified.dcfRange, claimed?.dcfRange),
    bar(`LBO (IRR ${n.valuation.target_irr_bps / 100 + 5}% to ${n.valuation.target_irr_bps / 100 - 5}%)`, verified.lboRange, claimed?.lboRange),
    bar('Public comps (size-discounted)', verified.comps, claimed?.comps),
    bar('Precedent sales (Q1 to Q3)', verified.precedents, claimed?.precedents),
    bar(`SBA loan capacity (${amount(n.financing.target_dscr)}x-${amount(n.financing.sba_min_dscr)}x)`, {low: verified.financing.maxPriceStressed, mid: verified.financing.maxPriceTarget, high: verified.financing.maxPriceSbaMin}, claimed && {mid: claimed.financing.maxPriceTarget})
  ].filter(Boolean) : [];

  // 8. Recommendation
  findings.sort((a, b) => SEV[b.severity] - SEV[a.severity] || (b._i > a._i ? 1 : b._i < a._i ? -1 : 0) || a.rule.localeCompare(b.rule));
  findings.forEach((f, i) => { f.rank = i + 1; delete f._i; });
  const highs = findings.filter(f => f.severity === 'high');
  let verdict, offer = null, cappedBy = null; const reasons = [];
  if (!verified) { verdict = 'INCOMPLETE'; reasons.push('Earnings could not be verified from the information entered.'); }
  else {
    const caps = [['asking price', T.asking], [`max price at ${amount(n.financing.target_dscr)}x loan coverage`, verified.financing.maxPriceTarget], [`max price for a ${n.valuation.target_irr_bps / 100}% return`, verified.lboRange.mid]];
    if (verified.precedents) caps.push(['median comparable sale', verified.precedents.mid]);
    [cappedBy, offer] = caps.reduce((m, c) => (c[1] < m[1] ? c : m));
    reasons.push(`Supportable price is set by the ${cappedBy}: ${usd(offer)}.`);
    if (offer * 10n < T.asking * 6n) { verdict = 'WALK'; reasons.push(`That is ${pctStr(offer, T.asking)} of the asking price. A gap this large rarely closes.`); }
    else if (offer < T.asking || highs.length || score < 50) { verdict = 'NEGOTIATE'; if (offer < T.asking) reasons.push(`Offer around ${usd(offer)}, ${pctStr(T.asking - offer, T.asking)} below asking.`); if (highs.length) reasons.push(`${highs.length} high-severity issue(s) to resolve before signing.`); }
    else { verdict = 'PROCEED'; reasons.push('Earnings tie out, the price is financeable and the return meets your target. Move to formal QoE and legal diligence.'); }
    if (claimedSde !== null && verifiedSde !== null && (claimedSde - verifiedSde) * 50n > claimedSde && fx.prec) reasons.push(`Paying the median multiple on the seller's number would overpay by ${usd(applyBps(claimedSde - verifiedSde, Number(fx.prec.stats.median)))}.`);
  }
  const headline = {PROCEED: 'Proceed to full diligence', NEGOTIATE: `Negotiate: offer about ${offer !== null ? usd(offer) : ''}`, WALK: 'Walk away unless the seller can explain the gaps', INCOMPLETE: 'Not enough verified information yet'}[verdict];

  // Why this deal (rule-based from fit answers + user's own words)
  const why = [];
  if (T.whyThisDeal) why.push(T.whyThisDeal);
  const qa = T.qualitative;
  if (qa.offering_overlap === 'same' && qa.geography === 'next_door') why.push('Same business in a next-door market: shared equipment and back office, plus new territory.');
  else if (qa.offering_overlap === 'complementary') why.push('Complementary services you can sell to each other\'s customers.');
  if (qa.cross_sell === 'high') why.push('Each company can sell to the other\'s customers.');
  if (combined && combined.targetMargin !== null && combined.buyerMargin !== null && combined.targetMargin > combined.buyerMargin) why.push(`${T.name.replace(/\s*\(FICTIONAL\)/, '')} runs at a higher margin than you do, so the deal lifts your blended margin.`);

  const S = x => (x === null || x === undefined ? null : typeof x === 'bigint' ? amount(x) : x);
  const caseOut = c => c && ({
    label: c.label, revenue: S(c.revenue), sde: S(c.sde), ebitda: S(c.ebitda), da: S(c.da),
    dcf: {discountRate: (c.dcf.discountRateBps / 100).toFixed(1) + '%', enterpriseValue: S(c.dcf.enterpriseValue), pvForecast: S(c.dcf.pvForecast), terminalValue: S(c.dcf.terminalValue), pvTerminal: S(c.dcf.pvTerminal),
      terminalShare: c.dcf.terminalShareBps === null ? null : c.dcf.terminalShareBps / 10000,
      exitMethod: c.dcf.exitMethod ? {multiple: c.dcf.exitMethod.multiple, terminalValue: S(c.dcf.exitMethod.terminalValue), pvTerminal: S(c.dcf.exitMethod.pvTerminal), enterpriseValue: S(c.dcf.exitMethod.enterpriseValue)} : null,
      years: c.dcf.years.map(y => ({year: y.year, revenue: S(y.revenue), ebitda: S(y.ebitda), da: S(y.da), ebit: S(y.ebit), capex: S(y.capex), nwc: S(y.nwc), tax: S(y.tax), fcf: S(y.fcf), pv: S(y.pv)})),
      range: {low: S(c.dcfRange.low), mid: S(c.dcfRange.mid), high: S(c.dcfRange.high)},
      grid: c.dcfGrid ? {rates: c.dcfGrid.rates.map(x => x / 10000), growths: c.dcfGrid.growths.map(x => x / 10000), values: c.dcfGrid.values.map(r => r.map(S))} : null},
    lbo: {sources: Object.fromEntries(Object.entries(c.lbo.sources).map(([k, v]) => [k, S(v)])), equityInvested: S(c.lbo.equityInvested), irr: finiteOr(c.lbo.irr), moic: c.lbo.moic, minDscr: finiteOr(c.lbo.minDscr),
      exitMultiple: c.lbo.exitMultiple, exitSde: S(c.lbo.exitSde), exitValue: S(c.lbo.exitValue), exitEquity: S(c.lbo.exitEquity),
      years: c.lbo.years.map(y => Object.fromEntries(Object.entries(y).map(([k, v]) => [k, S(v)]))), priceForTargetIrr: {low: S(c.lboRange.low), mid: S(c.lboRange.mid), high: S(c.lboRange.high)},
      grid: c.lboGrid ? {prices: c.lboGrid.prices.map(S), exits: c.lboGrid.exits, irr: c.lboGrid.irr} : null},
    comps: c.comps ? {...c.comps, low: S(c.comps.low), mid: S(c.comps.mid), high: S(c.comps.high)} : null,
    precedents: c.precedents ? {low: S(c.precedents.low), mid: S(c.precedents.mid), high: S(c.precedents.high)} : null,
    financing: {cashAvailableForDebt: S(c.financing.cashAvailableForDebt), downPayment: S(c.financing.atAsking.down), sellerNote: S(c.financing.atAsking.sellerNote), sbaLoan: S(c.financing.atAsking.sba), closingCosts: S(c.financing.atAsking.closingCosts),
      annualDebtService: S(c.financing.atAsking.annualDebtService), dscrAtAsking: c.financing.dscrAtAsking, dscrStressed: c.financing.dscrStressed,
      maxPriceTargetDscr: S(c.financing.maxPriceTarget), maxPriceSbaMinimum: S(c.financing.maxPriceSbaMin), maxPriceStressed: S(c.financing.maxPriceStressed)}
  });

  return {
    product: 'DealSpan', currency: 'USD', units: 'USD strings with cents; ratios are decimals', analysisPeriod: P,
    buyer: {name: B.name, industry: B.industry}, target: {name: T.name, industry: T.industry, location: T.location, askingPrice: amount(T.asking), managerSalary: amount(T.managerSalary), daSource},
    recommendation: {verdict, headline, askingPrice: amount(T.asking), suggestedOffer: offer === null ? null : amount(offer), cappedBy, reasons, qualitativeScore: score, qualitativeBand: qualBand},
    whyThisDeal: why, sellerQuestions: askList,
    earnings: {claimedSde: S(claimedSde), verifiedSde: S(verifiedSde), gap: claimedSde !== null && verifiedSde !== null ? amount(claimedSde - verifiedSde) : null,
      overpayAtMedian: claimedSde !== null && verifiedSde !== null && fx.prec && claimedSde > verifiedSde ? amount(applyBps(claimedSde - verifiedSde, Number(fx.prec.stats.median))) : null, managerSalary: amount(T.managerSalary), bridge},
    reconciliation, scorecard, qualitative: scorecard, football, verified: caseOut(verified), claimed: caseOut(claimed), synergy, combined,
    marketData: {
      precedents: fx.prec ? {count: fx.prec.rows.length, min: fmtMultiple(fx.prec.stats.min), q1: fmtMultiple(fx.prec.stats.q1), median: fmtMultiple(fx.prec.stats.median), q3: fmtMultiple(fx.prec.stats.q3), max: fmtMultiple(fx.prec.stats.max), basis: 'Sale price / SDE', ids: fx.prec.rows.map(r => r.id), source: 'Team-authored synthetic small-business sales (demo only)'} : null,
      comps: fx.sector ? {sector: fx.sector.sector, multiple: fmtMultiple(fx.sector.multiple * 100n), firms: fx.sector.firms, asOf: fx.sector.asOf, url: fx.sector.url, basis: 'EV / EBITDA, US public companies with positive EBITDA', source: `Damodaran, EV/EBITDA by sector (US), ${fx.sector.asOf}`} : null,
      note: 'Public multiples are real (Damodaran, cited). Precedent small-business sales are team-authored synthetic data for the demo.'
    },
    settings: {discountRateBps: n.discountBps, terminalGrowthBps: n.valuation.terminal_growth_bps, targetIrrBps: n.valuation.target_irr_bps, targetDscr: amount(n.financing.target_dscr), sbaMinDscr: amount(n.financing.sba_min_dscr), stressBps: n.financing.stress_bps, taxRateBps: n.valuation.tax_rate_bps},
    findings, counts: {high: highs.length, medium: findings.filter(f => f.severity === 'medium').length, low: findings.filter(f => f.severity === 'low').length},
    missingInputs,
    assumptions: [...n.assumptions, `Discount rate ${(n.discountBps / 100).toFixed(1)}% = risk-free + equity premium + size premium + company-specific risk`, `EBITDA = SDE minus a ${usd(T.managerSalary)} replacement manager salary`,
      'DCF: EBITDA - D&A = EBIT, tax on EBIT, plus D&A, less capex and working capital; Gordon growth terminal value, with an exit-multiple cross-check',
      'LBO: SBA loan and seller note fully amortizing, 5-year hold, cash flow paid out yearly, exit at the median precedent multiple of year-5 SDE',
      'Add-back rules are a screening heuristic, not a quality-of-earnings report'],
    disclaimer: 'DealSpan is a screening and education tool. It is not a valuation opinion, QoE report, legal review or financial advice. All demo companies are fictional.'
  };
}
