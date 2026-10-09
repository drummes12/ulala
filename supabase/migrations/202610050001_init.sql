create extension if not exists pgcrypto;

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  timezone text not null,
  invite_token_hash bytea not null unique,
  invite_created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.trip_members (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default 'Viajero' check (char_length(trim(display_name)) between 1 and 60),
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create table public.plans (
  id uuid primary key,
  trip_id uuid not null references public.trips(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  local_date date not null,
  start_time time not null,
  end_time time,
  start_at timestamptz not null,
  location text,
  notes text,
  status text not null default 'idea' check (status in ('idea', 'confirmed')),
  travel_minutes integer not null default 0 check (travel_minutes >= 0 and travel_minutes <= 1440),
  buffer_minutes integer not null default 0 check (buffer_minutes >= 0 and buffer_minutes <= 1440),
  reminder_minutes integer not null default 60 check (reminder_minutes > 0 and reminder_minutes <= 10080),
  version integer not null default 1 check (version > 0),
  deleted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index plans_trip_time_idx on public.plans (trip_id, start_at) where deleted_at is null;
create index plans_trip_updated_idx on public.plans (trip_id, updated_at);
create index plans_reminder_idx on public.plans (start_at) where deleted_at is null and status = 'confirmed';

create table public.invite_attempts (
  subject bytea not null,
  attempted_at timestamptz not null default now(),
  primary key (subject, attempted_at)
);

create index invite_attempts_time_idx on public.invite_attempts (attempted_at);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  plan_version integer not null,
  reminder_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'expired')),
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (plan_id, subscription_id, plan_version)
);

create index notification_deliveries_pending_idx on public.notification_deliveries (reminder_at) where status = 'pending';

alter table public.plans replica identity full;

create or replace function public.expire_stale_deliveries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notification_deliveries
  set status = 'expired', error = 'Plan changed before delivery'
  where plan_id = new.id
    and status = 'pending'
    and (plan_version <> new.version or new.status <> 'confirmed' or new.deleted_at is not null);
  return new;
end;
$$;

create trigger expire_stale_deliveries_after_plan_update
  after update on public.plans
  for each row
  execute function public.expire_stale_deliveries();

create or replace function public.is_trip_member(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trip_members
    where trip_id = p_trip_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.validate_timezone(p_timezone text)
returns boolean
language plpgsql
stable
as $$
begin
  perform timezone(p_timezone, now());
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.new_invite_token()
returns text
language sql
volatile
as $$
  select replace(replace(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+', '-'), '/', '_');
$$;

create or replace function public.create_trip(p_name text, p_timezone text, p_display_name text default null)
returns table (trip_id uuid, invite_token text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_token text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.validate_timezone(p_timezone) then
    raise exception 'INVALID_TIMEZONE';
  end if;

  v_token := public.new_invite_token();

  insert into public.trips (name, timezone, invite_token_hash, created_by)
  values (trim(p_name), p_timezone, extensions.digest(v_token, 'sha256'), auth.uid())
  returning id into v_trip_id;

  insert into public.trip_members (trip_id, user_id, display_name)
  values (v_trip_id, auth.uid(), coalesce(nullif(trim(p_display_name), ''), 'Viajero'));

  return query select v_trip_id, v_token;
end;
$$;

create or replace function public.record_invite_attempt()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip text;
  v_subject bytea;
begin
  begin
    v_ip := nullif(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', '');
  exception when others then
    v_ip := null;
  end;

  v_subject := extensions.digest(
    coalesce(auth.uid()::text, 'anonymous') || ':' || coalesce(left(split_part(v_ip, ',', 1), 64), 'unknown'),
    'sha256'
  );

  if (
    select count(*) from public.invite_attempts
    where subject = v_subject
      and attempted_at > now() - interval '15 minutes'
  ) >= 20 then
    raise exception 'RATE_LIMITED';
  end if;

  insert into public.invite_attempts (subject) values (v_subject);
end;
$$;

create or replace function public.join_trip(p_token text, p_display_name text default null)
returns table (trip_id uuid, trip_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip public.trips%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  perform public.record_invite_attempt();

  select * into v_trip
  from public.trips
  where invite_token_hash = extensions.digest(p_token, 'sha256');

  if v_trip.id is null then
    raise exception 'INVITE_NOT_FOUND';
  end if;

  insert into public.trip_members (trip_id, user_id, display_name)
  values (v_trip.id, auth.uid(), coalesce(nullif(trim(p_display_name), ''), 'Viajero'))
  on conflict on constraint trip_members_pkey do nothing;

  return query select v_trip.id, v_trip.name;
end;
$$;

create or replace function public.regenerate_invite(p_trip_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if not public.is_trip_member(p_trip_id) then
    raise exception 'NOT_MEMBER';
  end if;

  v_token := public.new_invite_token();

  update public.trips
  set invite_token_hash = extensions.digest(v_token, 'sha256'),
      invite_created_at = now(),
      updated_at = now()
  where id = p_trip_id;

  return v_token;
end;
$$;

create or replace function public.update_trip(p_trip_id uuid, p_name text, p_timezone text)
returns public.trips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip public.trips%rowtype;
begin
  if not public.is_trip_member(p_trip_id) then
    raise exception 'NOT_MEMBER';
  end if;

  if not public.validate_timezone(p_timezone) then
    raise exception 'INVALID_TIMEZONE';
  end if;

  update public.trips
  set name = trim(p_name), timezone = p_timezone, updated_at = now()
  where id = p_trip_id
  returning * into v_trip;

  return v_trip;
end;
$$;

create or replace function public.save_plan(p_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := (p_plan->>'id')::uuid;
  v_trip_id uuid := (p_plan->>'trip_id')::uuid;
  v_base_version integer := coalesce((p_plan->>'base_version')::integer, 0);
  v_deleted boolean := coalesce((p_plan->>'deleted')::boolean, false);
  v_existing public.plans%rowtype;
  v_saved public.plans%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_trip_member(v_trip_id) then
    raise exception 'NOT_MEMBER';
  end if;

  select * into v_existing
  from public.plans
  where id = v_id and trip_id = v_trip_id
  for update;

  if v_existing.id is not null and v_existing.version <> v_base_version then
    return jsonb_build_object('status', 'conflict', 'plan', to_jsonb(v_existing));
  end if;

  if v_existing.id is not null and v_deleted then
    update public.plans
    set deleted_at = now(), version = version + 1, updated_by = auth.uid(), updated_at = now()
    where id = v_existing.id
    returning * into v_saved;
  elsif v_existing.id is not null then
    update public.plans
    set title = trim(p_plan->>'title'),
        local_date = (p_plan->>'local_date')::date,
        start_time = (p_plan->>'start_time')::time,
        end_time = nullif(p_plan->>'end_time', '')::time,
        start_at = (p_plan->>'start_at')::timestamptz,
        location = nullif(trim(p_plan->>'location'), ''),
        notes = nullif(trim(p_plan->>'notes'), ''),
        status = p_plan->>'status',
        travel_minutes = coalesce((p_plan->>'travel_minutes')::integer, 0),
        buffer_minutes = coalesce((p_plan->>'buffer_minutes')::integer, 0),
        reminder_minutes = coalesce((p_plan->>'reminder_minutes')::integer, 60),
        deleted_at = null,
        version = version + 1,
        updated_by = auth.uid(),
        updated_at = now()
    where id = v_existing.id
    returning * into v_saved;
  elsif v_deleted then
    return jsonb_build_object('status', 'deleted');
  else
    insert into public.plans (
      id, trip_id, title, local_date, start_time, end_time, start_at, location, notes,
      status, travel_minutes, buffer_minutes, reminder_minutes, version, created_by, updated_by
    ) values (
      v_id,
      v_trip_id,
      trim(p_plan->>'title'),
      (p_plan->>'local_date')::date,
      (p_plan->>'start_time')::time,
      nullif(p_plan->>'end_time', '')::time,
      (p_plan->>'start_at')::timestamptz,
      nullif(trim(p_plan->>'location'), ''),
      nullif(trim(p_plan->>'notes'), ''),
      coalesce(nullif(p_plan->>'status', ''), 'idea'),
      coalesce((p_plan->>'travel_minutes')::integer, 0),
      coalesce((p_plan->>'buffer_minutes')::integer, 0),
      coalesce((p_plan->>'reminder_minutes')::integer, 60),
      1,
      auth.uid(),
      auth.uid()
    ) returning * into v_saved;
  end if;

  return jsonb_build_object('status', 'saved', 'plan', to_jsonb(v_saved));
end;
$$;

alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.invite_attempts enable row level security;
alter table public.plans enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_deliveries enable row level security;

create policy trips_select_member on public.trips
  for select to authenticated
  using (public.is_trip_member(id));

create policy trip_members_select_member on public.trip_members
  for select to authenticated
  using (public.is_trip_member(trip_id));

create policy trip_members_update_name on public.trip_members
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_trip_member(trip_id));

create policy plans_select_member on public.plans
  for select to authenticated
  using (public.is_trip_member(trip_id));

create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated
  using (user_id = auth.uid());

create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert to authenticated
  with check (user_id = auth.uid());

create policy push_subscriptions_update_own on public.push_subscriptions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.trips from anon, authenticated;
revoke all on public.trip_members from anon, authenticated;
revoke all on public.plans from anon, authenticated;
revoke all on public.push_subscriptions from anon, authenticated;
revoke all on public.notification_deliveries from anon, authenticated;

grant select on public.trips to authenticated;
grant select, update (display_name) on public.trip_members to authenticated;
grant select on public.plans to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

grant execute on function public.create_trip(text, text, text) to authenticated;
grant execute on function public.join_trip(text, text) to authenticated;
grant execute on function public.regenerate_invite(uuid) to authenticated;
grant execute on function public.update_trip(uuid, text, text) to authenticated;
grant execute on function public.save_plan(jsonb) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.plans';
  end if;
exception when duplicate_object then
  null;
end $$;
