-- Personal Dashboard — Supabase schema, RLS policies, and storage bucket setup.
-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query -> Run).
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT DO NOTHING where possible.

create extension if not exists pgcrypto;

-- ---------- profiles (one row per user) ----------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  photo_path text not null default '',
  avatar_zoom int not null default 100,
  avatar_offset_x double precision not null default 0,
  avatar_offset_y double precision not null default 0,
  background_type text not null default 'default',
  background_value text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = user_id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = user_id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = user_id);

-- ---------- todos ----------
create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  date date not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.todos enable row level security;
drop policy if exists "todos_all_own" on public.todos;
create policy "todos_all_own" on public.todos for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- habits ----------
create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  goal_days int not null,
  log jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.habits enable row level security;
drop policy if exists "habits_all_own" on public.habits;
create policy "habits_all_own" on public.habits for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- archive items (movies & series) ----------
create table if not exists public.archive_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('movies', 'series')),
  title text not null,
  year text not null default '',
  poster text not null default '',
  tmdb_id bigint,
  status text not null default 'planned',
  rating int not null default 0,
  memo text not null default '',
  created_at timestamptz not null default now()
);
alter table public.archive_items enable row level security;
drop policy if exists "archive_all_own" on public.archive_items;
create policy "archive_all_own" on public.archive_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- diary entries ----------
create table if not exists public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  photos jsonb not null default '[]'::jsonb,
  text text not null default '',
  date date not null,
  created_at timestamptz not null default now()
);
alter table public.diary_entries enable row level security;
drop policy if exists "diary_all_own" on public.diary_entries;
create policy "diary_all_own" on public.diary_entries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- storage bucket for photos (avatar / background / diary) ----------
insert into storage.buckets (id, name, public)
values ('dashboard-media', 'dashboard-media', false)
on conflict (id) do nothing;

drop policy if exists "media_select_own" on storage.objects;
drop policy if exists "media_insert_own" on storage.objects;
drop policy if exists "media_update_own" on storage.objects;
drop policy if exists "media_delete_own" on storage.objects;

create policy "media_select_own" on storage.objects for select
  using (bucket_id = 'dashboard-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "media_insert_own" on storage.objects for insert
  with check (bucket_id = 'dashboard-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "media_update_own" on storage.objects for update
  using (bucket_id = 'dashboard-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "media_delete_own" on storage.objects for delete
  using (bucket_id = 'dashboard-media' and (storage.foldername(name))[1] = auth.uid()::text);
