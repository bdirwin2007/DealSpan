// Single serverless API for DealSpan (Vercel function; also used by the local dev server).
import {analyzeDeal, InputError, QUESTIONS, DEFAULTS, INDUSTRIES, ADDBACK_CATEGORIES} from '../lib/dealspan.js';
import {SAMPLE_IDS, readSample, readFixtures} from '../lib/samples.js';
import {buildWorkbook} from '../lib/excel.js';

const HEADERS = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'};
const send = (res, code, data) => { res.writeHead(code, {...HEADERS, 'Content-Type': 'application/json'}); res.end(JSON.stringify(data)); };
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 1_000_000) throw Error('Request too large (1 MB max)'); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
const schema = () => ({industries: INDUSTRIES, addbackCategories: ADDBACK_CATEGORIES, defaults: DEFAULTS,
  questions: QUESTIONS.map(q => ({id: q.id, label: q.label, why: q.why, type: q.type || 'choice', options: q.options ? Object.keys(q.options) : null})), samples: SAMPLE_IDS});
const safeName = s => String(s || 'deal').replace(/\(FICTIONAL\)/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'deal';

export default async function handler(req, res) {
  try {
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(res, 403, {error: 'Cross-origin requests are disabled'});
    const url = new URL(req.url, 'http://localhost'), action = url.searchParams.get('action');
    if (req.method === 'GET') {
      if (action === 'health') return send(res, 200, {ok: true, product: 'DealSpan', llm: false});
      if (action === 'schema') return send(res, 200, schema());
      if (action === 'sample') return send(res, 200, await readSample(url.searchParams.get('id')));
      return send(res, 404, {error: 'Unknown action'});
    }
    if (req.method !== 'POST') return send(res, 405, {error: 'Use GET or POST'});
    const body = await readBody(req);
    if (action !== 'analyze' && action !== 'excel') return send(res, 404, {error: 'Unknown action'});
    let result;
    try { result = analyzeDeal(body.deal, await readFixtures()); }
    catch (e) { if (e instanceof InputError) return send(res, 422, {error: 'Please fix these inputs', errors: e.errors}); throw e; }
    if (action === 'analyze') return send(res, 200, result);
    const xlsx = await buildWorkbook(result);
    res.writeHead(200, {...HEADERS, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="DealSpan-${safeName(result.target.name)}.xlsx"`});
    return res.end(xlsx);
  } catch (e) { return send(res, 400, {error: e.message}); }
}
