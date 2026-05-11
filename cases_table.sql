create table public.cat_analysis_jobs (
  id uuid not null default gen_random_uuid (),
  s3_key text not null,
  overall_status text not null default 'queued'::text,
  download_status text not null default 'pending'::text,
  logo_status text not null default 'pending'::text,
  ocr_status text not null default 'pending'::text,
  metadata_status text not null default 'pending'::text,
  logo_result jsonb not null default '{}'::jsonb,
  ocr_result jsonb not null default '{}'::jsonb,
  metadata_result jsonb not null default '{}'::jsonb,
  error_message text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint cat_analysis_jobs_pkey primary key (id),
  constraint cat_analysis_jobs_download_status_check check (
    (
      download_status = any (
        array['pending'::text, 'done'::text, 'failed'::text]
      )
    )
  ),
  constraint cat_analysis_jobs_logo_status_check check (
    (
      logo_status = any (
        array[
          'pending'::text,
          'running'::text,
          'done'::text,
          'failed'::text,
          'skipped'::text
        ]
      )
    )
  ),
  constraint cat_analysis_jobs_ocr_status_check check (
    (
      ocr_status = any (
        array[
          'pending'::text,
          'running'::text,
          'done'::text,
          'failed'::text,
          'skipped'::text
        ]
      )
    )
  ),
  constraint cat_analysis_jobs_metadata_status_check check (
    (
      metadata_status = any (
        array[
          'pending'::text,
          'running'::text,
          'done'::text,
          'failed'::text,
          'skipped'::text
        ]
      )
    )
  ),
  constraint cat_analysis_jobs_overall_status_check check (
    (
      overall_status = any (
        array[
          'queued'::text,
          'processing'::text,
          'completed'::text,
          'failed'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_cat_analysis_jobs_status_created on public.cat_analysis_jobs using btree (overall_status, created_at desc) TABLESPACE pg_default;

create trigger trg_cat_analysis_jobs_updated_at BEFORE
update on cat_analysis_jobs for EACH row
execute FUNCTION set_cat_analysis_jobs_updated_at ();