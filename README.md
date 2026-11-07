# DealSpan

**Know what you're really buying.** DealSpan helps a small business that is buying another small business. It checks the seller's earnings claims against tax returns, bank deposits and add-back evidence. Then it values the target with a **DCF, LBO, public comps and precedent sales**, running each on *verified* earnings and on the seller's numbers so the gap is visible.

Merges two team prototypes: the verified-earnings engine and exports from one, the tabbed results, fit scorecard, deeper DCF/LBO, itemized synergies and cited comps from the other. Built for Redhawk Builds 2026 (Challenge 1: Deal due diligence). No AI in the product: every number is computed by deterministic code in integer cents, and every finding cites the field and document it came from.

## Run locally

```sh
npm ci
npm test        # acceptance tests
npm run demo    # prints the three sample deals
npm run dev     # http://127.0.0.1:4190
```

Node 22+. No API keys.

## Deploy (Vercel)

Push this folder to GitHub, then in Vercel: **Add New → Project → import the repo → Deploy**. No settings or environment variables are needed. `vercel.json` serves `public/` as the site and `api/dealspan.js` as the API.

## How it works

| Step | What the user enters | What DealSpan does |
|---|---|---|
| 1. Your company | Revenue, EBITDA, cash, existing loan payments | Combined-company coverage and cash-at-close check |
| 2. Target | Asking price, replacement manager salary, document names | Sets up the deal |
| 3. Financials | Up to 5 years: seller claims, tax return, P&L, bank deposits | Flags claims vs. tax return (>2% / >5%), deposits vs. revenue, P&L vs. tax profit, revenue decline, customer concentration |
| 4. Add-backs | The seller's schedule | Accepts, cuts 50% or rejects each line by rule. "One-time" items that recur, costs you still pay, and projected savings are rejected |
| 5. Fit & risk | 18 questions | 0–100 score: strategic fit (services, geography, overlap, cross-sell, culture, integration) plus risks (owner dependence, key staff, recurring revenue, lease, licenses, reason for sale). Generates questions for the seller |
| 6. Deal & assumptions | Financing, valuation, synergies (blank = default) | DCF, LBO, comps, precedents, SBA capacity, synergies with haircuts |
| 7. Report | | Tabbed: Overview, Earnings check, Fit & risk, DCF (with rate × growth grid), LBO (with price × exit IRR grid), Comps & precedents, Synergies & combined, Assumptions. Every number tagged entered / calculated / cited / assumed. Excel (live DCF formulas) and PDF |

**Offer** = the lowest of: asking price, max price at the target loan coverage, max price for the buyer's target IRR, and the median comparable sale × verified SDE. **WALK** if the offer is under 60% of asking; **NEGOTIATE** if it's below asking, high-severity issues exist, or the qualitative score is under 50; otherwise **PROCEED**.

## Files

- `lib/dealspan.js`: engine (validation, earnings bridge, qualitative score, models, recommendation)
- `lib/math.js`: exact money, amortization, IRR, quartiles
- `lib/excel.js`: workbook export
- `api/dealspan.js`: API (`schema`, `sample`, `analyze`, `excel`)
- `public/`: overview page (`index.html`) and app (`app.html`, `app.js`, `styles.css`)
- `data/sector_multiples.csv`: **real** public EV/EBITDA medians by sector (Damodaran, January 2026, cited)
- `data/precedents.csv`: **synthetic** small-business sales authored by the team (the slot where licensed data plugs in)
- `data/samples/*.json`: three fictional deals (NEGOTIATE / WALK / PROCEED)
- `tests/dealspan.test.js`: acceptance checks (valid input, missing/invalid input, financial reconciliation)

## Honest limitations

- All demo companies and the small-business precedents are fictional. Public sector multiples are real (Damodaran). Real small-deal precedent data (BizComps, DealStats, GF Data) is licensed.
- Numbers are typed in, with no document reading. That's by design: the event rules don't allow AI.
- Add-back rules are screening heuristics, not a quality-of-earnings report. No working-capital peg, SBA guarantee fee detail or tax structuring.
- DCF taxes EBITDA less capex as a proxy; LBO assumes yearly payouts and exit at the median precedent multiple.
- Not financial, legal or valuation advice.

## Next steps

Seller-readiness page, SEC EDGAR pull for public targets, saving deals per team (Supabase), lender view.
