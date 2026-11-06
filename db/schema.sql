-- Early Builders Dashboard: MySQL schema (recorded copy).
-- These statements were applied to the live project database (p290_project1).
-- Tables are in dependency order: programs first, then the tables that reference it.
-- Missing values (no content yet, no credit grant, never signed in) are stored as NULL.

CREATE TABLE IF NOT EXISTS programs (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  signup_target INT UNSIGNED NOT NULL DEFAULT 0,
  account_capacity INT UNSIGNED NOT NULL DEFAULT 0,
  ceo_target INT UNSIGNED NULL COMMENT 'NULL = target still pending',
  country VARCHAR(100) NOT NULL,
  `mode` VARCHAR(20) NOT NULL DEFAULT 'demo',
  snapshot_at VARCHAR(40) NOT NULL COMMENT 'ISO-8601 snapshot time with UTC offset, kept verbatim, e.g. 2026-11-05T18:00:00-05:00',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS funnel_stages (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  program_id INT UNSIGNED NOT NULL,
  step_key VARCHAR(32) NOT NULL,
  label VARCHAR(100) NOT NULL,
  step_value INT UNSIGNED NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_funnel_program_step (program_id, step_key),
  CONSTRAINT fk_funnel_program FOREIGN KEY (program_id) REFERENCES programs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS builders (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  program_id INT UNSIGNED NOT NULL,
  builder_code VARCHAR(16) NOT NULL,
  email VARCHAR(255) NULL COMMENT 'Already masked in demo data',
  profile VARCHAR(60) NULL,
  city VARCHAR(100) NULL,
  ref_key VARCHAR(40) NULL,
  channel VARCHAR(40) NULL,
  stage VARCHAR(40) NULL,
  invited_at DATE NULL,
  signed_up_at DATE NULL,
  credits_granted_at DATE NULL,
  credits INT UNSIGNED NOT NULL DEFAULT 0,
  last_sign_in DATE NULL,
  sign_ins INT UNSIGNED NOT NULL DEFAULT 0,
  projects INT UNSIGNED NOT NULL DEFAULT 0,
  credits_used INT UNSIGNED NOT NULL DEFAULT 0,
  content_url VARCHAR(500) NULL,
  content_at DATE NULL,
  UNIQUE KEY uq_builders_code (builder_code),
  KEY idx_builders_program (program_id),
  CONSTRAINT fk_builders_program FOREIGN KEY (program_id) REFERENCES programs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS data_sources (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  program_id INT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  purpose VARCHAR(255) NULL,
  state VARCHAR(40) NULL,
  method VARCHAR(120) NULL,
  last_sync VARCHAR(60) NULL,
  needs VARCHAR(255) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  KEY idx_sources_program (program_id),
  CONSTRAINT fk_sources_program FOREIGN KEY (program_id) REFERENCES programs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Synced source data (HubSpot, GA4, PostHog), written by lib/sync.js + lib/metrics-repo.js.
-- Credentials are never stored here: they live only in the service environment variables.

-- Daily metrics. The unique key makes every sync an upsert over the LAUNCH_DATE..today window.
CREATE TABLE IF NOT EXISTS source_metrics (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  program_id INT UNSIGNED NOT NULL,
  source VARCHAR(32) NOT NULL,
  metric VARCHAR(64) NOT NULL,
  metric_date DATE NOT NULL,
  dim VARCHAR(32) NOT NULL DEFAULT '',
  dim_value VARCHAR(191) NOT NULL DEFAULT '',
  `value` DECIMAL(20,4) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_source_metric (program_id, source, metric, metric_date, dim, dim_value),
  KEY idx_metrics_lookup (program_id, metric, metric_date),
  CONSTRAINT fk_metrics_program FOREIGN KEY (program_id) REFERENCES programs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Person-level rows: HubSpot form sign-ups (form_signup) and invitation recipients (invite),
-- PostHog verified accounts (builder). Only the email DOMAIN and, when EMAIL_HASH_KEY is set,
-- an HMAC-SHA256 of the normalized email are kept. Never the email itself.
CREATE TABLE IF NOT EXISTS source_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  program_id INT UNSIGNED NOT NULL,
  source VARCHAR(32) NOT NULL,
  external_id VARCHAR(64) NOT NULL,
  kind VARCHAR(40) NOT NULL,
  event_date DATE NULL,
  site_host VARCHAR(191) NULL,
  channel VARCHAR(100) NULL,
  country VARCHAR(100) NULL,
  is_internal TINYINT(1) NOT NULL DEFAULT 0,
  domain_type VARCHAR(16) NULL,
  email_domain VARCHAR(191) NULL COMMENT 'Only the domain, never the full email',
  email_hash CHAR(64) NULL COMMENT 'HMAC-SHA256 of the normalized email (EMAIL_HASH_KEY); never the email itself',
  attributes JSON NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_source_event (program_id, source, external_id, kind),
  KEY idx_events_date (program_id, source, event_date),
  KEY idx_events_hash (program_id, kind, email_hash),
  CONSTRAINT fk_events_program FOREIGN KEY (program_id) REFERENCES programs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Aggregate snapshots (totals, coverage flags, attribution tables) as JSON, one per key and period.
CREATE TABLE IF NOT EXISTS source_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  program_id INT UNSIGNED NOT NULL,
  source VARCHAR(32) NOT NULL,
  snap_key VARCHAR(64) NOT NULL,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  note VARCHAR(500) NULL,
  rows_json JSON NOT NULL,
  pulled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_source_snapshot (program_id, source, snap_key, period_from, period_to),
  CONSTRAINT fk_snapshots_program FOREIGN KEY (program_id) REFERENCES programs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Published content recorded by hand in the Builders view (POST api/builders/:code/content).
-- One row per builder (pseudonymous code from PostHog). Active = project created + this row.
CREATE TABLE IF NOT EXISTS builder_content (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  program_id INT UNSIGNED NOT NULL,
  builder_code VARCHAR(16) NOT NULL,
  url VARCHAR(500) NOT NULL,
  platform VARCHAR(60) NULL,
  published_at DATE NOT NULL,
  recorded_by VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_content_builder (program_id, builder_code),
  CONSTRAINT fk_content_program FOREIGN KEY (program_id) REFERENCES programs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per connector run: status running / ok / error, duration, row counts and the error text.
CREATE TABLE IF NOT EXISTS sync_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  program_id INT UNSIGNED NOT NULL,
  source VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL,
  started_at DATETIME(3) NOT NULL,
  finished_at DATETIME(3) NULL,
  duration_ms INT UNSIGNED NULL,
  metrics_count INT UNSIGNED NOT NULL DEFAULT 0,
  events_count INT UNSIGNED NOT NULL DEFAULT 0,
  snapshots_count INT UNSIGNED NOT NULL DEFAULT 0,
  error VARCHAR(500) NULL,
  KEY idx_runs_source (program_id, source, started_at),
  CONSTRAINT fk_runs_program FOREIGN KEY (program_id) REFERENCES programs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
