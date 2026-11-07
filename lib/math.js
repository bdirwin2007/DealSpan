// Exact money math for DealSpan. Money = BigInt cents. Rates = integer basis points (bps).
import {minor, amount, divideRound} from './finance.js';
export {minor, amount, divideRound};

export const SCALE = 10n ** 18n; // fixed-point for compounding
export const abs = n => (n < 0n ? -n : n);
export const max0 = n => (n < 0n ? 0n : n);
export const minB = (...xs) => xs.reduce((m, x) => (x < m ? x : m));
export const maxB = (...xs) => xs.reduce((m, x) => (x > m ? x : m));
export const applyBps = (cents, bps) => divideRound(BigInt(cents) * BigInt(bps), 10000n);
export const grow = (cents, bps) => divideRound(BigInt(cents) * BigInt(10000 + bps), 10000n);
export const roundDownThousand = c => (c >= 0n ? c - (c % 100000n) : -roundUpThousand(-c));
const roundUpThousand = c => (c % 100000n === 0n ? c : c + (100000n - (c % 100000n)));
export const multipleBps = (value, base) => (base > 0n ? (value * 10000n) / base : null);
export const fmtMultiple = bps => (bps === null ? null : (Number(bps) / 10000).toFixed(2) + 'x');
export const ratio4 = (n, d) => (d === 0n ? null : Number((n * 10000n) / d) / 10000);
export const pctStr = (n, d) => (d === 0n ? null : (Number((n * 1000n) / d) / 10).toFixed(1) + '%');
export const usd = c => {
  const neg = c < 0n; const s = amount(neg ? -c : c).replace(/\.00$/, '');
  return (neg ? '-$' : '$') + s.replace(/^(\d+)/, d => d.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
};

// Discount factor (1+r)^t in SCALE units
export function compound(bps, t) {
  let f = SCALE;
  for (let i = 0; i < t; i++) f = (f * BigInt(10000 + bps)) / 10000n;
  return f;
}
export const presentValue = (cents, factor) => divideRound(cents * SCALE, factor);

// Fixed monthly payment: P*r/(1-(1+r)^-n)
export function monthlyPayment(principal, annualBps, months) {
  principal = BigInt(principal);
  if (principal <= 0n) return 0n;
  if (!Number.isInteger(months) || months < 1 || months > 600) throw Error('Loan term must be 1-600 months');
  if (!Number.isInteger(annualBps) || annualBps < 0 || annualBps > 10000) throw Error('Loan rate out of range');
  if (annualBps === 0) return divideRound(principal, BigInt(months));
  const r = (BigInt(annualBps) * SCALE) / 120000n;
  let pow = SCALE;
  for (let i = 0; i < months; i++) pow = (pow * (SCALE + r)) / SCALE;
  return divideRound(principal * r * pow, (pow - SCALE) * SCALE);
}

// Month-by-month amortization rolled up by year: interest, principal, ending balance.
export function amortizeByYear(principal, annualBps, months, years) {
  const pay = monthlyPayment(principal, annualBps, months);
  let bal = BigInt(principal);
  const out = [];
  for (let y = 1; y <= years; y++) {
    let interest = 0n, princ = 0n;
    for (let m = 1; m <= 12; m++) {
      const month = (y - 1) * 12 + m;
      if (month > months || bal <= 0n) break;
      const i = divideRound(bal * BigInt(annualBps), 120000n);
      let p = pay - i;
      if (month === months || p > bal) p = bal;
      interest += i; princ += p; bal -= p;
    }
    out.push({year: y, interest, principal: princ, payment: interest + princ, balance: bal});
  }
  return {monthlyPayment: pay, years: out};
}

// IRR by bisection on a rate in 1/1,000,000 units. Deterministic; returns decimal (e.g. 0.2534) or null.
export function irr(flows) {
  const npv = micro => {
    let total = 0n, f = SCALE;
    for (let t = 0; t < flows.length; t++) {
      total += (flows[t] * SCALE * SCALE) / f; // flows in cents scaled by SCALE
      f = (f * BigInt(1_000_000 + micro)) / 1_000_000n;
    }
    return total;
  };
  let lo = -990_000, hi = 10_000_000;
  const nlo = npv(lo), nhi = npv(hi);
  if (nlo > 0n && nhi > 0n) return Infinity; // return above 1,000%
  if (nlo <= 0n && nhi <= 0n) return -1; // total loss or worse
  for (let i = 0; i < 80 && hi - lo > 1; i++) {
    const mid = Math.floor((lo + hi) / 2);
    if ((npv(mid) > 0n) === (nlo > 0n)) lo = mid; else hi = mid;
  }
  return Math.round(lo / 100) / 10000;
}

// Tukey hinges on a sorted BigInt array
export function quartiles(sorted) {
  const med = a => (a.length % 2 ? a[(a.length - 1) / 2] : divideRound(a[a.length / 2 - 1] + a[a.length / 2], 2n));
  const half = Math.floor(sorted.length / 2);
  return {min: sorted[0], q1: med(sorted.slice(0, half)), median: med(sorted), q3: med(sorted.slice(sorted.length - half)), max: sorted[sorted.length - 1]};
}
export const sortBig = a => [...a].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
