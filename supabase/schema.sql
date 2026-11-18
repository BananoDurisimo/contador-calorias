-- Esquema para el Contador de Calorías en Supabase (PostgreSQL).
-- Ejecútalo en: Supabase > SQL Editor > New query > Run.
-- Se puede volver a ejecutar sin perder datos (usa "if not exists").
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
  fiber        numeric not null default 0,
  created_at   timestamptz not null default now()
);
alter table public.entries add column if not exists fiber numeric not null default 0;
create index if not exists entries_user_date_idx on public.entries (user_id, date);

-- Metas diarias + perfil (datos para calcular el plan)
create table if not exists public.goals (
  user_id  uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  kcal     numeric not null default 2100,
  protein  numeric not null default 180,
  carbs    numeric not null default 200,
  fat      numeric not null default 65,
  fiber    numeric not null default 30,
  water_ml numeric not null default 3000,
  steps    numeric not null default 8000,
  sleep_h  numeric not null default 7,
  profile  jsonb
);
alter table public.goals add column if not exists fiber    numeric not null default 30;
alter table public.goals add column if not exists water_ml numeric not null default 3000;
alter table public.goals add column if not exists steps    numeric not null default 8000;
alter table public.goals add column if not exists sleep_h  numeric not null default 7;
alter table public.goals add column if not exists profile  jsonb;

-- Registro corporal diario
create table if not exists public.body_logs (
  user_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date     date not null,
  weight   numeric,
  waist    numeric,
  steps    integer,
  sleep_h  numeric,
  water_ml integer,
  primary key (user_id, date)
);

alter table public.products  enable row level security;
alter table public.entries   enable row level security;
alter table public.goals     enable row level security;
alter table public.body_logs enable row level security;

drop policy if exists "own products" on public.products;
create policy "own products" on public.products
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own entries" on public.entries;
create policy "own entries" on public.entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own goals" on public.goals;
create policy "own goals" on public.goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own body logs" on public.body_logs;
create policy "own body logs" on public.body_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
