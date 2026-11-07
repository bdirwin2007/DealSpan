import fs from 'node:fs/promises';
import {analyzeDeal} from './dealspan.js';
export const SAMPLE_IDS = ['buckeye-landscaping', 'maple-street-diner', 'clearwater-hvac'];
const dir = new URL('../data/', import.meta.url);
export const readFixtures = async () => ({precedentsCsv: await fs.readFile(new URL('precedents.csv', dir), 'utf8'), compsCsv: await fs.readFile(new URL('comps.csv', dir), 'utf8')});
export async function readSample(id) { if (!SAMPLE_IDS.includes(id)) throw Error('Unknown sample'); return JSON.parse(await fs.readFile(new URL(`samples/${id}.json`, dir), 'utf8')); }
export async function analyzeSample(id) { return analyzeDeal(await readSample(id), await readFixtures()); }
