import {analyzeSample, SAMPLE_IDS} from '../lib/samples.js';
for (const id of process.argv[2] ? [process.argv[2]] : SAMPLE_IDS) {
  const r = await analyzeSample(id), v = r.verified, c = r.claimed;
  console.log(`\n=== ${r.target.name} <- ${r.buyer.name}`);
  console.log(`${r.recommendation.verdict}: ${r.recommendation.headline} | qual ${r.recommendation.qualitativeScore} ${r.recommendation.qualitativeBand}`);
  r.recommendation.reasons.forEach(x => console.log('   ' + x));
  console.log(`SDE claimed ${r.earnings.claimedSde} verified ${r.earnings.verifiedSde} | EBITDA v ${v.ebitda} c ${c?.ebitda}`);
  console.log(`DCF v ${v.dcf.enterpriseValue} (${v.dcf.discountRate}) c ${c?.dcf.enterpriseValue}`);
  console.log(`LBO @ask IRR v ${v.lbo.irr} MOIC ${v.lbo.moic} minDSCR ${v.lbo.minDscr} | price@IRR ${JSON.stringify(v.lbo.priceForTargetIrr)}`);
  console.log(`Comps v ${JSON.stringify(v.comps)}`);
  console.log(`Prec v ${JSON.stringify(v.precedents)}`);
  console.log(`Fin v DSCR ${v.financing.dscrAtAsking} max ${v.financing.maxPriceTargetDscr}`);
  console.log(`Synergy ${JSON.stringify({sv: r.synergy.synergyValue, irr: [r.synergy.irrStandalone, r.synergy.irrWithSynergies]})} global DSCR ${r.combined.globalDscr}`);
  console.log('Football:'); r.football.forEach(b => console.log(`   ${b.method}: ${b.low} | ${b.mid} | ${b.high}  seller mid ${b.sellerMid}`));
  console.log(`Findings ${JSON.stringify(r.counts)}`); r.findings.slice(0, 8).forEach(f => console.log(`   #${f.rank} [${f.severity}/${f.area}] ${f.title}`));
}
