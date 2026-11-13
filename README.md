# Chicago Election Atlas

Interactive map of Chicago municipal elections (2015, 2019, 2023) — mayor and City Council, first rounds and runoffs — plus a demographic explorer.

Election results are sourced from the [Chicago Board of Elections](https://www.chicagoelections.gov/election-results) via the curated [DataMade chicago-municipal-elections](https://github.com/datamade/chicago-municipal-elections) archive. Demographics use ACS 5-year estimates (BigQuery public datasets when connected).

## Architecture

- **Next.js** app with MapLibre GL (zoomable choropleth)
- **BigQuery** for election results, geographies, and ACS demographics
- Server-only API routes — credentials never ship to the browser or the public repo
- **Sample ward-level data** under `data/sample/` so the UI runs without GCP

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Without GCP secrets the app uses sample ward aggregates.

Rebuild sample data from upstream CSVs:

```bash
npm run etl:sample
```

## Secure GCP setup

Do **not** commit service-account keys. Store them in Cursor app secrets or Secret Manager.

1. Create a project and IAM (requires `gcloud` locally):

```bash
chmod +x infra/scripts/*.sh
./infra/scripts/bootstrap-gcp.sh YOUR_PROJECT_ID YOUR_BILLING_ACCOUNT
```

Or apply `infra/terraform` with `project_id` set.

2. Add Cursor / runtime secrets (never paste into chat):

| Secret | Purpose |
| --- | --- |
| `GCP_PROJECT_ID` | GCP project id |
| `BIGQUERY_DATASET` | Dataset id (default `chicago_election_atlas`) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | ETL / Cursor hosting SA JSON (raw or base64) |

3. Load data:

```bash
export GCP_PROJECT_ID=...
export BIGQUERY_DATASET=chicago_election_atlas
export GOOGLE_SERVICE_ACCOUNT_JSON="$(cat ~/.config/chicago-election-atlas/YOUR_PROJECT_ID-etl.json)"
npm run etl:bigquery
```

4. Deploy to Cloud Run (uses runtime SA + ADC — no key in the image):

```bash
./infra/scripts/deploy-cloud-run.sh YOUR_PROJECT_ID us-central1
```

Cloud Run sets `GCP_PROJECT_ID` / `BIGQUERY_DATASET` and attaches `election-atlas-runtime` (BigQuery jobUser + dataViewer only).

## Cursor publish

The app can also be published with Cursor hosting. Bind the three secrets above; until they are set the published app serves sample data and switches to BigQuery automatically after secrets are added and data is loaded.

## Modes

- **Mayor** — citywide winner by ward for general / runoff
- **Council** — filter by ward for aldermanic contests
- **Demographics** — ACS metrics (tract-level via BigQuery; ward proxies in sample mode)

## Attribution

- Chicago Board of Election Commissioners
- [datamade/chicago-municipal-elections](https://github.com/datamade/chicago-municipal-elections)
- U.S. Census Bureau ACS (BigQuery public data)
