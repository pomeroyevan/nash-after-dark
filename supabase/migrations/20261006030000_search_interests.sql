-- Older clients omit fields they do not understand. Preserve the private search
-- list on their saves while retaining owner checks and revision-based writes.
create or replace function public.save_nash_private_state(
  p_owner uuid, p_expected_revision bigint, p_payload jsonb
) returns table(applied boolean, revision bigint, payload jsonb, updated_at timestamptz)
language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_uid uuid := auth.uid();
  v_row public.nash_private_state%rowtype;
  v_payload jsonb := p_payload;
begin
  if v_uid is null or p_owner is distinct from v_uid then
    raise exception 'Account mismatch' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 or
     p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' or
     p_payload->>'version' is distinct from '1' or
     jsonb_typeof(p_payload->'history') is distinct from 'object' or
     jsonb_typeof(p_payload->'savedEventIds') is distinct from 'array' or
     (p_payload ? 'searchInterests' and jsonb_typeof(p_payload->'searchInterests') is distinct from 'object') or
     octet_length(p_payload::text) > 5242880 then
    raise exception 'Invalid backup payload or revision' using errcode = '22023';
  end if;
  if p_expected_revision = 0 then
    insert into public.nash_private_state(user_id, revision, payload)
      values(v_uid, 1, v_payload) on conflict (user_id) do nothing
      returning * into v_row;
    if found then
      return query select true, v_row.revision, v_row.payload, v_row.updated_at;
      return;
    end if;
  end if;
  select s.* into v_row from public.nash_private_state s where s.user_id = v_uid for update;
  if found and v_row.revision = p_expected_revision then
    if not (p_payload ? 'searchInterests') and v_row.payload ? 'searchInterests' then
      v_payload := p_payload || jsonb_build_object('searchInterests', v_row.payload->'searchInterests');
    end if;
    if octet_length(v_payload::text) > 5242880 then
      raise exception 'Backup payload exceeds size limit' using errcode = '22023';
    end if;
    update public.nash_private_state s set payload = v_payload,
      revision = s.revision + 1, updated_at = clock_timestamp()
      where s.user_id = v_uid returning s.* into v_row;
    return query select true, v_row.revision, v_row.payload, v_row.updated_at;
  elsif v_row.user_id is not null then
    return query select false, v_row.revision, v_row.payload, v_row.updated_at;
  else
    return query select false, 0::bigint,
      '{"version":1,"exportedAt":"","history":{},"savedEventIds":[]}'::jsonb, null::timestamptz;
  end if;
end;
$$;
revoke all on function public.save_nash_private_state(uuid, bigint, jsonb) from public, anon;
grant execute on function public.save_nash_private_state(uuid, bigint, jsonb) to authenticated;
