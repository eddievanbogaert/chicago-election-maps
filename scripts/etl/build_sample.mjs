#!/usr/bin/env node
/**
 * Rebuilds data/sample from DataMade CSVs + precinct GeoJSON.
 * Usage: node scripts/etl/build_sample.mjs
 * Downloads into .data/raw (gitignored) then writes data/sample.
 */
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { parse } from "csv-parse/sync";

const ROOT = process.cwd();
const RAW = path.join(ROOT, ".data", "raw");
const OUT = path.join(ROOT, "data", "sample");
const BASE =
  "https://raw.githubusercontent.com/datamade/chicago-municipal-elections/master";

const FILES = [
  ["2015", "general", "municipal_general_2015.csv"],
  ["2015", "runoff", "municipal_runoff_2015.csv"],
  ["2019", "general", "municipal_general_2019.csv"],
  ["2019", "runoff", "municipal_runoff_2019.csv"],
  ["2023", "general", "municipal_general_2023.csv"],
  ["2023", "runoff", "municipal_runoff_2023.csv"],
];

const META = new Set([
  "WARD",
  "PRECINCT",
  "REGISTERED VOTERS",
  "BALLOTS CAST",
  "Shape_Leng",
  "Shape_Area",
  "Ward_Prec",
]);

async function download(rel, dest) {
  const res = await fetch(`${BASE}/${rel}`);
  if (!res.ok) throw new Error(`Failed ${rel}: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function parseElection(csvText) {
  const rows = parse(csvText, { columns: true, skip_empty_lines: true });
  const candidates = Object.keys(rows[0] ?? {}).filter((c) => !META.has(c));
  const byWard = new Map();
  for (const row of rows) {
    const w = Number(row.WARD);
    if (!byWard.has(w)) {
      byWard.set(w, { ward: w, registered: 0, ballots: 0, votes: {} });
    }
    const agg = byWard.get(w);
    agg.registered += Number(row["REGISTERED VOTERS"] || 0);
    agg.ballots += Number(row["BALLOTS CAST"] || 0);
    for (const c of candidates) {
      const v = row[c];
      if (v === "" || v == null) continue;
      agg.votes[c] = (agg.votes[c] || 0) + Number(v);
    }
  }
  const presence = new Map();
  for (const agg of byWard.values()) {
    for (const [c, v] of Object.entries(agg.votes)) {
      if (v > 0) presence.set(c, (presence.get(c) || 0) + 1);
    }
  }
  const mayor = [...presence.entries()]
    .filter(([, n]) => n >= 40)
    .map(([c]) => c)
    .sort();
  const councilWards = {};
  for (const [c, n] of presence.entries()) {
    if (n >= 40) continue;
    let bestW = null;
    let bestV = -1;
    for (const agg of byWard.values()) {
      const v = agg.votes[c] || 0;
      if (v > bestV) {
        bestV = v;
        bestW = agg.ward;
      }
    }
    if (bestW != null && bestV > 0) {
      councilWards[String(bestW)] ??= [];
      councilWards[String(bestW)].push(c);
    }
  }
  return { byWard, mayor, councilWards };
}

function simplify(coords, nd = 4) {
  if (typeof coords[0] === "number") {
    return [Number(coords[0].toFixed(nd)), Number(coords[1].toFixed(nd))];
  }
  if (coords.length && typeof coords[0][0] === "number") {
    const out = [simplify(coords[0], nd)];
    for (let i = 1; i < coords.length - 1; i += 1) {
      if (i % 3 === 0) out.push(simplify(coords[i], nd));
    }
    out.push(simplify(coords[coords.length - 1], nd));
    return out;
  }
  return coords.map((c) => simplify(c, nd));
}

await mkdir(RAW, { recursive: true });
await mkdir(OUT, { recursive: true });

const precinctPath = path.join(RAW, "precincts_2023.geojson");
await download("precincts/2023_precincts.geojson", precinctPath);
for (const [, , file] of FILES) {
  await download(`data/${file}`, path.join(RAW, file));
}

const precincts = JSON.parse(await readFile(precinctPath, "utf8"));
const wards = new Map();
for (const f of precincts.features) {
  const w = Number(f.properties.WARD);
  const g = f.geometry;
  const polys =
    g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  if (!wards.has(w)) wards.set(w, []);
  wards.get(w).push(...polys);
}

const wardFc = {
  type: "FeatureCollection",
  features: [...wards.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([w, coords]) => ({
      type: "Feature",
      properties: { ward: w },
      geometry: {
        type: "MultiPolygon",
        coordinates: simplify(coords),
      },
    })),
};

const catalog = [];
const allResults = {};
for (const [year, round, file] of FILES) {
  const csv = await readFile(path.join(RAW, file), "utf8");
  const { byWard, mayor, councilWards } = parseElection(csv);
  const id = `${year}-${round}`;
  catalog.push({
    id,
    year: Number(year),
    round,
    label: `${year} Municipal ${round === "general" ? "General" : "Runoff"}`,
    mayorCandidates: mayor,
    councilWards,
  });
  allResults[id] = [...byWard.values()]
    .sort((a, b) => a.ward - b.ward)
    .map((w) => ({
      ward: w.ward,
      registered: w.registered,
      ballots: w.ballots,
      votes: Object.fromEntries(
        Object.entries(w.votes).filter(([, v]) => v > 0),
      ),
    }));
  console.log(id, "mayor", mayor.length, "council wards", Object.keys(councilWards).length);
}

const demo = wardFc.features.map((f) => {
  const w = f.properties.ward;
  const ring = f.geometry.coordinates[0][0];
  const lon = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return {
    geoId: `17031W${String(w).padStart(2, "0")}`,
    name: `Ward ${w} (sample ACS proxy)`,
    ward: w,
    lon: Number(lon.toFixed(5)),
    lat: Number(lat.toFixed(5)),
    totalPop: 40000 + ((w * 7919) % 35000),
    medianAge: 27 + ((w * 3) % 25),
    medianIncome: 28000 + ((w * 1373) % 95000),
    pctBachelorPlus: Number((0.12 + ((w * 7) % 55) / 100).toFixed(3)),
    pctHispanic: Number((((w * 11) % 70) / 100).toFixed(3)),
    pctBlack: Number((((w * 13) % 75) / 100).toFixed(3)),
    pctWhite: Number((((w * 17) % 65) / 100).toFixed(3)),
    pctAsian: Number((((w * 19) % 30) / 100).toFixed(3)),
  };
});

await writeFile(path.join(OUT, "wards.geojson"), JSON.stringify(wardFc));
await writeFile(path.join(OUT, "catalog.json"), JSON.stringify(catalog, null, 2));
await writeFile(path.join(OUT, "ward_results.json"), JSON.stringify(allResults));
await writeFile(
  path.join(OUT, "demographics_sample.json"),
  JSON.stringify(demo, null, 2),
);
console.log("Wrote sample data to", OUT);
