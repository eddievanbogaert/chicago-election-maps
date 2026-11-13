#!/usr/bin/env bash
# Build and deploy the Next.js app to Cloud Run with runtime SA (no key in image).
set -euo pipefail

PROJECT_ID="${1:-}"
REGION="${2:-us-central1}"
SERVICE="${3:-chicago-election-atlas}"
DATASET="${BIGQUERY_DATASET:-chicago_election_atlas}"
RUNTIME_SA="election-atlas-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
REPO="election-atlas"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}:$(git rev-parse --short HEAD 2>/dev/null || echo latest)"

if [[ -z "$PROJECT_ID" ]]; then
  echo "Usage: $0 <project-id> [region] [service-name]"
  exit 1
fi

gcloud config set project "$PROJECT_ID"
gcloud artifacts repositories create "$REPO" \
  --repository-format=docker \
  --location="$REGION" \
  --description="Chicago Election Atlas" 2>/dev/null || true

gcloud builds submit --tag "$IMAGE" .

gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --service-account "$RUNTIME_SA" \
  --set-env-vars "GCP_PROJECT_ID=${PROJECT_ID},BIGQUERY_DATASET=${DATASET}" \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 5

gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)'
