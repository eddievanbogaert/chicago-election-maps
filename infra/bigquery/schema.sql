-- Chicago Election Atlas BigQuery schema
-- Apply after creating dataset: chicago_election_atlas (or $BIGQUERY_DATASET)

CREATE TABLE IF NOT EXISTS elections (
  election_id STRING NOT NULL,
  year INT64 NOT NULL,
  round STRING NOT NULL, -- general | runoff
  label STRING NOT NULL,
  source_url STRING
);

CREATE TABLE IF NOT EXISTS candidates (
  election_id STRING NOT NULL,
  office STRING NOT NULL, -- mayor | alderman
  ward INT64,              -- null for mayor
  candidate_name STRING NOT NULL
);

CREATE TABLE IF NOT EXISTS results (
  election_id STRING NOT NULL,
  office STRING NOT NULL,
  ward INT64 NOT NULL,
  precinct INT64,
  registered_voters INT64,
  ballots_cast INT64,
  candidate_name STRING NOT NULL,
  votes INT64 NOT NULL
);

CREATE TABLE IF NOT EXISTS geographies (
  election_id STRING NOT NULL,
  geography_level STRING NOT NULL, -- ward | precinct
  ward INT64 NOT NULL,
  precinct INT64,
  geom GEOGRAPHY
);

CREATE TABLE IF NOT EXISTS demographics (
  geo_id STRING NOT NULL,
  name STRING,
  ward INT64,
  lon FLOAT64,
  lat FLOAT64,
  total_pop FLOAT64,
  median_age FLOAT64,
  median_income FLOAT64,
  pct_bachelor_plus FLOAT64,
  pct_hispanic FLOAT64,
  pct_black FLOAT64,
  pct_white FLOAT64,
  pct_asian FLOAT64,
  geom GEOGRAPHY,
  acs_vintage STRING
);
