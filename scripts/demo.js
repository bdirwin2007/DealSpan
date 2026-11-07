import {analyzeSample, SAMPLE_IDS} from '../lib/samples.js';
for (const id of process.argv[2] ? [process.argv[2]] : SAMPLE_IDS) {
  const r = await analyzeSample(id), v = r.verified, c = r.claimed;
  console.log(`\n=== ${r.target.name} <- ${r.buyer.name}`);
  console.log(`${r.recommendation.verdict}: ${r.recommendation.headline} | fit/risk ${r.recommendation.qualitativeScore} ${r.recommendation.qualitativeBand}`);
  r.recommendation.reasons.forEach(x => console.log('   ' + x));
  console.log(`SDE c ${r.earnings.claimedSde} v ${r.earnings.verifiedSde} | EBITDA v ${v.ebitda} | D&A ${v.da} (${r.target.daSource})`);
  console.log(`DCF v ${v.dcf.enterpriseValue} (${v.dcf.discountRate}) exit-method ${v.dcf.exitMethod?.enterpriseValue} TV share ${v.dcf.terminalShare} | c ${c?.dcf.enterpriseValue}`);
  console.log(`LBO IRR ${v.lbo.irr} MOIC ${v.lbo.moic} | price@IRR ${JSON.stringify(v.lbo.priceForTargetIrr)}`);
  console.log(`Comps ${JSON.stringify(v.comps)}`);
  console.log(`Synergy kept ${r.synergy.keptTotal} value ${r.synergy.synergyValue} irr ${r.synergy.irrStandalone}->${r.synergy.irrWithSynergies} | combined D/E ${r.combined.debtToEbitdaBefore}->${r.combined.debtToEbitdaAfter} global DSCR ${r.combined.globalDscr}`);
  r.football.forEach(b => console.log(`   ${b.method}: ${b.low} | ${b.mid} | ${b.high}  seller ${b.sellerMid}`));
  console.log(`Findings ${JSON.stringify(r.counts)} | seller questions ${r.sellerQuestions.length}`); r.sellerQuestions.slice(0, 4).forEach(q => console.log('   ? ' + q));
  console.log('Why: ' + r.whyThisDeal.join(' | '));
}
