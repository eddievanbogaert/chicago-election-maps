import { BigQuery } from "@google-cloud/bigquery";

let client: BigQuery | null = null;

export function getProjectId(): string | null {
  return (
    process.env.GCP_PROJECT_ID?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    null
  );
}

export function getDatasetId(): string {
  return process.env.BIGQUERY_DATASET?.trim() || "chicago_election_atlas";
}

function parseServiceAccountJson(): Record<string, unknown> | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return JSON.parse(
      Buffer.from(raw, "base64").toString("utf8"),
    ) as Record<string, unknown>;
  }
}

/** True when explicit SA JSON is set, or when running with ADC on GCP. */
export function hasBigQueryCredentials(): boolean {
  if (!getProjectId()) return false;
  if (parseServiceAccountJson()) return true;
  // Cloud Run / GCE attach a service account via metadata server.
  return Boolean(
    process.env.K_SERVICE ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.GCE_METADATA_HOST,
  );
}

export function getBigQuery(): BigQuery | null {
  if (!getProjectId()) return null;
  if (client) return client;

  const credentials = parseServiceAccountJson();
  client = credentials
    ? new BigQuery({ projectId: getProjectId()!, credentials })
    : new BigQuery({ projectId: getProjectId()! });
  return client;
}

export function fq(table: string): string {
  return `\`${getProjectId()}.${getDatasetId()}.${table}\``;
}
