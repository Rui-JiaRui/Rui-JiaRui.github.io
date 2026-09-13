-- Run this in the Supabase SQL editor before deploying the Edge Function.
create table if not exists public.law_users (
  username text primary key,
  password_hash text not null,
  paper_ids text[] not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.law_attempts (
  id text primary key,
  username text not null references public.law_users(username) on delete cascade,
  paper_id text not null,
  paper_version text not null,
  started_at bigint not null,
  expires_at bigint not null,
  submitted_at bigint,
  status text not null check (status in ('in_progress', 'graded', 'submitted_ungraded', 'abandoned')),
  current_index integer not null default 0,
  answers jsonb not null default '{}'::jsonb,
  marked jsonb not null default '[]'::jsonb,
  grading jsonb,
  annotations jsonb not null default '{}'::jsonb,
  updated_at bigint not null
);

-- Upgrade an existing deployment created before cloud annotations were added.
-- This is safe to run repeatedly and fills the new field for old attempts.
alter table public.law_attempts
  add column if not exists annotations jsonb not null default '{}'::jsonb;

create index if not exists law_attempts_user_paper_idx on public.law_attempts(username, paper_id, started_at desc);

create table if not exists public.law_annotations (
  attempt_id text not null references public.law_attempts(id) on delete cascade,
  username text not null references public.law_users(username) on delete cascade,
  question_id text not null,
  content text not null default '',
  updated_at bigint not null,
  primary key (attempt_id, question_id, username)
);

alter table public.law_users enable row level security;
alter table public.law_attempts enable row level security;
alter table public.law_annotations enable row level security;

-- The Edge Function uses the service role key, while browser clients never
-- receive direct table access.

-- Non-public smoke-test account. The website does not display these
-- credentials on its login page; this row is safe to re-run.
insert into public.law_users (username, password_hash, paper_ids, enabled)
values (
  'test',
  'sha-256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  ARRAY['20260801']::text[],
  true
)
on conflict (username) do update set password_hash = excluded.password_hash, paper_ids = excluded.paper_ids, enabled = excluded.enabled;
