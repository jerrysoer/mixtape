-- Mixtape: mx_ tables (sprint 7). Every table has RLS on.
-- Ad-library tables (brands, ads, structures) hold public Meta Ad Library data written by the CLI
-- with the service role (which bypasses RLS); signed-in users may read them, anon may not.
-- User-scoped tables (clones, analytics) are owner-only through auth.uid().

create extension if not exists pgcrypto;

-- Brands and their resolved, verified Meta page
create table if not exists public.mx_brands (
  id uuid primary key default gen_random_uuid(),
  mx_name text not null check (char_length(mx_name) between 1 and 60),
  mx_page_id text not null unique check (mx_page_id ~ '^[0-9]{1,25}$'),
  mx_page_name text,
  mx_country text check (mx_country ~ '^[A-Z]{2}$'),
  mx_verified boolean not null default false,
  mx_last_pulled_at timestamptz,
  created_at timestamptz not null default now()
);

-- Ads, ranked within their brand. No video URLs: they are signed and expire.
-- Meta discloses no spend or reach for commercial ads; mx_est_reach stays null unless a source gives it.
create table if not exists public.mx_ads (
  id uuid primary key default gen_random_uuid(),
  mx_ad_id text not null unique check (mx_ad_id ~ '^[0-9]{5,25}$'),
  mx_brand_id uuid not null references public.mx_brands (id) on delete cascade,
  mx_page_id text not null,
  mx_start_date date not null,
  mx_end_date date,
  mx_is_active boolean not null,
  mx_format text not null check (mx_format in ('video', 'image', 'carousel', 'dco', 'other')),
  mx_video_count integer not null default 0 check (mx_video_count >= 0),
  mx_body_text text check (char_length(mx_body_text) <= 5000),
  mx_cta_type text,
  mx_link_url text,
  mx_days_running integer not null check (mx_days_running >= 0),
  mx_variant_count integer not null default 1 check (mx_variant_count >= 1),
  mx_est_reach integer,
  mx_winner_score numeric(4, 3) not null check (mx_winner_score between 0 and 1),
  mx_rank integer not null check (mx_rank >= 1),
  mx_pulled_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists mx_ads_brand_rank_idx on public.mx_ads (mx_brand_id, mx_rank);

-- Format breakdowns: roles and patterns only, never source lines, footage, audio or likeness
create table if not exists public.mx_structures (
  id uuid primary key default gen_random_uuid(),
  mx_ad_id text references public.mx_ads (mx_ad_id) on delete set null,
  mx_format_key text,
  mx_structure jsonb not null,
  created_at timestamptz not null default now()
);

-- A user's clone of a structure
create table if not exists public.mx_clones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  mx_structure_id uuid references public.mx_structures (id) on delete set null,
  mx_brief text check (char_length(mx_brief) <= 4000),
  mx_script jsonb,
  mx_gen_cost_usd numeric(8, 2) not null default 0 check (mx_gen_cost_usd >= 0),
  mx_status text not null default 'draft' check (mx_status in ('draft', 'quoted', 'approved', 'rendered', 'delivered')),
  created_at timestamptz not null default now()
);
create index if not exists mx_clones_user_idx on public.mx_clones (user_id);

create table if not exists public.mx_analytics_events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  mx_event text not null check (mx_event ~ '^[a-z][a-z0-9_]{0,63}$'),
  mx_props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists mx_analytics_events_user_idx on public.mx_analytics_events (user_id, created_at);

create table if not exists public.mx_analytics_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  mx_day date not null,
  mx_event text not null,
  mx_count integer not null default 0 check (mx_count >= 0),
  primary key (user_id, mx_day, mx_event)
);

alter table public.mx_brands enable row level security;
alter table public.mx_ads enable row level security;
alter table public.mx_structures enable row level security;
alter table public.mx_clones enable row level security;
alter table public.mx_analytics_events enable row level security;
alter table public.mx_analytics_daily enable row level security;

-- Ad-library data: read for signed-in users; writes only through the service role (no write policies)
create policy "mx_brands read (signed in)" on public.mx_brands for select to authenticated using (true);
create policy "mx_ads read (signed in)" on public.mx_ads for select to authenticated using (true);
create policy "mx_structures read (signed in)" on public.mx_structures for select to authenticated using (true);

-- Clones: owner only
create policy "mx_clones select own" on public.mx_clones for select to authenticated using ((select auth.uid()) = user_id);
create policy "mx_clones insert own" on public.mx_clones for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "mx_clones update own" on public.mx_clones for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "mx_clones delete own" on public.mx_clones for delete to authenticated using ((select auth.uid()) = user_id);

-- Analytics: users write and read their own events; daily rollups are written by the service role
create policy "mx_analytics_events insert own" on public.mx_analytics_events for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "mx_analytics_events select own" on public.mx_analytics_events for select to authenticated using ((select auth.uid()) = user_id);
create policy "mx_analytics_daily select own" on public.mx_analytics_daily for select to authenticated using ((select auth.uid()) = user_id);
