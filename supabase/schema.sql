create table if not exists public.dayglass_sync (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  active_device_id text,
  active_seen_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.dayglass_sync enable row level security;

drop policy if exists "dayglass read own sync" on public.dayglass_sync;
create policy "dayglass read own sync"
on public.dayglass_sync for select
using (auth.uid() = user_id);

drop policy if exists "dayglass insert own sync" on public.dayglass_sync;
create policy "dayglass insert own sync"
on public.dayglass_sync for insert
with check (auth.uid() = user_id);

create table if not exists public.dayglass_sync_keys (
  sync_key_hash text primary key,
  state jsonb not null default '{}'::jsonb,
  active_device_id text,
  active_seen_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.dayglass_sync_keys enable row level security;

drop policy if exists "dayglass key read" on public.dayglass_sync_keys;
create policy "dayglass key read"
on public.dayglass_sync_keys for select
using (true);

drop policy if exists "dayglass key insert" on public.dayglass_sync_keys;
create policy "dayglass key insert"
on public.dayglass_sync_keys for insert
with check (true);

drop policy if exists "dayglass key update" on public.dayglass_sync_keys;
create policy "dayglass key update"
on public.dayglass_sync_keys for update
using (true)
with check (true);

drop policy if exists "dayglass update own sync" on public.dayglass_sync;
create policy "dayglass update own sync"
on public.dayglass_sync for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
