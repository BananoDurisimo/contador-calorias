-- Esquema para el Contador de Calorías en Supabase (PostgreSQL).
-- Ejecútalo una sola vez en: Supabase > SQL Editor > New query > Run.
-- Cada usuario solo puede ver y modificar sus propios datos (Row Level Security).

create table if not exists public.products (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  brand       text,
  base_type   text not null check (base_type in ('g', 'ml', 'unit')),
  base_amount numeric not null check (base_amount > 0),
  unit_label  text,
  kcal        numeric not null default 0,
  protein     numeric not null default 0,
  carbs       numeric not null default 0,
  fat         numeric not null default 0,
  fiber       numeric,
  sugar       numeric,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.entries (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date         date not null,
  meal         text not null check (meal in ('desayuno', 'almuerzo', 'cena', 'snack')),
  product_id   uuid,
  product_name text not null,
  amount       numeric not null check (amount > 0),
  unit         text not null,
  kcal         numeric not null default 0,
  protein      numeric not null default 0,
  carbs        numeric not null default 0,
  fat          numeric not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists entries_user_date_idx on public.entries (user_id, date);

create table if not exists public.goals (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  kcal    numeric not null default 2000,
  protein numeric not null default 120,
  carbs   numeric not null default 220,
  fat     numeric not null default 65
);

alter table public.products enable row level security;
alter table public.entries  enable row level security;
alter table public.goals    enable row level security;

drop policy if exists "own products" on public.products;
create policy "own products" on public.products
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own entries" on public.entries;
create policy "own entries" on public.entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own goals" on public.goals;
create policy "own goals" on public.goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
