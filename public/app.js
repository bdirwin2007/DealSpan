// DealSpan front end: guided form -> /api/dealspan -> report. No frameworks.
const API = '/api/dealspan';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const money = v => (v == null || v === '' ? '—' : (Number(v) < 0 ? '-$' : '$') + Math.abs(Math.round(Number(v))).toLocaleString('en-US'));
const short = v => { if (v == null) return '—'; const n = Number(v), a = Math.abs(n), s = n < 0 ? '-' : ''; return a >= 1e6 ? s + '$' + (a / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M' : s + '$' + Math.round(a / 1e3) + 'K'; };
const x2 = v => (v == null ? '—' : Number(v).toFixed(2) + 'x');
const pc = v => (v == null ? '—' : (Number(v) * 100).toFixed(1) + '%');
const prettyName = s => String(s || '').replace(/\s*\(FICTIONAL\)/, '');

const STEPS = [
  ['company', 'Your company', 'Who is buying'],
  ['target', 'Target company', 'Who you are buying'],
  ['financials', 'Financials', 'Claims vs. documents'],
  ['addbacks', 'Add-backs', "Seller's adjustments"],
  ['questions', 'Qualitative', 'Risks numbers miss'],
  ['deal', 'Deal & assumptions', 'Financing, valuation, synergies'],
  ['report', 'Report', 'Verified value']
];
const INDUSTRY_LABEL = {landscaping: 'Landscaping', hvac: 'HVAC', restaurant: 'Restaurant', auto_repair: 'Auto repair', commercial_cleaning: 'Commercial cleaning', other: 'Other'};
const FIN_FIELDS = [
  ['claimed_revenue_usd', 'Revenue the seller claims', 'From the listing or CIM'],
  ['tax_revenue_usd', 'Revenue on the tax return', 'Gross receipts line'],
  ['pnl_revenue_usd', 'Revenue on the P&L', "Seller's bookkeeping"],
  ['bank_deposits_usd', 'Total bank deposits', 'Sum of 12 monthly statements'],
  ['tax_net_income_usd', 'Profit on the tax return', 'Can be negative'],
  ['pnl_net_income_usd', 'Profit on the P&L', 'Can be negative'],
  ['claimed_sde_usd', "Seller's claimed SDE", 'Profit + add-backs, as the seller states it'],
  ['top_customer_revenue_usd', 'Revenue from largest customer', 'For concentration risk']
];
const DEAL_FIELDS = {
  financing: [['down_payment_bps', 'Down payment', 'pct', 'SBA acquisitions need at least 10% equity.'], ['seller_note_bps', 'Seller note', 'pct', 'Part of the price the seller lets you pay over time.'],
    ['sba_rate_bps', 'SBA loan rate', 'pct', 'Usually prime plus a spread; variable.'], ['sba_term_months', 'SBA term (months)', 'int', '120 months = 10 years for most acquisitions.'],
    ['seller_note_rate_bps', 'Seller note rate', 'pct', ''], ['seller_note_term_months', 'Seller note term (months)', 'int', ''],
    ['closing_costs_bps', 'Closing costs', 'pct', 'Legal, SBA fees, accounting.'], ['target_dscr', 'Target loan coverage (DSCR)', 'dec', 'Cash available ÷ loan payments. Lenders like 1.25x+.'],
    ['sba_min_dscr', 'SBA minimum coverage', 'dec', ''], ['stress_bps', 'Rate stress test', 'pct', 'How much higher rates could go.']],
  valuation: [['growth_bps', 'Revenue growth per year', 'pct', 'Use the recent trend, not hope.'], ['terminal_growth_bps', 'Long-term growth', 'pct', 'Growth after year 5, usually 2-3%.'],
    ['tax_rate_bps', 'Tax rate', 'pct', ''], ['capex_bps', 'Capex (% of revenue)', 'pct', 'Spending to replace equipment and trucks.'], ['nwc_bps', 'Working capital (% of new revenue)', 'pct', 'Cash tied up as the business grows.'],
    ['risk_free_bps', 'Risk-free rate', 'pct', 'DCF discount rate is built from these four.'], ['equity_premium_bps', 'Equity risk premium', 'pct', ''], ['size_premium_bps', 'Small-company premium', 'pct', 'Small businesses are riskier than public ones.'],
    ['specific_risk_bps', 'Company-specific risk', 'pct', 'Raise it for owner dependence or concentration.'], ['comps_size_discount_bps', 'Discount to public comps', 'pct', 'Public companies trade at much higher multiples.'], ['target_irr_bps', 'Your target return (IRR)', 'pct', 'LBO solves for the price that earns this.']],
  synergies: [['cost_savings_usd', 'Annual cost savings', 'usd', 'Shared trucks, insurance, office, purchasing.'], ['revenue_synergy_usd', 'Annual new revenue', 'usd', 'Cross-selling your services to their customers.'],
    ['integration_cost_usd', 'One-time integration cost', 'usd', 'Rebranding, systems, severance.'], ['revenue_realization_bps', 'Revenue synergy realization', 'pct', 'Averages about 77%.'], ['cost_realization_bps', 'Cost savings realization', 'pct', '']]
};

let schema = null, step = 0, report = null, errors = [];
let deal = blankDeal();
function blankDeal() {
  return {buyer: {industry: 'landscaping'}, target: {industry: 'landscaping', financials: [{period: 'FY2023'}, {period: 'FY2024'}, {period: 'FY2025'}], addbacks: [], qualitative: {}, sources: {}}, financing: {}, valuation: {}, synergies: {}};
}

// ---------- state helpers ----------
const getPath = p => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), deal);
function setPath(p, v) {
  const ks = p.split('.'); let o = deal;
  ks.slice(0, -1).forEach((k, i) => { if (o[k] == null) o[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; o = o[k]; });
  const last = ks[ks.length - 1];
  if (v === '' || v === null || v === undefined) delete o[last]; else o[last] = v;
}
const toInput = (kind, v) => (v == null ? '' : kind === 'pct' ? String(Number(v) / 100) : String(v));
const fromInput = (kind, raw) => {
  const t = raw.trim(); if (t === '') return '';
  if (kind === 'pct') { const n = Number(t); return Number.isFinite(n) ? Math.round(n * 100) : t; }
  if (kind === 'int') { const n = Number(t); return Number.isInteger(n) ? n : t; }
  return t.replace(/[$,\s]/g, '');
};
function inp(path, kind = 'text', attrs = '') {
  const v = toInput(kind, getPath(path));
  const box = `<input data-path="${path}" data-kind="${kind}" value="${esc(v)}" ${attrs} ${kind === 'text' ? '' : 'inputmode="decimal"'}>`;
  return kind === 'usd' ? `<div class="money">${box}</div>` : kind === 'pct' ? `<div class="pct">${box}</div>` : box;
}
const field = (label, control, why = '') => `<div class="field"><label>${label}</label>${control}${why ? `<span class="why">${why}</span>` : ''}</div>`;
const sel = (path, opts, labels = {}) => `<select data-path="${path}" data-kind="text">${opts.map(o => `<option value="${o}" ${getPath(path) === o ? 'selected' : ''}>${esc(labels[o] || o)}</option>`).join('')}</select>`;

// ---------- rail ----------
function rail() {
  $('#steps').innerHTML = STEPS.map(([, t, s], i) => `<li class="${i === step ? 'on' : i < step ? 'done' : ''}" data-step="${i}">${i + 1}. ${t}<small>${s}</small></li>`).join('');
}
function go(i) { step = i; rail(); render(); window.scrollTo({top: 0}); if (STEPS[i][0] === 'report') runReport(); }
const nav = (back = true, nextLabel = 'Next') => `<div class="actions noprint">${back && step > 0 ? '<button class="btn ghost" data-go="-1">Back</button>' : '<span></span>'}<button class="btn" data-go="1">${nextLabel}</button></div>`;

// ---------- steps ----------
const views = {
  company: () => `<div class="eyebrow">Step 1</div><h2>Your company</h2><p class="lead">You're a small business buying another one. Your numbers let DealSpan check whether the combined company can carry the new debt.</p>
    <div class="grid">
      ${field('Company name', inp('buyer.name'))}
      ${field('Industry', sel('buyer.industry', schema.industries, INDUSTRY_LABEL))}
      ${field('Annual revenue', inp('buyer.revenue_usd', 'usd'), 'Last full year.')}
      ${field('Annual EBITDA', inp('buyer.ebitda_usd', 'usd'), 'Earnings before interest, taxes, depreciation and amortization.')}
      ${field('Cash available for this deal', inp('buyer.cash_available_usd', 'usd'), 'Covers the down payment and closing costs.')}
      ${field('Current yearly loan payments', inp('buyer.existing_debt_service_usd', 'usd'), 'Principal + interest on debt you already have.')}
    </div>${nav()}`,
  target: () => `<div class="eyebrow">Step 2</div><h2>The company you're buying</h2><p class="lead">The basics, plus the salary of someone to run it day to day. The seller won't be there, so their job has to be paid for.</p>
    <div class="grid">
      ${field('Business name', inp('target.name'))}
      ${field('Industry', sel('target.industry', schema.industries, INDUSTRY_LABEL), 'Picks the comparable sales and public peers.')}
      ${field('Location', inp('target.location'))}
      ${field('Years in business', inp('target.years_in_business', 'int'))}
      ${field('Asking price', inp('target.asking_price_usd', 'usd'))}
      ${field('Salary to replace the owner', inp('target.manager_salary_usd', 'usd'), 'A general manager to do what the seller does today.')}
    </div>
    <h3 class="sub">Where the numbers come from (shown as evidence in the report)</h3>
    <div class="grid">
      ${field("Seller's claims", inp('target.sources.claim', 'text', 'placeholder="Broker listing / CIM"'))}
      ${field('Tax returns', inp('target.sources.tax', 'text', 'placeholder="Form 1120-S"'))}
      ${field('P&L', inp('target.sources.pnl', 'text', 'placeholder="QuickBooks P&L"'))}
      ${field('Bank statements', inp('target.sources.bank', 'text', 'placeholder="Business checking"'))}
    </div>${nav()}`,
  financials: () => {
    const F = deal.target.financials;
    return `<div class="eyebrow">Step 3</div><h2>Financials: what they say vs. what the documents say</h2>
    <p class="lead">Enter each number from the document it came from. Leave a box blank if you don't have that document. DealSpan flags it instead of guessing. The <b>last column</b> is the year we value.</p>
    <div style="overflow-x:auto"><table class="fin"><thead><tr><th>Item</th>${F.map((f, i) => `<th><input data-path="target.financials.${i}.period" data-kind="text" value="${esc(f.period || '')}" style="font-weight:700">${F.length > 1 ? `<button class="x noprint" data-delyear="${i}" title="Remove year">×</button>` : ''}</th>`).join('')}</tr></thead>
    <tbody>${FIN_FIELDS.map(([k, l, h]) => `<tr><td>${l}<small>${h}</small></td>${F.map((_, i) => `<td>${inp(`target.financials.${i}.${k}`, 'usd')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    ${F.length < 5 ? '<p><button class="btn ghost small" data-addyear="1">+ Add an earlier year</button></p>' : ''}${nav()}`;
  },
  addbacks: () => {
    const A = deal.target.addbacks, years = deal.target.financials.map(f => f.period).filter(Boolean);
    return `<div class="eyebrow">Step 4</div><h2>The seller's add-backs</h2>
    <p class="lead">Add-backs are expenses the seller says will disappear after the sale. Enter each one from their schedule, for every year you have, because a "one-time" cost that shows up every year is a red flag.</p>
    <div style="overflow-x:auto"><table><thead><tr><th>Year</th><th>Type</th><th>Description</th><th>Amount</th><th>Receipt / document?</th><th>Will you still need to pay for this work?</th><th>Source</th><th></th></tr></thead><tbody>
    ${A.map((a, i) => `<tr><td>${sel(`target.addbacks.${i}.period`, years)}</td><td>${sel(`target.addbacks.${i}.category`, Object.keys(schema.addbackCategories), schema.addbackCategories)}</td>
      <td>${inp(`target.addbacks.${i}.description`)}</td><td style="min-width:130px">${inp(`target.addbacks.${i}.amount_usd`, 'usd')}</td>
      <td>${sel(`target.addbacks.${i}.documented`, ['yes', 'no'])}</td><td>${sel(`target.addbacks.${i}.buyer_must_replace`, ['no', 'yes'])}</td><td>${inp(`target.addbacks.${i}.source`)}</td>
      <td><button class="x" data-deladd="${i}" title="Remove">×</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">No add-backs yet.</td></tr>'}
    </tbody></table></div><p><button class="btn ghost small" data-addadd="1">+ Add an add-back</button></p>${nav()}`;
  },
  questions: () => `<div class="eyebrow">Step 5</div><h2>The risks numbers don't show</h2><p class="lead">These answers feed a 0-100 qualitative risk score. "Don't know" is a fine answer. It shows up as something to find out.</p>
    ${schema.questions.map(q => `<div class="q"><div><b>${esc(q.label)}</b><small>${esc(q.why)}</small></div><div>${q.type === 'number'
      ? inp(`target.qualitative.${q.id}`, 'int', 'placeholder="Enter a number"')
      : `<div class="choices">${q.options.map(o => `<label><input type="radio" name="${q.id}" data-path="target.qualitative.${q.id}" data-kind="text" value="${o}" ${deal.target.qualitative?.[q.id] === o ? 'checked' : ''}>${esc(o.replace(/_/g, ' ').replace(/^na$/, 'n/a'))}</label>`).join('')}</div>`}</div></div>`).join('')}${nav()}`,
  deal: () => `<div class="eyebrow">Step 6</div><h2>Deal structure and assumptions</h2><p class="lead">Leave any box blank to use the standard assumption shown. Every default used is listed in the report.</p>
    ${Object.entries({financing: 'SBA financing', valuation: 'Valuation (DCF, LBO, comps)', synergies: 'Synergies with your company'}).map(([sec, title]) => `<h3 class="sub">${title}</h3><div class="grid">${DEAL_FIELDS[sec].map(([k, l, kind, why]) => {
      const d = schema.defaults[sec][k][0], ph = kind === 'pct' ? Number(d) / 100 : d;
      return field(l, inp(`${sec}.${k}`, kind === 'dec' ? 'text' : kind, `placeholder="${esc(ph)}"`), why);
    }).join('')}</div>`).join('')}${nav(true, 'Generate report')}`,
  report: () => '<p class="muted">Running the numbers…</p>'
};

function render() {
  const key = STEPS[step][0];
  $('#panel').innerHTML = (errors.length && key !== 'report' ? errBox() : '') + views[key]();
}
function errBox() {
  return `<div class="errs"><b>Please fix ${errors.length} item(s):</b><ul>${errors.map(e => `<li><code>${esc(e.field)}</code> ${esc(e.message)} <a href="#" data-fix="${esc(e.field)}">Go to step</a></li>`).join('')}</ul></div>`;
}
const stepForField = f => (f.startsWith('buyer') ? 0 : f.startsWith('target.financials') ? 2 : f.startsWith('target.addbacks') ? 3 : f.startsWith('target.qualitative') ? 4 : f.startsWith('target') ? 1 : 5);

// ---------- report ----------
async function runReport() {
  const r = await fetch(API + '?action=analyze', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({deal})});
  const j = await r.json();
  if (!r.ok) { errors = j.errors || [{field: 'deal', message: j.error}]; $('#panel').innerHTML = `<div class="eyebrow">Report</div><h2>A few inputs need attention</h2>${errBox()}`; return; }
  errors = []; report = j; $('#panel').innerHTML = reportView(j);
}

function football(r) {
  const rows = r.football, ask = Number(r.recommendation.askingPrice), offer = Number(r.recommendation.suggestedOffer);
  const vals = rows.flatMap(b => [b.low, b.high, b.sellerMid]).map(Number).filter(Number.isFinite).concat([ask]);
  const lo = Math.max(0, Math.min(...vals) * 0.85), hi = Math.max(...vals) * 1.05;
  const W = 900, L = 260, R = 30, rowH = 46, top = 34, H = top + rows.length * rowH + 34;
  const X = v => L + (Number(v) - lo) / (hi - lo) * (W - L - R);
  const ticks = []; const step = Math.pow(10, Math.floor(Math.log10((hi - lo) / 4))); const st = [1, 2, 2.5, 5, 10].map(m => m * step).find(s => (hi - lo) / s <= 6);
  for (let t = Math.ceil(lo / st) * st; t <= hi; t += st) ticks.push(t);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Football field valuation chart">
    ${ticks.map(t => `<line x1="${X(t)}" x2="${X(t)}" y1="${top - 8}" y2="${H - 26}" stroke="#E2E5EB"/><text x="${X(t)}" y="${H - 8}" font-size="12" text-anchor="middle" fill="#5B6476">${short(t)}</text>`).join('')}
    ${rows.map((b, i) => { const y = top + i * rowH; return `<text x="${L - 12}" y="${y + 22}" font-size="13" text-anchor="end" fill="#14213D" font-weight="600">${esc(b.method)}</text>
      <rect x="${X(b.low)}" y="${y + 8}" width="${Math.max(2, X(b.high) - X(b.low))}" height="22" fill="#14213D"/>
      <line x1="${X(b.mid)}" x2="${X(b.mid)}" y1="${y + 4}" y2="${y + 34}" stroke="#fff" stroke-width="3"/>
      <text x="${X(b.high) + 6}" y="${y + 24}" font-size="12" fill="#14213D" font-weight="700">${short(b.mid)}</text>
      ${b.sellerMid ? `<rect x="${X(b.sellerMid) - 6}" y="${y + 13}" width="12" height="12" transform="rotate(45 ${X(b.sellerMid)} ${y + 19})" fill="#fff" stroke="#D62839" stroke-width="2.5"/>` : ''}`; }).join('')}
    <line x1="${X(ask)}" x2="${X(ask)}" y1="${top - 14}" y2="${H - 26}" stroke="#D62839" stroke-width="2" stroke-dasharray="5 4"/><text x="${X(ask)}" y="${top - 18}" font-size="12" text-anchor="middle" fill="#D62839" font-weight="800">Asking ${short(ask)}</text>
    ${Number.isFinite(offer) && offer !== ask ? `<line x1="${X(offer)}" x2="${X(offer)}" y1="${top - 4}" y2="${H - 26}" stroke="#1E7B4B" stroke-width="2"/><text x="${X(offer)}" y="${top - 4}" font-size="12" text-anchor="middle" fill="#1E7B4B" font-weight="800" dy="-2">Offer ${short(offer)}</text>` : ''}
  </svg><div class="legend"><span><i style="background:#14213D"></i>Range on verified earnings (white tick = midpoint)</span><span><i style="border:2px solid #D62839;transform:rotate(45deg);width:9px;height:9px"></i>Midpoint on seller's numbers</span><span><i style="background:#D62839;height:3px"></i>Asking price</span>${Number.isFinite(offer) && offer !== ask ? '<span><i style="background:#1E7B4B;height:3px"></i>Suggested offer</span>' : ''}</div>`;
}
const evid = es => es.map(e => `<div class="src"><code>${esc(e.field)}</code> ${esc(e.document)}${e.value != null ? ' · ' + esc(e.value) : ''}</div>`).join('');

function reportView(r) {
  const v = r.verified, c = r.claimed, rec = r.recommendation, e = r.earnings, f = v?.financing;
  const dscrCls = !f ? '' : f.dscrAtAsking < Number(r.settings.sbaMinDscr) ? 'bad' : f.dscrAtAsking < Number(r.settings.targetDscr) ? 'warn' : 'ok';
  const yrs = v ? v.dcf.years : [];
  return `<div class="eyebrow">Deal report · ${esc(r.analysisPeriod)} · USD</div>
  <h2 style="font-size:28px">${esc(prettyName(r.target.name))} <span class="muted" style="font-weight:600">for ${esc(prettyName(r.buyer.name))}</span></h2>
  <div class="rbar noprint"><button class="btn" id="dlx">Download Excel</button><button class="btn ghost" onclick="window.print()">Download PDF</button><button class="btn ghost" data-goto="0">Edit inputs</button></div>
  <div class="verdict" style="margin-top:20px"><div class="tag v-${rec.verdict}">${rec.verdict}</div><div class="why"><h2>${esc(rec.headline)}</h2>${rec.reasons.map(s => `<p>${esc(s)}</p>`).join('')}</div></div>
  <div class="kpis">
    <div class="kpi"><div class="l">Asking price</div><div class="n">${short(rec.askingPrice)}</div><div class="s">${esc(r.marketData.precedents ? 'Precedent median ' + r.marketData.precedents.median : '')}</div></div>
    <div class="kpi"><div class="l">Verified SDE</div><div class="n ${Number(e.gap) > 0 ? 'bad' : ''}">${short(e.verifiedSde)}</div><div class="s">Seller claimed ${short(e.claimedSde)}</div></div>
    <div class="kpi"><div class="l">Loan coverage</div><div class="n ${dscrCls}">${f ? x2(f.dscrAtAsking) : '—'}</div><div class="s">Target ${r.settings.targetDscr}x · +${r.settings.stressBps / 100}% rates ${f ? x2(f.dscrStressed) : ''}</div></div>
    <div class="kpi"><div class="l">Your IRR at asking</div><div class="n">${v ? pc(v.lbo.irr) : '—'}</div><div class="s">Target ${r.settings.targetIrrBps / 100}% · with synergies ${pc(r.synergy?.irrWithSynergies)}</div></div>
    <div class="kpi"><div class="l">Suggested offer</div><div class="n" style="color:var(--red)">${short(rec.suggestedOffer)}</div><div class="s">Qualitative ${rec.qualitativeScore}/100 · ${esc(rec.qualitativeBand)}</div></div>
  </div>

  ${v ? `<section class="rsec"><h3>Valuation football field</h3><p class="lead">Four methods plus what a lender will finance, all on verified earnings. Red diamonds show where each method lands on the seller's numbers.</p><div class="ff">${football(r)}</div></section>` : ''}

  <section class="rsec"><h3>Ranked findings, linked to evidence</h3><p class="lead">${r.counts.high} high · ${r.counts.medium} medium · ${r.counts.low} low</p>
    ${r.findings.length ? r.findings.map(x => `<div class="find"><div class="rk">${x.rank}</div><div><span class="chip c-${x.severity}">${x.severity}</span> <span class="chip c-low">${esc(x.area)}</span> <span class="t">${esc(x.title)}</span><div class="d">${esc(x.detail)}</div>${evid(x.evidence)}</div><div class="imp">${x.impactUsd ? money(x.impactUsd) + '<small>dollar impact</small>' : ''}</div></div>`).join('') : '<p>No issues found. The numbers tie out.</p>'}
  </section>

  <section class="rsec"><h3>Earnings bridge: seller's claim vs. verified</h3><p class="lead">SDE = what the business earns for one owner. EBITDA below subtracts a ${money(e.managerSalary)} manager to replace the seller.</p>
    <table><thead><tr><th>Line</th><th class="num">Seller</th><th class="num">Verified</th><th>Decision</th><th>Why · source</th></tr></thead><tbody>
    ${e.bridge.map(b => `<tr><td>${esc(b.label)}</td><td class="num">${money(b.claimed)}</td><td class="num">${money(b.verified)}</td><td><span class="chip c-${b.decision}">${b.decision}</span></td><td>${esc(b.reason)}${evid(b.evidence)}</td></tr>`).join('')}
    <tr class="total"><td>Seller's discretionary earnings</td><td class="num">${money(e.claimedSde)}</td><td class="num">${money(e.verifiedSde)}</td><td colspan="2" class="${Number(e.gap) > 0 ? 'bad' : ''}">${e.gap ? 'Gap ' + money(e.gap) : ''}</td></tr>
    <tr><td>Less replacement manager</td><td class="num">${money(-Number(e.managerSalary))}</td><td class="num">${money(-Number(e.managerSalary))}</td><td colspan="2"></td></tr>
    <tr class="total"><td>EBITDA used in the models</td><td class="num">${money(c?.ebitda)}</td><td class="num">${money(v?.ebitda)}</td><td colspan="2"></td></tr></tbody></table>
    <h3 class="sub">Revenue: claim vs. documents</h3>
    <table><thead><tr><th>Year</th><th class="num">Seller claim</th><th class="num">P&amp;L</th><th class="num">Tax return</th><th class="num">Bank deposits</th></tr></thead><tbody>${r.reconciliation.map(x => `<tr><td>${esc(x.period)}</td><td class="num">${money(x.sellerClaim)}</td><td class="num">${money(x.pnl)}</td><td class="num">${money(x.taxReturn)}</td><td class="num">${money(x.bankDeposits)}</td></tr>`).join('')}</tbody></table>
  </section>

  ${v ? `<section class="rsec"><h3>DCF · discounted cash flow</h3><p class="lead">Discount rate ${esc(v.dcf.discountRate)}, built from risk-free rate + equity premium + small-company premium + company risk.</p>
    <table><thead><tr><th></th>${yrs.map(y => `<th class="num">Year ${y.year}</th>`).join('')}</tr></thead><tbody>
    ${[['Revenue', 'revenue'], ['EBITDA', 'ebitda'], ['Capex', 'capex'], ['Working capital', 'nwc'], ['Taxes', 'tax'], ['Free cash flow', 'fcf'], ['Present value', 'pv']].map(([l, k]) => `<tr><td>${l}</td>${yrs.map(y => `<td class="num">${money(y[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <div class="kv" style="max-width:520px;margin-top:14px"><div>PV of years 1-5</div><div>${money(v.dcf.pvForecast)}</div><div>PV of terminal value</div><div>${money(v.dcf.pvTerminal)}</div><div><b>Enterprise value (verified)</b></div><div class="bad">${money(v.dcf.enterpriseValue)}</div><div>On the seller's numbers</div><div>${money(c?.dcf.enterpriseValue)}</div></div></section>

  <section class="rsec"><h3>LBO · buying it with an SBA loan</h3><p class="lead">Buy at the asking price, hold 5 years, sell at the median comparable multiple. Most you can pay and still earn ${r.settings.targetIrrBps / 100}%: <b>${money(v.lbo.priceForTargetIrr.mid)}</b>.</p>
    <div class="two"><div class="kv"><div>Your equity (down payment)</div><div>${money(v.lbo.sources.buyerEquity)}</div><div>Seller note</div><div>${money(v.lbo.sources.sellerNote)}</div><div>SBA 7(a) loan</div><div>${money(v.lbo.sources.sbaLoan)}</div><div>Closing costs</div><div>${money(v.lbo.sources.closingCosts)}</div><div><b>Total cash you put in</b></div><div>${money(v.lbo.equityInvested)}</div></div>
    <div class="kv"><div>Exit multiple</div><div>${esc(v.lbo.exitMultiple)} SDE</div><div>Exit value (year 5)</div><div>${money(v.lbo.exitValue)}</div><div>Equity at exit</div><div>${money(v.lbo.exitEquity)}</div><div><b>IRR</b></div><div class="bad">${pc(v.lbo.irr)}</div><div>Multiple on your money</div><div>${x2(v.lbo.moic)}</div></div></div>
    <table style="margin-top:14px"><thead><tr><th></th>${v.lbo.years.map(y => `<th class="num">Year ${y.year}</th>`).join('')}</tr></thead><tbody>
    ${[['EBITDA', 'ebitda'], ['Interest', 'interest'], ['Principal repaid', 'principal'], ['Cash to you', 'cashToEquity'], ['Debt left', 'debtBalance']].map(([l, k]) => `<tr><td>${l}</td>${v.lbo.years.map(y => `<td class="num">${money(y[k])}</td>`).join('')}</tr>`).join('')}
    <tr><td>Loan coverage (DSCR)</td>${v.lbo.years.map(y => `<td class="num">${x2(y.dscr)}</td>`).join('')}</tr></tbody></table></section>

  <section class="rsec two"><div><h3>Comps · public peers</h3><p class="lead">Public companies trade at ${esc(v.comps?.publicMedian || '—')} EBITDA. After a ${esc(v.comps?.sizeDiscount || '')} size discount: ${esc(v.comps?.appliedMedian || '—')}.</p>
      ${r.marketData.comps ? `<table><tbody>${r.marketData.comps.peers.map(p => `<tr><td>${esc(p.company)}</td><td class="num">${esc(p.evEbitda)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No peers for this industry.</p>'}</div>
    <div><h3>Precedents · comparable sales</h3><p class="lead">${r.marketData.precedents ? `${r.marketData.precedents.count} sales in our database: ${r.marketData.precedents.min} to ${r.marketData.precedents.max} SDE, median ${r.marketData.precedents.median}.` : 'Not enough comparable sales.'}</p>
      ${v.precedents ? `<div class="kv"><div>Low (Q1 × verified SDE)</div><div>${money(v.precedents.low)}</div><div>Median</div><div>${money(v.precedents.mid)}</div><div>High (Q3)</div><div>${money(v.precedents.high)}</div><div>Asking on verified SDE</div><div class="bad">${x2(Number(rec.askingPrice) / Number(e.verifiedSde))}</div></div>` : ''}</div></section>

  <section class="rsec two"><div><h3>Combined company & financing</h3><div class="kv">
      <div>Pro forma revenue (year 1)</div><div>${money(r.combined.proFormaRevenueYear1)}</div><div>Pro forma EBITDA (year 1)</div><div>${money(r.combined.proFormaEbitdaYear1)}</div>
      <div>Existing + new loan payments</div><div>${money(Number(r.combined.existingDebtService) + Number(r.combined.newDebtService))}</div><div>Global coverage (DSCR)</div><div>${x2(r.combined.globalDscr)}</div>
      <div>Cash needed at closing</div><div>${money(r.combined.cashNeededAtClose)}</div><div>Your cash available</div><div>${money(r.combined.buyerCash)}</div>
      <div>Max price a lender supports (${r.settings.targetDscr}x)</div><div>${money(f.maxPriceTargetDscr)}</div></div></div>
    <div><h3>Synergies, with realistic haircuts</h3><div class="kv">
      <div>DCF value standalone</div><div>${money(r.synergy.dcfStandalone)}</div><div>DCF value with synergies</div><div>${money(r.synergy.dcfWithSynergies)}</div><div><b>Synergy value</b></div><div class="ok">${money(r.synergy.synergyValue)}</div></div>
      <p class="muted" style="font-size:13.5px">${esc(r.synergy.message)}</p></div></section>` : ''}

  <section class="rsec"><h3>Qualitative risk</h3><p class="lead"><span class="score">${rec.qualitativeScore}</span><span class="muted"> / 100 · ${esc(rec.qualitativeBand)}</span></p>
    <table><tbody>${r.qualitative.map(q => `<tr><td>${esc(q.question)}</td><td>${q.answer == null ? '<span class="muted">not answered</span>' : esc(String(q.answer).replace(/_/g, ' '))}</td><td><span class="chip c-${q.flag}">${q.flag}</span></td><td class="muted">${esc(q.note)}</td></tr>`).join('')}</tbody></table></section>

  ${r.missingInputs.length ? `<section class="rsec"><h3>Missing inputs</h3><ul>${r.missingInputs.map(m => `<li>${esc(m)}</li>`).join('')}</ul></section>` : ''}
  <div class="note"><b>Assumptions.</b> ${r.assumptions.map(esc).join(' · ')}<br><br><b>${esc(r.disclaimer)}</b> ${esc(r.marketData.note)}</div>`;
}

// ---------- events ----------
document.addEventListener('input', ev => {
  const t = ev.target; if (!t.dataset?.path) return;
  setPath(t.dataset.path, fromInput(t.dataset.kind, t.value));
});
document.addEventListener('change', ev => {
  const t = ev.target; if (!t.dataset?.path) return;
  setPath(t.dataset.path, fromInput(t.dataset.kind, t.value));
  if (t.tagName === 'SELECT' && t.dataset.path.startsWith('target.financials')) render();
});
document.addEventListener('click', async ev => {
  const t = ev.target.closest('[data-go],[data-step],[data-goto],[data-sample],[data-addyear],[data-delyear],[data-addadd],[data-deladd],[data-fix],#dlx,#saveDeal');
  if (!t) return;
  if (t.dataset.go) return go(Math.min(STEPS.length - 1, Math.max(0, step + Number(t.dataset.go))));
  if (t.dataset.step) return go(Number(t.dataset.step));
  if (t.dataset.goto) return go(Number(t.dataset.goto));
  if (t.dataset.fix) { ev.preventDefault(); return go(stepForField(t.dataset.fix)); }
  if (t.dataset.sample) return loadSample(t.dataset.sample, true);
  if (t.dataset.addyear) { const first = deal.target.financials[0]?.period || 'FY2025'; const yr = Number(first.replace(/\D/g, '')) - 1; deal.target.financials.unshift({period: 'FY' + (yr || '')}); deal.target.addbacks.forEach(() => {}); return render(); }
  if (t.dataset.delyear) { deal.target.financials.splice(Number(t.dataset.delyear), 1); return render(); }
  if (t.dataset.addadd) { const yrs = deal.target.financials; deal.target.addbacks.push({period: yrs[yrs.length - 1]?.period, category: 'owner_salary', documented: 'yes', buyer_must_replace: 'no'}); return render(); }
  if (t.dataset.deladd) { deal.target.addbacks.splice(Number(t.dataset.deladd), 1); return render(); }
  if (t.id === 'saveDeal') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(deal, null, 2)], {type: 'application/json'})); a.download = (prettyName(deal.target.name) || 'deal').replace(/\W+/g, '-') + '.dealspan.json'; a.click(); return; }
  if (t.id === 'dlx') {
    t.disabled = true; t.textContent = 'Building Excel…';
    const r = await fetch(API + '?action=excel', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({deal})});
    if (r.ok) { const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = (r.headers.get('Content-Disposition') || '').match(/filename="(.+)"/)?.[1] || 'DealSpan.xlsx'; a.click(); }
    t.disabled = false; t.textContent = 'Download Excel';
  }
});
$('#openDeal').addEventListener('change', async ev => { const file = ev.target.files[0]; if (!file) return; try { deal = JSON.parse(await file.text()); errors = []; go(0); } catch { alert('That file is not a DealSpan deal file.'); } });

async function loadSample(id, toReport) {
  if (id === 'blank') { deal = blankDeal(); errors = []; return go(0); }
  deal = await (await fetch(`${API}?action=sample&id=${encodeURIComponent(id)}`)).json();
  errors = []; go(toReport ? STEPS.length - 1 : 0);
}

(async function init() {
  schema = await (await fetch(API + '?action=schema')).json();
  const sample = new URLSearchParams(location.search).get('sample');
  rail();
  if (sample) await loadSample(sample, true); else render();
})();
