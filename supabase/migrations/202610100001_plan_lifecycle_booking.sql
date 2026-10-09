alter table public.plans
  drop constraint plans_status_check,
  add constraint plans_status_check check (status in ('idea', 'confirmed', 'done')),
  add column if not exists booking_status text not null default 'none'
    check (booking_status in ('none', 'not_required', 'recommended', 'required', 'booked'));

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
        booking_status = coalesce(nullif(p_plan->>'booking_status', ''), 'none'),
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
      status, booking_status, travel_minutes, buffer_minutes, reminder_minutes,
      version, created_by, updated_by
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
      coalesce(nullif(p_plan->>'booking_status', ''), 'none'),
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
