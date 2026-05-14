-- Worker-aligned schema (matches Python upload script + ingestion worker + URL ingest).
-- Run in Supabase SQL editor if the table does not exist yet.
--
-- URL-sourced jobs: insert with source_url set and s3_key null; worker fills s3_key after download + S3 upload.

create table if not exists public.cat_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  s3_key text,
  source_url text,
  overall_status text not null default 'queued',
  download_status text not null default 'pending',
  logo_status text not null default 'pending',
  ocr_status text not null default 'pending',
  metadata_status text not null default 'pending',
  logo_result jsonb not null default '{}'::jsonb,
  ocr_result jsonb not null default '{}'::jsonb,
  metadata_result jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cat_analysis_jobs_created_at_idx
  on public.cat_analysis_jobs (created_at desc);

comment on table public.cat_analysis_jobs is 'CAT ingestion jobs; UI inserts queued row (file: s3_key set; URL: source_url set, s3_key null until worker); worker updates statuses and results.';

comment on column public.cat_analysis_jobs.s3_key is 'S3 object key; null for link-only jobs until download/upload completes.';
comment on column public.cat_analysis_jobs.source_url is 'Original HTTPS/HTTP URL for link-sourced jobs; optional for file uploads.';
