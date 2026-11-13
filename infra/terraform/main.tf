terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.40"
    }
  }
}

variable "project_id" {
  type = string
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "dataset_id" {
  type    = string
  default = "chicago_election_atlas"
}

provider "google" {
  project = var.project_id
  region  = var.region
}

resource "google_project_service" "services" {
  for_each = toset([
    "bigquery.googleapis.com",
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "iam.googleapis.com",
    "secretmanager.googleapis.com",
  ])
  service            = each.key
  disable_on_destroy = false
}

resource "google_bigquery_dataset" "atlas" {
  dataset_id                 = var.dataset_id
  location                   = "US"
  friendly_name              = "Chicago Election Atlas"
  delete_contents_on_destroy = false
  depends_on                 = [google_project_service.services]
}

resource "google_service_account" "runtime" {
  account_id   = "election-atlas-runtime"
  display_name = "Election Atlas runtime"
}

resource "google_project_iam_member" "runtime_bq_viewer" {
  project = var.project_id
  role    = "roles/bigquery.dataViewer"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_project_iam_member" "runtime_bq_jobs" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_artifact_registry_repository" "repo" {
  location      = var.region
  repository_id = "election-atlas"
  format        = "DOCKER"
  depends_on    = [google_project_service.services]
}

output "runtime_service_account" {
  value = google_service_account.runtime.email
}

output "dataset_id" {
  value = google_bigquery_dataset.atlas.dataset_id
}
