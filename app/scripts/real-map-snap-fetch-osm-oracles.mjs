#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outputRoot = path.resolve(argument('--output'));
const endpoint = 'https://overpass.kumi.systems/api/interpreter';
const windows = [
  { id: 'U03', purpose: 'mapped internal lanes beside arterial', bbox: [-36.8470, 174.7540, -36.8400, 174.7590] },
  { id: 'U04', purpose: 'unmapped/new internal park circuit beside Lambie Drive', bbox: [-36.9950, 174.8720, -36.9900, 174.8805] },
  { id: 'U05', purpose: 'building/courtyard and supported laneway', bbox: [-36.9830, 174.8480, -36.9780, 174.8540] },
  { id: 'X03', purpose: 'Albert Park building/wall/barrier context', bbox: [-36.8550, 174.7660, -36.8480, 174.7740] },
  { id: 'M02', purpose: 'switchbacks and nearby hillside roads', bbox: [-45.0270, 168.6700, -45.0190, 168.6820] },
];
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

const receipts = [];
for (const window of windows) {
  const bbox = window.bbox.join(',');
  const query = `[out:json][timeout:60];(way["highway"](${bbox});way["building"](${bbox});way["barrier"](${bbox}););out tags geom;`;
  const startedAt = new Date().toISOString();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'CairnNZ-QA-Safety-Oracle/1.0',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`http-${response.status}`);
    const parsed = JSON.parse(body);
    const file = path.join(outputRoot, 'raw', `${window.id}.json`);
    writeJson(file, parsed);
    receipts.push({
      id: window.id,
      purpose: window.purpose,
      bbox: window.bbox,
      endpoint,
      query,
      startedAt,
      completedAt: new Date().toISOString(),
      status: response.status,
      outcome: 'CAPTURED',
      elementCount: parsed.elements?.length ?? 0,
      responseSha256: sha256(fs.readFileSync(file)),
      mapboxNavigationRequest: false,
      estimatedCostUsd: 0,
    });
  } catch (error) {
    receipts.push({
      id: window.id,
      purpose: window.purpose,
      bbox: window.bbox,
      endpoint,
      query,
      startedAt,
      completedAt: new Date().toISOString(),
      status: null,
      outcome: 'UNAVAILABLE',
      error: error instanceof Error ? `${error.name}:${error.message}` : String(error),
      elementCount: null,
      responseSha256: null,
      mapboxNavigationRequest: false,
      estimatedCostUsd: 0,
    });
  }
}
writeJson(path.join(outputRoot, 'OSM_ORACLE_REQUEST_LEDGER.json'), {
  schema: 'cairn.real-map-snap.osm-oracle-request-ledger.v1',
  provider: 'OpenStreetMap Overpass API',
  purpose: 'Independent targeted safety-oracle vectors; never used by production selection',
  navigationBudgetImpact: 0,
  estimatedCostUsd: 0,
  receipts,
});
process.stdout.write(`${JSON.stringify({ ok: true, requests: receipts.length, outputRoot }, null, 2)}\n`);
