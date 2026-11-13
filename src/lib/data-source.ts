import { hasBigQueryCredentials } from "./bigquery";
import * as bq from "./bq-data";
import * as sample from "./sample-data";
import type {
  ContestSummary,
  DemographicMetric,
  DemographicsPayload,
  ElectionSummary,
  MapPayload,
} from "./types";

export type DataBackend = "bigquery" | "sample";

export function activeBackend(): DataBackend {
  return hasBigQueryCredentials() ? "bigquery" : "sample";
}

export async function listElections(): Promise<ElectionSummary[]> {
  if (activeBackend() === "bigquery") {
    try {
      return await bq.bqElections();
    } catch (error) {
      console.error("BigQuery elections failed; using sample", error);
    }
  }
  return sample.sampleElections();
}

export async function listContests(
  electionId: string,
  mode: "mayor" | "council",
  ward?: number | null,
): Promise<ContestSummary[]> {
  if (activeBackend() === "bigquery") {
    try {
      return await bq.bqContests(electionId, mode, ward);
    } catch (error) {
      console.error("BigQuery contests failed; using sample", error);
    }
  }
  return sample.sampleContests(electionId, mode, ward);
}

export async function getMap(contestId: string): Promise<MapPayload | null> {
  if (activeBackend() === "bigquery") {
    try {
      return await bq.bqMap(contestId);
    } catch (error) {
      console.error("BigQuery map failed; using sample", error);
    }
  }
  return sample.sampleMap(contestId);
}

export async function getDemographics(
  metric: DemographicMetric,
): Promise<DemographicsPayload> {
  if (activeBackend() === "bigquery") {
    try {
      return await bq.bqDemographics(metric);
    } catch (error) {
      console.error("BigQuery demographics failed; using sample", error);
    }
  }
  return sample.sampleDemographics(metric);
}
