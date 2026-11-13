import { readFile } from "node:fs/promises";
import path from "node:path";
import { colorForCandidate, demographicColor, legendForCandidates } from "./colors";
import type {
  ContestSummary,
  DemographicMetric,
  DemographicsPayload,
  ElectionSummary,
  MapPayload,
} from "./types";

const SAMPLE_DIR = path.join(process.cwd(), "data", "sample");

async function readJson<T>(name: string): Promise<T> {
  const raw = await readFile(path.join(SAMPLE_DIR, name), "utf8");
  return JSON.parse(raw) as T;
}

export async function sampleElections(): Promise<ElectionSummary[]> {
  return readJson<ElectionSummary[]>("catalog.json");
}

export async function sampleContests(
  electionId: string,
  mode: "mayor" | "council",
  ward?: number | null,
): Promise<ContestSummary[]> {
  const catalog = await sampleElections();
  const election = catalog.find((e) => e.id === electionId);
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

  const wards = Object.keys(election.councilWards)
    .map(Number)
    .sort((a, b) => a - b)
    .filter((w) => (ward == null ? true : w === ward));

  return wards.map((w) => ({
    id: `${electionId}:alderman:${w}`,
    electionId,
    office: "alderman" as const,
    ward: w,
    label: `Alderman — Ward ${w}`,
    candidates: election.councilWards[String(w)] ?? [],
  }));
}

type WardResult = {
  ward: number;
  registered: number;
  ballots: number;
  votes: Record<string, number>;
};

function parseContestId(contestId: string): {
  electionId: string;
  office: "mayor" | "alderman";
  ward: number | null;
} {
  const [electionId, office, wardStr] = contestId.split(":");
  return {
    electionId: electionId!,
    office: office === "alderman" ? "alderman" : "mayor",
    ward: wardStr ? Number(wardStr) : null,
  };
}

export async function sampleMap(contestId: string): Promise<MapPayload | null> {
  const { electionId, office, ward } = parseContestId(contestId);
  const [catalog, results, wardsGeo] = await Promise.all([
    sampleElections(),
    readJson<Record<string, WardResult[]>>("ward_results.json"),
    readJson<GeoJSON.FeatureCollection>("wards.geojson"),
  ]);
  const election = catalog.find((e) => e.id === electionId);
  const electionResults = results[electionId];
  if (!election || !electionResults) return null;

  const candidates =
    office === "mayor"
      ? election.mayorCandidates
      : (election.councilWards[String(ward)] ?? []);

  const citywideVotes = new Map<string, number>();
  let totalBallots = 0;
  let totalRegistered = 0;

  const features: GeoJSON.Feature[] = [];

  for (const feature of wardsGeo.features) {
    const w = Number(
      (feature.properties as { ward?: number } | null)?.ward ?? 0,
    );
    const row = electionResults.find((r) => r.ward === w);
    if (!row) continue;

    if (office === "alderman" && ward != null && w !== ward) {
      features.push({
        ...feature,
        properties: {
          id: `ward-${w}`,
          ward: w,
          precinct: null,
          registered: row.registered,
          ballots: row.ballots,
          turnout: row.registered ? row.ballots / row.registered : 0,
          winner: null,
          winnerShare: 0,
          winnerColor: "#d9dee3",
          inactive: true,
          candidates: [],
        },
      });
      continue;
    }

    const candVotes = candidates.map((name) => ({
      name,
      votes: row.votes[name] ?? 0,
    }));
    const sum = candVotes.reduce((a, c) => a + c.votes, 0);
    const ranked = candVotes
      .map((c) => ({ ...c, share: sum ? c.votes / sum : 0 }))
      .sort((a, b) => b.votes - a.votes);
    const winner = ranked[0]?.votes ? ranked[0].name : null;
    const winnerShare = ranked[0]?.share ?? 0;

    totalBallots += row.ballots;
    totalRegistered += row.registered;
    for (const c of ranked) {
      citywideVotes.set(c.name, (citywideVotes.get(c.name) ?? 0) + c.votes);
    }

    features.push({
      ...feature,
      properties: {
        id: `ward-${w}`,
        ward: w,
        precinct: null,
        registered: row.registered,
        ballots: row.ballots,
        turnout: row.registered ? row.ballots / row.registered : 0,
        winner,
        winnerShare,
        winnerColor: winner
          ? colorForCandidate(winner, candidates)
          : "#d9dee3",
        inactive: false,
        candidates: ranked,
      },
    });
  }

  const citySum = [...citywideVotes.values()].reduce((a, b) => a + b, 0);
  const citywide = [...citywideVotes.entries()]
    .map(([name, votes]) => ({
      name,
      votes,
      share: citySum ? votes / citySum : 0,
    }))
    .sort((a, b) => b.votes - a.votes);

  return {
    source: "sample",
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
    legend: legendForCandidates(candidates),
    summary: { totalBallots, totalRegistered, citywide },
  };
}

export async function sampleDemographics(
  metric: DemographicMetric,
): Promise<DemographicsPayload> {
  const [demo, wardsGeo] = await Promise.all([
    readJson<
      Array<{
        geoId: string;
        name: string;
        ward: number;
        lon: number;
        lat: number;
        totalPop: number;
        medianAge: number;
        medianIncome: number;
        pctBachelorPlus: number;
        pctHispanic: number;
        pctBlack: number;
        pctWhite: number;
        pctAsian: number;
      }>
    >("demographics_sample.json"),
    readJson<GeoJSON.FeatureCollection>("wards.geojson"),
  ]);

  const values = demo.map((d) => Number(d[metric]));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const byWard = new Map(demo.map((d) => [d.ward, d]));
  const features: GeoJSON.Feature[] = wardsGeo.features.map((feature) => {
    const w = Number(
      (feature.properties as { ward?: number } | null)?.ward ?? 0,
    );
    const row = byWard.get(w)!;
    const value = Number(row[metric]);
    const t = (value - min) / span;
    return {
      ...feature,
      properties: {
        ...row,
        metric,
        value,
        fill: demographicColor(t),
      },
    };
  });

  return {
    source: "sample",
    metric,
    features: { type: "FeatureCollection", features },
    range: { min, max },
  };
}
