#!/usr/bin/env bash
# Bootstrap a new GCP project for Chicago Election Atlas.
# Run locally after `gcloud auth login` — never commit keys from this script.
set -euo pipefail

PROJECT_ID="${1:-}"
BILLING_ACCOUNT="${2:-}"
REGION="${3:-us-central1}"
DATASET="${BIGQUERY_DATASET:-chicago_election_atlas}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "Usage: $0 <project-id> [billing-account-id] [region]"
  exit 1
fi

echo "Creating / selecting project: $PROJECT_ID"
gcloud projects create "$PROJECT_ID" --name="Chicago Election Atlas" 2>/dev/null || true
gcloud config set project "$PROJECT_ID"

if [[ -n "$BILLING_ACCOUNT" ]]; then
  gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"
fi

echo "Enabling APIs..."
gcloud services enable \
  bigquery.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  iam.googleapis.com \
  secretmanager.googleapis.com

echo "Creating BigQuery dataset..."
bq --location=US mk -d --description "Chicago Election Atlas" "$PROJECT_ID:$DATASET" 2>/dev/null || true

echo "Creating runtime service account..."
SA_NAME="election-atlas-runtime"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud iam service-accounts create "$SA_NAME" \
  --display-name="Election Atlas runtime" 2>/dev/null || true

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/bigquery.dataViewer" \
  --condition=None >/dev/null

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/bigquery.jobUser" \
  --condition=None >/dev/null

echo "Creating ETL/deployer service account (local key — store in Cursor secrets only)..."
ETL_NAME="election-atlas-etl"
ETL_EMAIL="${ETL_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud iam service-accounts create "$ETL_NAME" \
  --display-name="Election Atlas ETL" 2>/dev/null || true

for role in roles/bigquery.admin roles/run.admin roles/artifactregistry.writer roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${ETL_EMAIL}" \
    --role="$role" \
    --condition=None >/dev/null
done

KEY_PATH="${HOME}/.config/chicago-election-atlas/${PROJECT_ID}-etl.json"
mkdir -p "$(dirname "$KEY_PATH")"
if [[ ! -f "$KEY_PATH" ]]; then
  gcloud iam service-accounts keys create "$KEY_PATH" --iam-account="$ETL_EMAIL"
  echo "Wrote key to $KEY_PATH (keep out of git)."
else
  echo "Key already exists at $KEY_PATH"
fi

echo
echo "Next steps:"
echo "  1. Add Cursor app secrets:"
echo "       GCP_PROJECT_ID=$PROJECT_ID"
echo "       BIGQUERY_DATASET=$DATASET"
echo "       GOOGLE_SERVICE_ACCOUNT_JSON=<contents of $KEY_PATH or base64>"
echo "  2. Export those env vars locally and run: npm run etl:bigquery"
echo "  3. Deploy: infra/scripts/deploy-cloud-run.sh $PROJECT_ID $REGION"
echo "  Or publish via Cursor hosting — the app reads the same secrets server-side."
