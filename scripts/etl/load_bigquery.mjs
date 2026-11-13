#!/usr/bin/env node
/**
 * Load normalized election + demographic tables into BigQuery.
 *
 * Required env:
 *   GCP_PROJECT_ID
 *   GOOGLE_SERVICE_ACCOUNT_JSON  (raw JSON or base64)
 * Optional:
 *   BIGQUERY_DATASET (default chicago_election_atlas)
 *
 * Usage:
 *   node scripts/etl/load_bigquery.mjs
 *
 * Reads CSVs/GeoJSON from .data/raw (run build_sample.mjs first, or this will download).
 * Never prints credential contents.
 */
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { parse } from "csv-parse/sync";
import { BigQuery } from "@google-cloud/bigquery";

const ROOT = process.cwd();
const RAW = path.join(ROOT, ".data", "raw");
const STAGING = path.join(ROOT, ".data", "staging");
const BASE =
  "https://raw.githubusercontent.com/datamade/chicago-municipal-elections/master";

const PROJECT = process.env.GCP_PROJECT_ID?.trim();
const DATASET = process.env.BIGQUERY_DATASET?.trim() || "chicago_election_atlas";
const SA = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();

if (!PROJECT || !SA) {
  console.error(
    "Missing GCP_PROJECT_ID or GOOGLE_SERVICE_ACCOUNT_JSON. Refusing to run.",
  );
  process.exit(1);
}

function credentials() {
  try {
    return JSON.parse(SA);
  } catch {
    return JSON.parse(Buffer.from(SA, "base64").toString("utf8"));
  }
}

const bq = new BigQuery({ projectId: PROJECT, credentials: credentials() });

const FILES = [
  ["2015", "general", "municipal_general_2015.csv", "municipal_general_2015.geojson"],
  ["2015", "runoff", "municipal_runoff_2015.csv", "municipal_runoff_2015.geojson"],
  ["2019", "general", "municipal_general_2019.csv", "municipal_general_2019.geojson"],
  ["2019", "runoff", "municipal_runoff_2019.csv", "municipal_runoff_2019.geojson"],
  ["2023", "general", "municipal_general_2023.csv", "municipal_general_2023.geojson"],
  ["2023", "runoff", "municipal_runoff_2023.csv", "municipal_runoff_2023.geojson"],
];

const META = new Set(["WARD", "PRECINCT", "REGISTERED VOTERS", "BALLOTS CAST"]);

async function download(rel, dest) {
  const res = await fetch(`${BASE}/${rel}`);
  if (!res.ok) throw new Error(`download ${rel}: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function ensureRaw() {
  await mkdir(RAW, { recursive: true });
  await mkdir(STAGING, { recursive: true });
  for (const [, , csv, geo] of FILES) {
    const csvPath = path.join(RAW, csv);
    const geoPath = path.join(RAW, geo);
    try {
      await readFile(csvPath);
    } catch {
      console.log("Downloading", csv);
      await download(`data/${csv}`, csvPath);
    }
    try {
      await readFile(geoPath);
    } catch {
      console.log("Downloading", geo);
      await download(`data/${geo}`, geoPath);
    }
  }
}

function normalizeElection(year, round, csvText) {
  const rows = parse(csvText, { columns: true, skip_empty_lines: true });
  const candidates = Object.keys(rows[0] ?? {}).filter((c) => !META.has(c));
  const results = [];
  for (const row of rows) {
    const ward = Number(row.WARD);
    const precinct = Number(row.PRECINCT);
    const registered = Number(row["REGISTERED VOTERS"] || 0);
    const ballots = Number(row["BALLOTS CAST"] || 0);
    for (const name of candidates) {
      const raw = row[name];
      if (raw === "" || raw == null) continue;
      const votes = Number(raw);
      if (!Number.isFinite(votes)) continue;
      results.push({
        election_id: `${year}-${round}`,
        ward,
        precinct,
        registered_voters: registered,
        ballots_cast: ballots,
        candidate_name: name,
        votes,
      });
    }
  }
  const wardSets = new Map();
  for (const r of results) {
    if (r.votes <= 0) continue;
    if (!wardSets.has(r.candidate_name)) wardSets.set(r.candidate_name, new Set());
    wardSets.get(r.candidate_name).add(r.ward);
  }
  const mayor = [];
  const alderman = [];
  for (const [name, wards] of wardSets.entries()) {
    if (wards.size >= 40) {
      mayor.push(name);
    } else {
      // dominant ward
      const tallies = new Map();
      for (const r of results) {
        if (r.candidate_name !== name || r.votes <= 0) continue;
        tallies.set(r.ward, (tallies.get(r.ward) || 0) + r.votes);
      }
      let bestW = null;
      let bestV = -1;
      for (const [w, v] of tallies) {
        if (v > bestV) {
          bestV = v;
          bestW = w;
        }
      }
      if (bestW != null) alderman.push({ name, ward: bestW });
    }
  }

  const election = {
    election_id: `${year}-${round}`,
    year: Number(year),
    round,
    label: `${year} Municipal ${round === "general" ? "General" : "Runoff"}`,
    source_url: `${BASE}/data/municipal_${round}_${year}.csv`,
  };

  const candidateRows = [
    ...mayor.map((candidate_name) => ({
      election_id: election.election_id,
      office: "mayor",
      ward: null,
      candidate_name,
    })),
    ...alderman.map(({ name, ward }) => ({
      election_id: election.election_id,
      office: "alderman",
      ward,
      candidate_name: name,
    })),
  ];

  const resultRows = results.map((r) => {
    const isMayor = mayor.includes(r.candidate_name);
    const a = alderman.find((x) => x.name === r.candidate_name);
    return {
      ...r,
      office: isMayor ? "mayor" : "alderman",
      // keep only matching ward rows for alderman
      _drop: !isMayor && a && a.ward !== r.ward,
    };
  }).filter((r) => !r._drop).map(({ _drop, ...r }) => r);

  return { election, candidateRows, resultRows };
}

async function ensureDataset() {
  const [datasets] = await bq.getDatasets();
  if (!datasets.some((d) => d.id === DATASET)) {
    console.log("Creating dataset", DATASET);
    await bq.createDataset(DATASET, { location: "US" });
  }
}

async function loadJsonTable(tableId, rows, schema) {
  const table = bq.dataset(DATASET).table(tableId);
  const [exists] = await table.exists();
  if (exists) {
    await table.delete();
  }
  await bq.dataset(DATASET).createTable(tableId, { schema, location: "US" });
  if (!rows.length) return;
  const file = path.join(STAGING, `${tableId}.json`);
  await writeFile(file, rows.map((r) => JSON.stringify(r)).join("\n"));
  await table.load(file, {
    sourceFormat: "NEWLINE_DELIMITED_JSON",
    writeDisposition: "WRITE_TRUNCATE",
    schema: { fields: schema },
  });
  console.log(`Loaded ${rows.length} rows into ${tableId}`);
}

/** BigQuery ST_GEOGFROMGEOJSON rejects non-RFC members like `rewind`. */
function cleanGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") return geometry;
  return {
    type: geometry.type,
    coordinates: geometry.coordinates,
  };
}

async function loadGeographies(year, round, geoPath) {
  const geo = JSON.parse(await readFile(geoPath, "utf8"));
  const electionId = `${year}-${round}`;
  const wardGeoms = new Map();
  const precinctRows = [];
  for (const f of geo.features) {
    const ward = Number(f.properties.WARD);
    const precinct = Number(f.properties.PRECINCT);
    const g = cleanGeometry(f.geometry);
    const geom = JSON.stringify(g);
    precinctRows.push({
      election_id: electionId,
      geography_level: "precinct",
      ward,
      precinct,
      geom_geojson: geom,
    });
    if (!wardGeoms.has(ward)) wardGeoms.set(ward, []);
    if (g.type === "Polygon") wardGeoms.get(ward).push(g.coordinates);
    else wardGeoms.get(ward).push(...g.coordinates);
  }
  const wardRows = [...wardGeoms.entries()].map(([ward, coords]) => ({
    election_id: electionId,
    geography_level: "ward",
    ward,
    precinct: null,
    geom_geojson: JSON.stringify({ type: "MultiPolygon", coordinates: coords }),
  }));
  return [...wardRows, ...precinctRows];
}

async function loadDemographicsFromPublicAcs() {
  // Materialize Chicago tracts from public ACS + Illinois tract geometries.
  const sql = `
    CREATE OR REPLACE TABLE \`${PROJECT}.${DATASET}.demographics\` AS
    SELECT
      acs.geo_id,
      geo.tract_name AS name,
      CAST(NULL AS INT64) AS ward,
      ST_X(ST_CENTROID(geo.tract_geom)) AS lon,
      ST_Y(ST_CENTROID(geo.tract_geom)) AS lat,
      acs.total_pop,
      acs.median_age,
      COALESCE(
        IF(acs.median_income > 0, acs.median_income, NULL),
        IF(acs.income_per_capita > 0, acs.income_per_capita * 2.2, NULL)
      ) AS median_income,
      SAFE_DIVIDE(acs.bachelors_degree_or_higher_25_64, NULLIF(acs.pop_25_64, 0)) AS pct_bachelor_plus,
      SAFE_DIVIDE(acs.hispanic_any_race, NULLIF(acs.total_pop, 0)) AS pct_hispanic,
      SAFE_DIVIDE(acs.black_pop, NULLIF(acs.total_pop, 0)) AS pct_black,
      SAFE_DIVIDE(acs.white_pop, NULLIF(acs.total_pop, 0)) AS pct_white,
      SAFE_DIVIDE(acs.asian_pop, NULLIF(acs.total_pop, 0)) AS pct_asian,
      geo.tract_geom AS geom,
      'acs5_2020' AS acs_vintage
    FROM \`bigquery-public-data.census_bureau_acs.censustract_2020_5yr\` acs
    JOIN \`bigquery-public-data.geo_census_tracts.census_tracts_illinois\` geo
      ON acs.geo_id = geo.geo_id
    WHERE STARTS_WITH(acs.geo_id, '17031')
      AND acs.total_pop > 0
  `;
  await bq.query({ query: sql, location: "US" });
  console.log("Materialized demographics from public ACS");
}

await ensureRaw();
await ensureDataset();

const elections = [];
const candidates = [];
const results = [];
let geographies = [];

for (const [year, round, csv, geo] of FILES) {
  console.log("Normalizing", year, round);
  const csvText = await readFile(path.join(RAW, csv), "utf8");
  const norm = normalizeElection(year, round, csvText);
  elections.push(norm.election);
  candidates.push(...norm.candidateRows);
  results.push(...norm.resultRows);
  const geos = await loadGeographies(year, round, path.join(RAW, geo));
  geographies = geographies.concat(geos);
}

await loadJsonTable("elections", elections, [
  { name: "election_id", type: "STRING" },
  { name: "year", type: "INTEGER" },
  { name: "round", type: "STRING" },
  { name: "label", type: "STRING" },
  { name: "source_url", type: "STRING" },
]);

await loadJsonTable("candidates", candidates, [
  { name: "election_id", type: "STRING" },
  { name: "office", type: "STRING" },
  { name: "ward", type: "INTEGER" },
  { name: "candidate_name", type: "STRING" },
]);

await loadJsonTable("results", results, [
  { name: "election_id", type: "STRING" },
  { name: "office", type: "STRING" },
  { name: "ward", type: "INTEGER" },
  { name: "precinct", type: "INTEGER" },
  { name: "registered_voters", type: "INTEGER" },
  { name: "ballots_cast", type: "INTEGER" },
  { name: "candidate_name", type: "STRING" },
  { name: "votes", type: "INTEGER" },
]);

// Load geographies as geojson strings then convert to GEOGRAPHY
await loadJsonTable("geographies_raw", geographies, [
  { name: "election_id", type: "STRING" },
  { name: "geography_level", type: "STRING" },
  { name: "ward", type: "INTEGER" },
  { name: "precinct", type: "INTEGER" },
  { name: "geom_geojson", type: "STRING" },
]);

await bq.query({
  query: `
    CREATE OR REPLACE TABLE \`${PROJECT}.${DATASET}.geographies\` AS
    SELECT
      election_id,
      geography_level,
      ward,
      precinct,
      SAFE.ST_GEOGFROMGEOJSON(geom_geojson) AS geom
    FROM \`${PROJECT}.${DATASET}.geographies_raw\`
    WHERE SAFE.ST_GEOGFROMGEOJSON(geom_geojson) IS NOT NULL
  `,
  location: "US",
});
console.log("Converted geographies to GEOGRAPHY");

try {
  await loadDemographicsFromPublicAcs();
} catch (error) {
  console.warn(
    "ACS materialization skipped (public dataset access may be required):",
    error instanceof Error ? error.message : error,
  );
}

console.log("BigQuery load complete for project", PROJECT, "dataset", DATASET);
