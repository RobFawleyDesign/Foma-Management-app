-- ============================================================
-- Studio Desk — database setup
-- Run this ONCE in your Supabase project:
--   Supabase dashboard -> SQL Editor -> New query -> paste -> Run
-- ============================================================

-- One shared row holds the whole studio (pipeline, calendar, contacts).
create table if not exists public.studio (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Lock the table down: nobody can touch it unless they are signed in.
alter table public.studio enable row level security;

-- Because you will create ONLY your two accounts, "any signed-in user"
-- effectively means "you and your partner".
drop policy if exists "authenticated read"   on public.studio;
drop policy if exists "authenticated insert" on public.studio;
drop policy if exists "authenticated update" on public.studio;

create policy "authenticated read"
  on public.studio for select
  to authenticated using (true);

create policy "authenticated insert"
  on public.studio for insert
  to authenticated with check (true);

create policy "authenticated update"
  on public.studio for update
  to authenticated using (true) with check (true);

-- Turn on realtime so both of you see changes live.
alter publication supabase_realtime add table public.studio;

-- Seed the single shared row so the first load has something to read.
insert into public.studio (id, data)
values ('main', '{"residencies":[],"contacts":[],"events":[]}'::jsonb)
on conflict (id) do nothing;
