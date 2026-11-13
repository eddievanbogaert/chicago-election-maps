import { colorForCandidate, demographicColor, legendForCandidates } from "./colors";
import { fq, getBigQuery } from "./bigquery";
import type {
  ContestSummary,
  DemographicMetric,
  DemographicsPayload,
  ElectionSummary,
  MapPayload,
} from "./types";

type Row = Record<string, unknown>;

async function query<T extends Row>(
  sql: string,
  params?: Record<string, unknown>,
  types?: Record<string, string>,
): Promise<T[]> {
  const bq = getBigQuery();
  if (!bq) throw new Error("BigQuery is not configured");
  const [rows] = await bq.query({
    query: sql,
    params,
    types,
    location: "US",
  });
  return rows as T[];
}

export async function bqElections(): Promise<ElectionSummary[]> {
  const elections = await query<{
    election_id: string;
    year: number;
    round: string;
    label: string;
  }>(`
    SELECT election_id, year, round, label
    FROM ${fq("elections")}
    ORDER BY year, round
  `);

  const contests = await query<{
    election_id: string;
    office: string;
    ward: number | null;
    candidate_name: string;
  }>(`
    SELECT election_id, office, ward, candidate_name
    FROM ${fq("candidates")}
    ORDER BY election_id, office, ward, candidate_name
  `);

  return elections.map((e) => {
    const rows = contests.filter((c) => c.election_id === e.election_id);
    const mayorCandidates = rows
      .filter((c) => c.office === "mayor")
      .map((c) => c.candidate_name);
    const councilWards: Record<string, string[]> = {};
    for (const c of rows.filter((r) => r.office === "alderman" && r.ward != null)) {
      const key = String(c.ward);
      councilWards[key] ??= [];
      councilWards[key].push(c.candidate_name);
    }
    return {
      id: e.election_id,
      year: e.year,
      round: e.round as ElectionSummary["round"],
      label: e.label,
      mayorCandidates,
      councilWards,
    };
  });
}

export async function bqContests(
  electionId: string,
  mode: "mayor" | "council",
  ward?: number | null,
): Promise<ContestSummary[]> {
  const elections = await bqElections();
  const election = elections.find((e) => e.id === electionId);
  if (!election) return [];
  if (mode === "mayor") {
    return [
      {
        id: `${electionId}:mayor`,
        electionId,
        office: "mayor",
        ward: null,
        label: "Mayor",
        candidates: election.mayorCandidates,
      },
    ];
  }
  return Object.keys(election.councilWards)
    .map(Number)
    .sort((a, b) => a - b)
    .filter((w) => (ward == null ? true : w === ward))
    .map((w) => ({
      id: `${electionId}:alderman:${w}`,
      electionId,
      office: "alderman" as const,
      ward: w,
      label: `Alderman — Ward ${w}`,
      candidates: election.councilWards[String(w)] ?? [],
    }));
}

function parseContestId(contestId: string) {
  const [electionId, office, wardStr] = contestId.split(":");
  return {
    electionId: electionId!,
    office: office === "alderman" ? ("alderman" as const) : ("mayor" as const),
    ward: wardStr ? Number(wardStr) : null,
  };
}

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

async function bqWardBoundaries(
  electionId: string,
  ward?: number | null,
): Promise<GeoJSON.FeatureCollection> {
  const rows = await query<{ ward: number; geom_geojson: string }>(
    ward == null
      ? `
    SELECT ward, ST_ASGEOJSON(ST_SIMPLIFY(geom, 12)) AS geom_geojson
    FROM ${fq("geographies")}
    WHERE election_id = @electionId
      AND geography_level = 'ward'
      AND geom IS NOT NULL
    `
      : `
    SELECT ward, ST_ASGEOJSON(ST_SIMPLIFY(geom, 8)) AS geom_geojson
    FROM ${fq("geographies")}
    WHERE election_id = @electionId
      AND geography_level = 'ward'
      AND ward = @ward
      AND geom IS NOT NULL
    `,
    ward == null ? { electionId } : { electionId, ward },
    ward == null ? undefined : { ward: "INT64" },
  );

  return {
    type: "FeatureCollection",
    features: rows.map((r) => ({
      type: "Feature" as const,
      geometry: JSON.parse(r.geom_geojson) as GeoJSON.Geometry,
      properties: { ward: r.ward, id: `ward-boundary-${r.ward}` },
    })),
  };
}

export async function bqMap(contestId: string): Promise<MapPayload | null> {
  const { electionId, office, ward } = parseContestId(contestId);

  // Citywide council: all alderman races on one map until a ward is chosen.
  if (office === "alderman" && ward == null) {
    return bqCouncilCitywide(electionId, contestId);
  }

  const contests = await bqContests(
    electionId,
    office === "mayor" ? "mayor" : "council",
    ward,
  );
  const contest = contests.find((c) => c.id === contestId);
  if (!contest) return null;

  // Precinct-level join. ST_SIMPLIFY trims payload size for mobile without
  // changing choropleth readability at city / ward zooms.
  const rows = await query<{
    ward: number;
    precinct: number | null;
    registered: number;
    ballots: number;
    candidate_name: string;
    votes: number;
    geom_geojson: string | null;
  }>(
    office === "mayor"
      ? `
    SELECT
      r.ward,
      r.precinct,
      r.registered_voters AS registered,
      r.ballots_cast AS ballots,
      r.candidate_name,
      r.votes,
      ST_ASGEOJSON(ST_SIMPLIFY(g.geom, 8)) AS geom_geojson
    FROM ${fq("results")} r
    LEFT JOIN ${fq("geographies")} g
      ON g.election_id = r.election_id
     AND g.ward = r.ward
     AND g.precinct = r.precinct
     AND g.geography_level = 'precinct'
    WHERE r.election_id = @electionId
      AND r.office = 'mayor'
    `
      : `
    SELECT
      r.ward,
      r.precinct,
      r.registered_voters AS registered,
      r.ballots_cast AS ballots,
      r.candidate_name,
      r.votes,
      ST_ASGEOJSON(ST_SIMPLIFY(g.geom, 5)) AS geom_geojson
    FROM ${fq("results")} r
    LEFT JOIN ${fq("geographies")} g
      ON g.election_id = r.election_id
     AND g.ward = r.ward
     AND g.precinct = r.precinct
     AND g.geography_level = 'precinct'
    WHERE r.election_id = @electionId
      AND r.office = 'alderman'
      AND r.ward = @ward
    `,
    office === "mayor" ? { electionId } : { electionId, ward },
    office === "mayor" ? undefined : { ward: "INT64" },
  );

  type Agg = {
    ward: number;
    precinct: number;
    registered: number;
    ballots: number;
    votes: Map<string, number>;
    geom: string | null;
  };
  const byPrecinct = new Map<string, Agg>();
  for (const row of rows) {
    if (row.precinct == null) continue;
    const key = `${row.ward}-${row.precinct}`;
    let agg = byPrecinct.get(key);
    if (!agg) {
      agg = {
        ward: row.ward,
        precinct: row.precinct,
        registered: 0,
        ballots: 0,
        votes: new Map(),
        geom: row.geom_geojson,
      };
      byPrecinct.set(key, agg);
    }
    agg.registered = Math.max(agg.registered, Number(row.registered) || 0);
    agg.ballots = Math.max(agg.ballots, Number(row.ballots) || 0);
    agg.votes.set(
      row.candidate_name,
      (agg.votes.get(row.candidate_name) ?? 0) + Number(row.votes || 0),
    );
    if (!agg.geom && row.geom_geojson) agg.geom = row.geom_geojson;
  }

  // If precinct geoms are missing for this election, fall back to ward shapes.
  if ([...byPrecinct.values()].every((a) => !a.geom)) {
    return bqMapWardFallback(contestId, contest, electionId, office, ward);
  }

  const citywideVotes = new Map<string, number>();
  let totalBallots = 0;
  let totalRegistered = 0;
  const features: GeoJSON.Feature[] = [];
  const seenTurnout = new Set<string>();

  for (const agg of byPrecinct.values()) {
    const ranked = contest.candidates
      .map((name) => ({ name, votes: agg.votes.get(name) ?? 0 }))
      .map((c, _, arr) => {
        const sum = arr.reduce((a, x) => a + x.votes, 0);
        return { ...c, share: sum ? c.votes / sum : 0 };
      })
      .sort((a, b) => b.votes - a.votes);
    const winner = ranked[0]?.votes ? ranked[0].name : null;
    const turnKey = `${agg.ward}-${agg.precinct}`;
    if (!seenTurnout.has(turnKey)) {
      seenTurnout.add(turnKey);
      totalBallots += agg.ballots;
      totalRegistered += agg.registered;
    }
    for (const c of ranked) {
      citywideVotes.set(c.name, (citywideVotes.get(c.name) ?? 0) + c.votes);
    }
    if (!agg.geom) continue;
    features.push({
      type: "Feature",
      geometry: JSON.parse(agg.geom) as GeoJSON.Geometry,
      properties: {
        id: `ward-${agg.ward}-pct-${agg.precinct}`,
        ward: agg.ward,
        precinct: agg.precinct,
        registered: agg.registered,
        ballots: agg.ballots,
        turnout: agg.registered ? agg.ballots / agg.registered : 0,
        winner,
        winnerShare: ranked[0]?.share ?? 0,
        winnerColor: winner
          ? colorForCandidate(winner, contest.candidates)
          : "#2a3340",
        inactive: !winner,
        candidates: ranked,
      },
    });
  }

  const citySum = [...citywideVotes.values()].reduce((a, b) => a + b, 0);
  const wardBoundaries = await bqWardBoundaries(
    electionId,
    office === "alderman" ? ward : null,
  ).catch(() => EMPTY_FC);

  return {
    source: "bigquery",
    electionId,
    contestId,
    geography: "precinct",
    features: { type: "FeatureCollection", features },
    wardBoundaries,
    legend: legendForCandidates(contest.candidates),
    summary: {
      totalBallots,
      totalRegistered,
      citywide: [...citywideVotes.entries()]
        .map(([name, votes]) => ({
          name,
          votes,
          share: citySum ? votes / citySum : 0,
        }))
        .sort((a, b) => b.votes - a.votes),
    },
  };
}

async function bqCouncilCitywide(
  electionId: string,
  contestId: string,
): Promise<MapPayload | null> {
  const elections = await bqElections();
  const election = elections.find((e) => e.id === electionId);
  if (!election) return null;

  const rows = await query<{
    ward: number;
    precinct: number | null;
    registered: number;
    ballots: number;
    candidate_name: string;
    votes: number;
    geom_geojson: string | null;
  }>(
    `
    SELECT
      r.ward,
      r.precinct,
      r.registered_voters AS registered,
      r.ballots_cast AS ballots,
      r.candidate_name,
      r.votes,
      ST_ASGEOJSON(ST_SIMPLIFY(g.geom, 8)) AS geom_geojson
    FROM ${fq("results")} r
    LEFT JOIN ${fq("geographies")} g
      ON g.election_id = r.election_id
     AND g.ward = r.ward
     AND g.precinct = r.precinct
     AND g.geography_level = 'precinct'
    WHERE r.election_id = @electionId
      AND r.office = 'alderman'
    `,
    { electionId },
  );

  type Agg = {
    ward: number;
    precinct: number;
    registered: number;
    ballots: number;
    votes: Map<string, number>;
    geom: string | null;
  };
  const byPrecinct = new Map<string, Agg>();
  for (const row of rows) {
    if (row.precinct == null) continue;
    const key = `${row.ward}-${row.precinct}`;
    let agg = byPrecinct.get(key);
    if (!agg) {
      agg = {
        ward: row.ward,
        precinct: row.precinct,
        registered: 0,
        ballots: 0,
        votes: new Map(),
        geom: row.geom_geojson,
      };
      byPrecinct.set(key, agg);
    }
    agg.registered = Math.max(agg.registered, Number(row.registered) || 0);
    agg.ballots = Math.max(agg.ballots, Number(row.ballots) || 0);
    agg.votes.set(
      row.candidate_name,
      (agg.votes.get(row.candidate_name) ?? 0) + Number(row.votes || 0),
    );
    if (!agg.geom && row.geom_geojson) agg.geom = row.geom_geojson;
  }

  if ([...byPrecinct.values()].every((a) => !a.geom)) {
    // Fall back to ward shapes colored by ward-race winner.
    return bqCouncilCitywideWardFallback(electionId, contestId, election);
  }

  const features: GeoJSON.Feature[] = [];
  let totalBallots = 0;
  let totalRegistered = 0;
  const seenTurnout = new Set<string>();
  const legendNames: string[] = [];

  for (const agg of byPrecinct.values()) {
    const wardCandidates = election.councilWards[String(agg.ward)] ?? [
      ...agg.votes.keys(),
    ];
    const ranked = wardCandidates
      .map((name) => ({ name, votes: agg.votes.get(name) ?? 0 }))
      .map((c, _, arr) => {
        const sum = arr.reduce((a, x) => a + x.votes, 0);
        return { ...c, share: sum ? c.votes / sum : 0 };
      })
      .sort((a, b) => b.votes - a.votes);
    const winner = ranked[0]?.votes ? ranked[0].name : null;
    const turnKey = `${agg.ward}-${agg.precinct}`;
    if (!seenTurnout.has(turnKey)) {
      seenTurnout.add(turnKey);
      totalBallots += agg.ballots;
      totalRegistered += agg.registered;
    }
    if (winner && !legendNames.includes(winner)) legendNames.push(winner);
    if (!agg.geom) continue;
    features.push({
      type: "Feature",
      geometry: JSON.parse(agg.geom) as GeoJSON.Geometry,
      properties: {
        id: `ward-${agg.ward}-pct-${agg.precinct}`,
        ward: agg.ward,
        precinct: agg.precinct,
        registered: agg.registered,
        ballots: agg.ballots,
        turnout: agg.registered ? agg.ballots / agg.registered : 0,
        winner,
        winnerShare: ranked[0]?.share ?? 0,
        winnerColor: winner
          ? colorForCandidate(winner, wardCandidates)
          : "#2a3340",
        inactive: !winner,
        candidates: ranked,
      },
    });
  }

  // Recompute ward winners from full ward vote totals for the summary list.
  const wardTotals = new Map<number, Map<string, number>>();
  for (const agg of byPrecinct.values()) {
    let votes = wardTotals.get(agg.ward);
    if (!votes) {
      votes = new Map();
      wardTotals.set(agg.ward, votes);
    }
    for (const [name, v] of agg.votes) {
      votes.set(name, (votes.get(name) ?? 0) + v);
    }
  }
  const wardSummaries = [...wardTotals.entries()]
    .map(([w, votes]) => {
      const cands = election.councilWards[String(w)] ?? [...votes.keys()];
      const ranked = cands
        .map((name) => ({ name, votes: votes.get(name) ?? 0 }))
        .sort((a, b) => b.votes - a.votes);
      const sum = ranked.reduce((a, c) => a + c.votes, 0);
      const top = ranked[0];
      return {
        name: top?.votes ? `Ward ${w} · ${top.name}` : `Ward ${w}`,
        votes: top?.votes ?? 0,
        share: sum && top ? top.votes / sum : 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const wardBoundaries = await bqWardBoundaries(electionId, null).catch(
    () => EMPTY_FC,
  );

  return {
    source: "bigquery",
    electionId,
    contestId,
    geography: "precinct",
    features: { type: "FeatureCollection", features },
    wardBoundaries,
    legend: legendForCandidates(legendNames.slice(0, 12)),
    summary: {
      totalBallots,
      totalRegistered,
      citywide: wardSummaries,
    },
  };
}

async function bqCouncilCitywideWardFallback(
  electionId: string,
  contestId: string,
  election: ElectionSummary,
): Promise<MapPayload> {
  const rows = await query<{
    ward: number;
    precinct: number | null;
    registered: number;
    ballots: number;
    candidate_name: string;
    votes: number;
    geom_geojson: string | null;
  }>(
    `
    SELECT
      r.ward,
      r.precinct,
      r.registered_voters AS registered,
      r.ballots_cast AS ballots,
      r.candidate_name,
      r.votes,
      ST_ASGEOJSON(g.geom) AS geom_geojson
    FROM ${fq("results")} r
    LEFT JOIN ${fq("geographies")} g
      ON g.election_id = r.election_id
     AND g.ward = r.ward
     AND g.geography_level = 'ward'
    WHERE r.election_id = @electionId
      AND r.office = 'alderman'
    `,
    { electionId },
  );

  type Agg = {
    ward: number;
    registered: number;
    ballots: number;
    votes: Map<string, number>;
    geom: string | null;
  };
  const byWard = new Map<number, Agg>();
  for (const row of rows) {
    let agg = byWard.get(row.ward);
    if (!agg) {
      agg = {
        ward: row.ward,
        registered: 0,
        ballots: 0,
        votes: new Map(),
        geom: row.geom_geojson,
      };
      byWard.set(row.ward, agg);
    }
    agg.registered = Math.max(agg.registered, Number(row.registered) || 0);
    agg.ballots = Math.max(agg.ballots, Number(row.ballots) || 0);
    agg.votes.set(
      row.candidate_name,
      (agg.votes.get(row.candidate_name) ?? 0) + Number(row.votes || 0),
    );
    if (!agg.geom && row.geom_geojson) agg.geom = row.geom_geojson;
  }

  const features: GeoJSON.Feature[] = [];
  const legendNames: string[] = [];
  let totalBallots = 0;
  let totalRegistered = 0;
  const wardSummaries: { name: string; votes: number; share: number }[] = [];

  for (const agg of [...byWard.values()].sort((a, b) => a.ward - b.ward)) {
    const cands = election.councilWards[String(agg.ward)] ?? [...agg.votes.keys()];
    const ranked = cands
      .map((name) => ({ name, votes: agg.votes.get(name) ?? 0 }))
      .map((c, _, arr) => {
        const sum = arr.reduce((a, x) => a + x.votes, 0);
        return { ...c, share: sum ? c.votes / sum : 0 };
      })
      .sort((a, b) => b.votes - a.votes);
    const winner = ranked[0]?.votes ? ranked[0].name : null;
    totalBallots += agg.ballots;
    totalRegistered += agg.registered;
    if (winner && ranked[0]) {
      if (!legendNames.includes(winner)) legendNames.push(winner);
      wardSummaries.push({
        name: `Ward ${agg.ward} · ${winner}`,
        votes: ranked[0].votes,
        share: ranked[0].share,
      });
    }
    if (!agg.geom) continue;
    features.push({
      type: "Feature",
      geometry: JSON.parse(agg.geom) as GeoJSON.Geometry,
      properties: {
        id: `ward-${agg.ward}`,
        ward: agg.ward,
        precinct: null,
        registered: agg.registered,
        ballots: agg.ballots,
        turnout: agg.registered ? agg.ballots / agg.registered : 0,
        winner,
        winnerShare: ranked[0]?.share ?? 0,
        winnerColor: winner ? colorForCandidate(winner, cands) : "#2a3340",
        inactive: !winner,
        candidates: ranked,
      },
    });
  }

  return {
    source: "bigquery",
    electionId,
    contestId,
    geography: "ward",
    features: { type: "FeatureCollection", features },
    wardBoundaries: {
      type: "FeatureCollection",
      features: features.map((f) => ({
        type: "Feature" as const,
        geometry: f.geometry,
        properties: {
          ward: f.properties?.ward ?? null,
          id: `ward-boundary-${f.properties?.ward ?? ""}`,
        },
      })),
    },
    legend: legendForCandidates(legendNames.slice(0, 12)),
    summary: { totalBallots, totalRegistered, citywide: wardSummaries },
  };
}

async function bqMapWardFallback(
  contestId: string,
  contest: ContestSummary,
  electionId: string,
  office: "mayor" | "alderman",
  ward: number | null,
): Promise<MapPayload> {
  const rows = await query<{
    ward: number;
    precinct: number | null;
    registered: number;
    ballots: number;
    candidate_name: string;
    votes: number;
    geom_geojson: string | null;
  }>(
    office === "mayor"
      ? `
    SELECT
      r.ward,
      r.precinct,
      r.registered_voters AS registered,
      r.ballots_cast AS ballots,
      r.candidate_name,
      r.votes,
      ST_ASGEOJSON(g.geom) AS geom_geojson
    FROM ${fq("results")} r
    LEFT JOIN ${fq("geographies")} g
      ON g.election_id = r.election_id
     AND g.ward = r.ward
     AND g.geography_level = 'ward'
    WHERE r.election_id = @electionId
      AND r.office = 'mayor'
    `
      : `
    SELECT
      r.ward,
      r.precinct,
      r.registered_voters AS registered,
      r.ballots_cast AS ballots,
      r.candidate_name,
      r.votes,
      ST_ASGEOJSON(g.geom) AS geom_geojson
    FROM ${fq("results")} r
    LEFT JOIN ${fq("geographies")} g
      ON g.election_id = r.election_id
     AND g.ward = r.ward
     AND g.geography_level = 'ward'
    WHERE r.election_id = @electionId
      AND r.office = 'alderman'
      AND r.ward = @ward
    `,
    office === "mayor" ? { electionId } : { electionId, ward },
    office === "mayor" ? undefined : { ward: "INT64" },
  );

  type Agg = {
    ward: number;
    registered: number;
    ballots: number;
    votes: Map<string, number>;
    geom: string | null;
  };
  const byWard = new Map<number, Agg>();
  for (const row of rows) {
    let agg = byWard.get(row.ward);
    if (!agg) {
      agg = {
        ward: row.ward,
        registered: 0,
        ballots: 0,
        votes: new Map(),
        geom: row.geom_geojson,
      };
      byWard.set(row.ward, agg);
    }
    agg.registered = Math.max(agg.registered, Number(row.registered) || 0);
    agg.ballots = Math.max(agg.ballots, Number(row.ballots) || 0);
    agg.votes.set(
      row.candidate_name,
      (agg.votes.get(row.candidate_name) ?? 0) + Number(row.votes || 0),
    );
    if (!agg.geom && row.geom_geojson) agg.geom = row.geom_geojson;
  }

  const citywideVotes = new Map<string, number>();
  let totalBallots = 0;
  let totalRegistered = 0;
  const features: GeoJSON.Feature[] = [];

  for (const agg of byWard.values()) {
    const ranked = contest.candidates
      .map((name) => ({ name, votes: agg.votes.get(name) ?? 0 }))
      .map((c, _, arr) => {
        const sum = arr.reduce((a, x) => a + x.votes, 0);
        return { ...c, share: sum ? c.votes / sum : 0 };
      })
      .sort((a, b) => b.votes - a.votes);
    const winner = ranked[0]?.votes ? ranked[0].name : null;
    totalBallots += agg.ballots;
    totalRegistered += agg.registered;
    for (const c of ranked) {
      citywideVotes.set(c.name, (citywideVotes.get(c.name) ?? 0) + c.votes);
    }
    if (!agg.geom) continue;
    features.push({
      type: "Feature",
      geometry: JSON.parse(agg.geom) as GeoJSON.Geometry,
      properties: {
        id: `ward-${agg.ward}`,
        ward: agg.ward,
        precinct: null,
        registered: agg.registered,
        ballots: agg.ballots,
        turnout: agg.registered ? agg.ballots / agg.registered : 0,
        winner,
        winnerShare: ranked[0]?.share ?? 0,
        winnerColor: winner
          ? colorForCandidate(winner, contest.candidates)
          : "#2a3340",
        inactive: false,
        candidates: ranked,
      },
    });
  }

  const citySum = [...citywideVotes.values()].reduce((a, b) => a + b, 0);
  // When fills are already ward polygons, reuse their outlines as boundaries.
  const wardBoundaries: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: features.map((f) => ({
      type: "Feature" as const,
      geometry: f.geometry,
      properties: {
        ward: f.properties?.ward ?? null,
        id: `ward-boundary-${f.properties?.ward ?? ""}`,
      },
    })),
  };

  return {
    source: "bigquery",
    electionId,
    contestId,
    geography: "ward",
    features: { type: "FeatureCollection", features },
    wardBoundaries,
    legend: legendForCandidates(contest.candidates),
    summary: {
      totalBallots,
      totalRegistered,
      citywide: [...citywideVotes.entries()]
        .map(([name, votes]) => ({
          name,
          votes,
          share: citySum ? votes / citySum : 0,
        }))
        .sort((a, b) => b.votes - a.votes),
    },
  };
}

export async function bqDemographics(
  metric: DemographicMetric,
): Promise<DemographicsPayload> {
  const colMap: Record<DemographicMetric, string> = {
    medianIncome: "median_income",
    medianAge: "median_age",
    pctBachelorPlus: "pct_bachelor_plus",
    pctHispanic: "pct_hispanic",
    pctBlack: "pct_black",
    pctWhite: "pct_white",
    pctAsian: "pct_asian",
    totalPop: "total_pop",
  };
  const col = colMap[metric];
  const rows = await query<{
    geo_id: string;
    name: string;
    ward: number | null;
    lon: number;
    lat: number;
    total_pop: number;
    median_age: number;
    median_income: number;
    pct_bachelor_plus: number;
    pct_hispanic: number;
    pct_black: number;
    pct_white: number;
    pct_asian: number;
    geom_geojson: string;
    value: number;
  }>(
    `
    SELECT
      d.geo_id,
      d.name,
      d.ward,
      d.lon,
      d.lat,
      d.total_pop,
      d.median_age,
      d.median_income,
      d.pct_bachelor_plus,
      d.pct_hispanic,
      d.pct_black,
      d.pct_white,
      d.pct_asian,
      ST_ASGEOJSON(ST_SIMPLIFY(d.geom, 15)) AS geom_geojson,
      d.${col} AS value
    FROM ${fq("demographics")} d
    WHERE d.${col} IS NOT NULL AND d.${col} >= 0
    `,
  );

  const values = rows.map((r) => Number(r.value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  return {
    source: "bigquery",
    metric,
    range: { min, max },
    features: {
      type: "FeatureCollection",
      features: rows.map((r) => {
        const t = (Number(r.value) - min) / span;
        return {
          type: "Feature" as const,
          geometry: JSON.parse(r.geom_geojson) as GeoJSON.Geometry,
          properties: {
            geoId: r.geo_id,
            name: r.name,
            ward: r.ward,
            lon: r.lon,
            lat: r.lat,
            totalPop: r.total_pop,
            medianAge: r.median_age,
            medianIncome: r.median_income,
            pctBachelorPlus: r.pct_bachelor_plus,
            pctHispanic: r.pct_hispanic,
            pctBlack: r.pct_black,
            pctWhite: r.pct_white,
            pctAsian: r.pct_asian,
            metric,
            value: Number(r.value),
            fill: demographicColor(t),
          },
        };
      }),
    },
  };
}
