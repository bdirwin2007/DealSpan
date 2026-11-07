// Builds the downloadable DealSpan workbook from an analysis result (values come from the deterministic engine).
import ExcelJS from 'exceljs';

const NAVY = 'FF14213D', RED = 'FFD62839', GREY = 'FFF4F5F7', WHITE = 'FFFFFFFF';
const USD = '$#,##0;[Red]-$#,##0', X = '0.00"x"', PCT = '0.0%';
const num = v => (v === null || v === undefined || v === '' ? null : Number(v));

function sheet(wb, name, title, subtitle, widths) {
  const ws = wb.addWorksheet(name, {views: [{showGridLines: false}]});
  ws.columns = widths.map(w => ({width: w}));
  ws.mergeCells(1, 1, 1, widths.length);
  ws.getCell('A1').value = title;
  ws.getCell('A1').font = {bold: true, size: 16, color: {argb: WHITE}};
  ws.getCell('A1').fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: NAVY}};
  ws.getRow(1).height = 28;
  ws.getCell('A2').value = subtitle;
  ws.getCell('A2').font = {italic: true, size: 10, color: {argb: 'FF5D6470'}};
  return ws;
}
function header(ws, row, labels) {
  const r = ws.getRow(row);
  labels.forEach((l, i) => { const c = r.getCell(i + 1); c.value = l; c.font = {bold: true, color: {argb: WHITE}}; c.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: RED}}; c.alignment = {wrapText: true, vertical: 'middle'}; });
  r.height = 20;
}
function rows(ws, start, data, formats = []) {
  data.forEach((vals, i) => {
    const r = ws.getRow(start + i);
    vals.forEach((v, j) => { const c = r.getCell(j + 1); c.value = v; if (formats[j]) c.numFmt = formats[j]; c.alignment = {wrapText: true, vertical: 'top'}; });
    if (i % 2) vals.forEach((_, j) => { r.getCell(j + 1).fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: GREY}}; });
  });
  return start + data.length;
}
const label = (ws, row, text) => { const c = ws.getCell(row, 1); c.value = text; c.font = {bold: true, size: 12, color: {argb: NAVY}}; };

export async function buildWorkbook(r) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DealSpan'; wb.created = new Date('2026-11-08T00:00:00Z');
  const sub = `${r.target.name} | Buyer: ${r.buyer.name} | ${r.analysisPeriod} | USD | Screening tool, not advice. All demo data fictional.`;
  const v = r.verified, c = r.claimed;

  // 1. Summary
  let ws = sheet(wb, 'Summary', 'DealSpan Deal Report', sub, [44, 20, 20, 20, 20]);
  ws.getCell('A4').value = r.recommendation.verdict; ws.getCell('A4').font = {bold: true, size: 22, color: {argb: RED}};
  ws.getCell('B4').value = r.recommendation.headline; ws.getCell('B4').font = {bold: true, size: 13};
  let n = 5; r.recommendation.reasons.forEach(t => { ws.getCell(n, 2).value = t; n++; });
  n++; header(ws, n, ['Key number', 'Value']);
  n = rows(ws, n + 1, [
    ['Asking price', num(r.recommendation.askingPrice)], ['Suggested offer', num(r.recommendation.suggestedOffer)],
    ["Seller's claimed SDE", num(r.earnings.claimedSde)], ['Verified SDE', num(r.earnings.verifiedSde)], ['Earnings gap', num(r.earnings.gap)],
    ['Verified EBITDA (after manager salary)', num(v?.ebitda)], ['Loan coverage (DSCR) at asking', v?.financing.dscrAtAsking],
    ['Buyer IRR at asking (LBO)', v?.lbo.irr], ['Qualitative risk score (0-100)', r.recommendation.qualitativeScore]
  ], [null, USD]);
  ws.getCell(n - 3, 2).numFmt = X; ws.getCell(n - 2, 2).numFmt = PCT; ws.getCell(n - 1, 2).numFmt = '0';
  n++; label(ws, n, 'Football field: value by method'); n++;
  header(ws, n, ['Method', 'Low', 'Mid', 'High', "Mid on seller's numbers"]);
  n = rows(ws, n + 1, r.football.map(b => [b.method, num(b.low), num(b.mid), num(b.high), num(b.sellerMid)]), [null, USD, USD, USD, USD]);

  // 2. Earnings bridge
  ws = sheet(wb, 'Earnings Bridge', 'Earnings bridge: seller claim vs. verified', sub, [40, 26, 16, 16, 12, 60, 40]);
  header(ws, 4, ['Line', 'Category', 'Seller', 'Verified', 'Decision', 'Reason', 'Source']);
  n = rows(ws, 5, r.earnings.bridge.map(b => [b.label, b.category || '', num(b.claimed), num(b.verified), b.decision, b.reason, b.evidence.map(e => `${e.document} (${e.field})`).join('; ')]), [null, null, USD, USD]);
  ws.getCell(n, 1).value = "Seller's discretionary earnings (SDE)"; ws.getCell(n, 1).font = {bold: true};
  ws.getCell(n, 3).value = num(r.earnings.claimedSde); ws.getCell(n, 4).value = {formula: `SUM(D5:D${n - 1})`, result: num(r.earnings.verifiedSde)};
  ws.getCell(n, 3).numFmt = USD; ws.getCell(n, 4).numFmt = USD; ws.getCell(n, 4).font = {bold: true, color: {argb: RED}};
  n += 2; label(ws, n, 'Revenue reconciliation'); header(ws, n + 1, ['Year', 'Seller claim', 'P&L', 'Tax return', 'Bank deposits']);
  rows(ws, n + 2, r.reconciliation.map(x => [x.period, num(x.sellerClaim), num(x.pnl), num(x.taxReturn), num(x.bankDeposits)]), [null, USD, USD, USD, USD]);

  // 3. DCF with live formulas
  if (v) {
    ws = sheet(wb, 'DCF', 'Discounted cash flow (verified earnings)', sub + ' | Yellow cells are inputs; PV and value cells are live formulas.', [30, 16, 16, 16, 16, 16]);
    const rate = r.settings.discountRateBps / 10000;
    ws.getCell('A4').value = 'Discount rate'; ws.getCell('B4').value = rate; ws.getCell('B4').numFmt = PCT;
    ws.getCell('A5').value = 'Long-term growth'; ws.getCell('B5').value = r.settings.terminalGrowthBps / 10000; ws.getCell('B5').numFmt = PCT;
    for (const a of ['B4', 'B5']) ws.getCell(a).fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: 'FFFFF4CC'}};
    header(ws, 7, ['', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5']);
    const lines = [['Revenue', 'revenue'], ['EBITDA', 'ebitda'], ['Capex', 'capex'], ['Working capital investment', 'nwc'], ['Taxes', 'tax'], ['Free cash flow', 'fcf']];
    lines.forEach(([l, k], i) => { const row = ws.getRow(8 + i); row.getCell(1).value = l; v.dcf.years.forEach((y, j) => { const cl = row.getCell(2 + j); cl.value = num(y[k]); cl.numFmt = USD; }); });
    const pvRow = ws.getRow(14); pvRow.getCell(1).value = 'Present value of FCF';
    v.dcf.years.forEach((y, j) => { const col = String.fromCharCode(66 + j); const cl = pvRow.getCell(2 + j); cl.value = {formula: `${col}13/(1+$B$4)^${j + 1}`, result: num(y.pv)}; cl.numFmt = USD; });
    ws.getCell('A16').value = 'Sum of PV (years 1-5)'; ws.getCell('B16').value = {formula: 'SUM(B14:F14)', result: num(v.dcf.pvForecast)};
    ws.getCell('A17').value = 'Terminal value (year 5)'; ws.getCell('B17').value = {formula: 'F13*(1+B5)/(B4-B5)', result: num(v.dcf.terminalValue)};
    ws.getCell('A18').value = 'PV of terminal value'; ws.getCell('B18').value = {formula: 'B17/(1+B4)^5', result: num(v.dcf.pvTerminal)};
    ws.getCell('A19').value = 'Enterprise value (verified)'; ws.getCell('B19').value = {formula: 'B16+B18', result: num(v.dcf.enterpriseValue)};
    ws.getCell('A20').value = "Enterprise value on seller's numbers"; ws.getCell('B20').value = num(c?.dcf.enterpriseValue);
    for (let i = 16; i <= 20; i++) ws.getCell('B' + i).numFmt = USD;
    ws.getCell('A19').font = ws.getCell('B19').font = {bold: true, color: {argb: RED}};

    // 4. LBO
    ws = sheet(wb, 'LBO', 'Leveraged buyout (SBA-financed) at the asking price', sub, [30, 16, 16, 16, 16, 16]);
    header(ws, 4, ['Sources & uses', 'Amount']);
    n = rows(ws, 5, [['Buyer equity (down payment)', num(v.lbo.sources.buyerEquity)], ['Seller note', num(v.lbo.sources.sellerNote)], ['SBA 7(a) loan', num(v.lbo.sources.sbaLoan)],
      ['Closing costs (paid by buyer)', num(v.lbo.sources.closingCosts)], ['Total uses (price + costs)', num(v.lbo.sources.totalUses)], ['Total equity invested', num(v.lbo.equityInvested)]], [null, USD]);
    n++; header(ws, n, ['', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5']);
    const L = [['EBITDA', 'ebitda'], ['Capex', 'capex'], ['Working capital', 'nwc'], ['Interest', 'interest'], ['Principal repaid', 'principal'], ['Taxes', 'tax'], ['Cash to equity', 'cashToEquity'], ['Debt balance (end)', 'debtBalance'], ['DSCR', 'dscr']];
    L.forEach(([l, k], i) => { const row = ws.getRow(n + 1 + i); row.getCell(1).value = l; v.lbo.years.forEach((y, j) => { const cl = row.getCell(2 + j); cl.value = num(y[k]); cl.numFmt = k === 'dscr' ? X : USD; }); });
    n += L.length + 2;
    n = rows(ws, n, [['Exit multiple (price / SDE)', v.lbo.exitMultiple], ['Year-5 SDE', num(v.lbo.exitSde)], ['Exit value', num(v.lbo.exitValue)], ['Equity at exit', num(v.lbo.exitEquity)],
      ['IRR', v.lbo.irr], ['Multiple on equity (MOIC)', v.lbo.moic], ['Max price for target IRR', num(v.lbo.priceForTargetIrr.mid)]], [null, USD]);
    ws.getCell(n - 7, 2).numFmt = '@'; ws.getCell(n - 3, 2).numFmt = PCT; ws.getCell(n - 2, 2).numFmt = X;

    // DCF sensitivity grid
    if (v.dcf.grid) {
      const D = wb.getWorksheet('DCF');
      label(D, 23, 'Sensitivity: enterprise value by discount rate (across) and long-term growth (down)');
      header(D, 24, ['Growth \\ Rate', ...v.dcf.grid.rates.map(x => (x * 100).toFixed(1) + '%')]);
      rows(D, 25, v.dcf.grid.growths.map((g, i) => [(g * 100).toFixed(1) + '%', ...v.dcf.grid.values[i].map(num)]), [null, USD, USD, USD, USD, USD]);
      if (v.dcf.exitMethod) { D.getCell('A31').value = `Cross-check: exit at ${v.dcf.exitMethod.multiple} year-5 SDE`; D.getCell('B31').value = num(v.dcf.exitMethod.enterpriseValue); D.getCell('B31').numFmt = USD; }
    }
    // LBO IRR grid
    if (v.lbo.grid) {
      const L2 = wb.getWorksheet('LBO'); const start2 = L2.rowCount + 2;
      label(L2, start2, 'Sensitivity: IRR by purchase price (across) and exit multiple (down)');
      header(L2, start2 + 1, ['Exit \\ Price', ...v.lbo.grid.prices.map(p => '$' + Math.round(Number(p) / 1000) + 'K')]);
      rows(L2, start2 + 2, v.lbo.grid.exits.map((e, i) => [e, ...v.lbo.grid.irr[i]]), [null, PCT, PCT, PCT, PCT, PCT]);
    }

    // 5. Comps & precedents
    ws = sheet(wb, 'Comps & Precedents', 'Market approaches', sub + ' | Public multiple: Damodaran (cited). Precedents: team-authored synthetic data.', [52, 18, 18, 18]);
    const m = r.marketData;
    n = 4;
    if (m.comps) {
      label(ws, n, 'Public companies (EV / EBITDA)');
      n = rows(ws, n + 1, [['Sector', m.comps.sector], ['Median EV/EBITDA, positive-EBITDA US firms', m.comps.multiple], ['Number of firms', m.comps.firms], ['Source', `${m.comps.source}: ${m.comps.url}`],
        ['Size & illiquidity discount (assumed)', v.comps?.discountRange], ['Applied multiple range', `${v.comps?.appliedLow} to ${v.comps?.appliedHigh}`], ['Value: low / mid / high', null]]);
      ws.getCell(n - 1, 2).value = num(v.comps?.low); ws.getCell(n - 1, 3).value = num(v.comps?.mid); ws.getCell(n - 1, 4).value = num(v.comps?.high);
      for (const col of [2, 3, 4]) ws.getCell(n - 1, col).numFmt = USD;
    }
    if (m.precedents) {
      label(ws, n + 1, 'Precedent sales (price / SDE), synthetic demo data');
      n = rows(ws, n + 2, [['Sales in database', m.precedents.count], ['Low', m.precedents.min], ['Q1', m.precedents.q1], ['Median', m.precedents.median], ['Q3', m.precedents.q3], ['High', m.precedents.max], ['Precedent IDs', m.precedents.ids.join(', ')], ['Value: Q1 / median / Q3', null]]);
      ws.getCell(n - 1, 2).value = num(v.precedents?.low); ws.getCell(n - 1, 3).value = num(v.precedents?.mid); ws.getCell(n - 1, 4).value = num(v.precedents?.high);
      for (const col of [2, 3, 4]) ws.getCell(n - 1, col).numFmt = USD;
    }

    // 6. Financing & combined company
    ws = sheet(wb, 'Financing & Synergies', 'SBA financing, combined company and synergies', sub, [44, 20, 20, 20]);
    const f = v.financing, cb = r.combined, s = r.synergy;
    header(ws, 4, ['Financing (target on its own)', 'Value']);
    n = rows(ws, 5, [['Cash available for loan payments', num(f.cashAvailableForDebt)], ['Annual loan payments at asking', num(f.annualDebtService)], ['DSCR at asking', f.dscrAtAsking], ['DSCR with +3% rates', f.dscrStressed],
      ['Max price at target DSCR', num(f.maxPriceTargetDscr)], ['Max price at SBA minimum', num(f.maxPriceSbaMinimum)], ['Max price with rate stress', num(f.maxPriceStressed)]], [null, USD]);
    ws.getCell(7, 2).numFmt = X; ws.getCell(8, 2).numFmt = X;
    n++; header(ws, n, ['Combined company (year 1)', 'Value']);
    n = rows(ws, n + 1, [['Your revenue', num(cb.buyerRevenue)], ['Target revenue', num(cb.targetRevenue)], ['Pro forma revenue', num(cb.proFormaRevenueYear1)], ['Your EBITDA', num(cb.buyerEbitda)], ['Target EBITDA', num(cb.targetEbitda)],
      ['Synergy EBITDA (after haircuts)', num(cb.synergyEbitdaYear1)], ['Pro forma EBITDA', num(cb.proFormaEbitdaYear1)], ['Existing + new debt service', num(cb.existingDebtService) + num(cb.newDebtService)], ['Global DSCR', cb.globalDscr],
      ['Cash needed at close', num(cb.cashNeededAtClose)], ['Your cash available', num(cb.buyerCash)]], [null, USD]);
    ws.getCell(n - 3, 2).numFmt = X;
    n++; header(ws, n, ['Synergies', 'Value']);
    n = rows(ws, n + 1, [['DCF value standalone', num(s.dcfStandalone)], ['DCF value with synergies', num(s.dcfWithSynergies)], ['Synergy value (keep it, do not pay it to the seller)', num(s.synergyValue)], ['IRR standalone', s.irrStandalone], ['IRR with synergies', s.irrWithSynergies]], [null, USD]);
    ws.getCell(n - 2, 2).numFmt = PCT; ws.getCell(n - 1, 2).numFmt = PCT;
    header(ws, n + 1, ['Year', 'Synergy EBITDA', 'Integration cost']);
    n = rows(ws, n + 2, s.byYear.map(y => [y.year, num(y.synergyEbitda), num(y.integrationCost)]), [null, USD, USD]);
    n++; header(ws, n, ['Synergy item', 'Entered', 'EBITDA impact', 'Kept after haircut']);
    n = rows(ws, n + 1, s.items.map(i => [`${i.description} (${i.type === 'cost' ? 'cost saving' : 'new revenue'})`, num(i.entered), num(i.ebitdaImpact), num(i.kept)]), [null, USD, USD, USD]);
    ws.getCell(n, 1).value = s.method; ws.getCell(n, 1).font = {italic: true, size: 10};
  }

  // 7. Qualitative
  ws = sheet(wb, 'Fit & Risk', `Fit & risk score: ${r.recommendation.qualitativeScore}/100 (${r.recommendation.qualitativeBand})`, sub, [70, 20, 12, 50]);
  header(ws, 4, ['Question', 'Answer', 'Rating', 'Note']);
  n = rows(ws, 5, r.scorecard.map(q => [`${q.group === 'fit' ? 'Fit' : 'Risk'}: ${q.question}`, q.answer === null ? 'not answered' : String(q.answer).replace(/_/g, ' '), q.label, q.note]));
  if (r.whyThisDeal.length) { label(ws, n + 1, 'Why this deal'); rows(ws, n + 2, r.whyThisDeal.map(w => ['• ' + w])); n += r.whyThisDeal.length + 2; }
  if (r.sellerQuestions.length) { label(ws, n + 1, 'Questions for the seller'); rows(ws, n + 2, r.sellerQuestions.map((q, i) => [`${i + 1}. ${q}`])); }

  // 8. Findings
  ws = sheet(wb, 'Findings', `Ranked findings: ${r.counts.high} high, ${r.counts.medium} medium, ${r.counts.low} low`, sub, [6, 10, 12, 50, 60, 16, 50]);
  header(ws, 4, ['#', 'Severity', 'Area', 'Finding', 'Detail', 'Dollar impact', 'Evidence']);
  rows(ws, 5, r.findings.map(f => [f.rank, f.severity, f.area, f.title, f.detail, num(f.impactUsd), f.evidence.map(e => `${e.document}: ${e.field} = ${e.value}`).join('; ')]), [null, null, null, null, null, USD]);

  // 9. Assumptions
  ws = sheet(wb, 'Assumptions', 'Assumptions, missing inputs and limits', sub, [110]);
  rows(ws, 4, [...r.assumptions.map(a => ['• ' + a]), ...(r.missingInputs.length ? [[''], ['Missing inputs:'], ...r.missingInputs.map(m => ['• ' + m])] : []), [''], [r.disclaimer], [r.marketData.note]]);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
