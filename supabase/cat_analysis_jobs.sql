-- Worker-aligned schema (matches Python upload script + ingestion worker).
-- Run in Supabase SQL editor if the table does not exist yet.

create table if not exists public.cat_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  s3_key text not null,
  overall_status text not null default 'queued',
  download_status text not null default 'pending',
  logo_status text not null default 'pending',
  ocr_status text not null default 'pending',
  logo_result jsonb not null default '{}'::jsonb,
  ocr_result jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cat_analysis_jobs_created_at_idx
  on public.cat_analysis_jobs (created_at desc);

comment on table public.cat_analysis_jobs is 'CAT ingestion jobs; UI inserts queued row; worker updates statuses and results.';
