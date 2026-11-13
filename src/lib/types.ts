export type ElectionRound = "general" | "runoff";
export type AtlasMode = "mayor" | "council" | "demographics";
export type DemographicMetric =
  | "medianIncome"
  | "medianAge"
  | "pctBachelorPlus"
  | "pctHispanic"
  | "pctBlack"
  | "pctWhite"
  | "pctAsian"
  | "totalPop";

export interface ElectionSummary {
  id: string;
  year: number;
  round: ElectionRound;
  label: string;
  mayorCandidates: string[];
  councilWards: Record<string, string[]>;
}

export interface ContestSummary {
  id: string;
  electionId: string;
  office: "mayor" | "alderman";
  ward: number | null;
  label: string;
  candidates: string[];
}

export interface CandidateResult {
  name: string;
  votes: number;
  share: number;
}

export interface GeographyResult {
  id: string;
  ward: number;
  precinct: number | null;
  registered: number;
  ballots: number;
  turnout: number;
  winner: string | null;
  winnerShare: number;
  candidates: CandidateResult[];
}

export interface MapPayload {
  source: "bigquery" | "sample";
  electionId: string;
  contestId: string;
  geography: "ward" | "precinct";
  features: GeoJSON.FeatureCollection;
  /** Ward outlines drawn above precinct fills (empty when unavailable). */
  wardBoundaries: GeoJSON.FeatureCollection;
  legend: { name: string; color: string }[];
  summary: {
    totalBallots: number;
    totalRegistered: number;
    citywide: CandidateResult[];
  };
}

export interface DemographicFeature {
  geoId: string;
  name: string;
  ward: number | null;
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
}

export interface DemographicsPayload {
  source: "bigquery" | "sample";
  metric: DemographicMetric;
  features: GeoJSON.FeatureCollection;
  range: { min: number; max: number };
}
