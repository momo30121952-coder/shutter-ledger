-- Shutter Ledger: run this once in Supabase SQL Editor (Dashboard > SQL Editor > New query)

create extension if not exists pgcrypto;

-- One row per staff/manager account, linked to Supabase Auth
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  role text not null default 'staff' check (role in ('manager', 'staff')),
  location text
);

-- One row per logged sale
create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  location text not null,
  staff_username text not null,
  amount numeric not null,
  method text not null check (method in ('cash', 'card')),
  card_photo_path text,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
alter table sales enable row level security;

-- Auto-create a profile row (as 'staff', no location yet) whenever someone signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, role, location)
  values (new.id, split_part(new.email, '@', 1), 'staff', null);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Everyone signed in can read the staff list (needed to show names + the Staff page)
drop policy if exists "profiles read" on profiles;
create policy "profiles read" on profiles for select
  using (auth.role() = 'authenticated');

-- Only managers can edit other people's role/location
drop policy if exists "profiles update by manager" on profiles;
create policy "profiles update by manager" on profiles for update
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'manager'));

-- Managers see every sale, staff only see sales for their own location
drop policy if exists "sales select" on sales;
create policy "sales select" on sales for select
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid()
      and (p.role = 'manager' or p.location = sales.location)
    )
  );

drop policy if exists "sales insert" on sales;
create policy "sales insert" on sales for insert
  with check (
    exists (
      select 1 from profiles p
      where p.id = auth.uid()
      and (p.role = 'manager' or p.location = sales.location)
    )
  );

-- Private storage bucket for card photos (not public)
insert into storage.buckets (id, name, public)
values ('card-photos', 'card-photos', false)
on conflict (id) do nothing;

drop policy if exists "card photos insert" on storage.objects;
create policy "card photos insert" on storage.objects for insert
  with check (bucket_id = 'card-photos' and auth.role() = 'authenticated');

drop policy if exists "card photos select" on storage.objects;
create policy "card photos select" on storage.objects for select
  using (
    bucket_id = 'card-photos' and
    exists (
      select 1 from profiles p
      where p.id = auth.uid()
      and (p.role = 'manager' or p.location = (storage.foldername(name))[1])
    )
  );

-- LAST STEP (do this after you've signed up your own manager account in the app):
-- update profiles set role = 'manager' where username = 'yourusername';
