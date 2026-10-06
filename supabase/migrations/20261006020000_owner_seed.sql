-- Load an owner's backup privately through the management connection after this
-- migration and before signup. Never put an email or backup payload in migrations.
-- Confirm Email must remain enabled until the owner has verified the account.
create schema if not exists nash_private;
revoke all on schema nash_private from public, anon, authenticated;

create table if not exists nash_private.owner_seed (
  email text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint owner_seed_normalized_email check (
    email <> '' and email = pg_catalog.lower(pg_catalog.btrim(email))
  ),
  constraint owner_seed_valid_backup check ((
    pg_catalog.jsonb_typeof(payload) = 'object' and
    payload->'version' = '1'::jsonb and
    pg_catalog.jsonb_typeof(payload->'history') = 'object' and
    pg_catalog.jsonb_typeof(payload->'savedEventIds') = 'array' and
    pg_catalog.octet_length(payload::text) <= 5242880
  ) is true)
);
alter table nash_private.owner_seed enable row level security;
revoke all on nash_private.owner_seed from public, anon, authenticated;

-- This server-only trigger copies exactly one matching seed. Existing account
-- data wins; retries or other signup triggers must never replace a newer backup.
create or replace function nash_private.seed_owner_state()
returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  insert into public.nash_private_state(user_id, revision, payload)
    select new.id, 1, seed.payload
    from nash_private.owner_seed as seed
    where seed.email = pg_catalog.lower(pg_catalog.btrim(new.email))
    on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function nash_private.seed_owner_state() from public, anon, authenticated;

create trigger nash_seed_owner_state_on_signup
  after insert on auth.users
  for each row execute function nash_private.seed_owner_state();
