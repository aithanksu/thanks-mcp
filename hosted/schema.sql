-- What a thanks stores, and the rules every insert meets: cut by scripts/export-mcp.sh from the Thanks app's
-- migrations (supabase/migrations, then supabase/pending), never edited by hand. Reference only: it is not applied
-- here. public.thanks is its create table plus every alter table in order; each function and trigger is its last
-- definition. COLLECTION.md says what each part enforces.

-- from supabase/migrations/20261114000000_init.sql
-- One row per owner, resource and UTC day. This row IS the dedupe and the one-vote-a-day cap.
create table public.thanks (
  id          bigint generated always as identity primary key,
  owner_id    uuid   not null references public.owners (id) on delete cascade,
  resource_id bigint not null references public.resources (id) on delete cascade,
  day         date   not null,
  agent_id    uuid   not null references public.agents (id) on delete cascade,
  kind        text   not null check (kind in ('cited', 'read', 'tool_call', 'task_done')),
  weight      smallint not null check (weight between 1 and 5),
  flagged     boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (owner_id, resource_id, day)
);

-- from supabase/migrations/20261114000000_init.sql
alter table public.thanks           enable row level security;

-- from supabase/migrations/20261119000000_v2_expand.sql
alter table public.thanks
  add column public_id    text,
  add column used_at      timestamptz,
  add column url          text check (char_length(url) between 1 and 2048),
  add column why          text check (char_length(why) between 1 and 120),
  add column task_kind    text not null default 'other'
    check (task_kind in ('coding', 'research', 'data', 'writing', 'ops', 'shopping', 'other')),
  add column task_hash    bytea check (octet_length(task_hash) = 32),
  add column score_weight numeric(2, 1) check (score_weight >= 0),
  add column status       text not null default 'counted' check (status in ('counted', 'held', 'rejected')),
  add column hold_reason  text check (char_length(hold_reason) <= 200);

-- from supabase/migrations/20261119000000_v2_expand.sql
alter table public.thanks
  alter column public_id set default private.new_id('thx'), alter column public_id set not null,
  alter column used_at set default date_trunc('second', now()), alter column used_at set not null,
  alter column score_weight set default 0.1, alter column score_weight set not null,
  drop constraint thanks_owner_id_resource_id_day_key;

-- from supabase/migrations/20261122000000_links_expand.sql
create table private.identity_usage (
  identity text    not null check (identity ~ '^(gh:[0-9]{1,19}|owner:[0-9a-f-]{36})$'),
  day      date    not null,
  n        integer not null default 0 check (n between 0 and 500),
  primary key (identity, day)
);

-- from supabase/migrations/20261122000000_links_expand.sql
-- New rows carry no task kind. The column stays: sealed v2 leaves hashed it, and their receipts read it.
alter table public.thanks alter column task_kind drop not null, alter column task_kind drop default;

-- from supabase/migrations/20261122000000_links_expand.sql
-- NOT VALID first, so every insert and update is held to it at once; old rows are checked here and the
-- constraint validated when they all pass. If some fail, it stays NOT VALID and the count is reported.
alter table public.thanks
  add constraint thanks_url_link check (url ~ '^https?://[a-z0-9.-]+(/[^?#[:space:]]*)?$') not valid;

-- from supabase/pending/20261122000100_links_contract.sql
alter table public.thanks drop column why, drop column task_hash;

-- from supabase/migrations/20261122000000_links_expand.sql
-- The one number. The counter's own check repeats it, so a changed function cannot lift the wall alone.
create function private.daily_cap() returns integer
language sql immutable set search_path = '' as $$
  select 500
$$;

-- from supabase/migrations/20261122000000_links_expand.sql
create function private.identity_of(p_github_id bigint, p_owner uuid) returns text
language sql immutable set search_path = '' as $$
  select case when p_github_id is not null then 'gh:' || p_github_id else 'owner:' || p_owner end
$$;

-- from supabase/migrations/20261122000000_links_expand.sql
-- Takes the owner's identity row for today, locked until the transaction ends, and returns its count.
-- Null for an unknown owner. Security definer: the service role runs it and never touches the table itself.
create function private.lock_identity(p_owner uuid) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_identity text;
  v_day      date := (now() at time zone 'utc')::date;
  v_n        integer;
begin
  -- FOR SHARE: a github_id change (and its fold) waits for this call, and this call reads the id after it.
  select private.identity_of(o.github_id, o.id) into v_identity from public.owners o where o.id = p_owner for share;
  if v_identity is null then
    return null;
  end if;
  insert into private.identity_usage (identity, day) values (v_identity, v_day) on conflict do nothing;
  select u.n into v_n from private.identity_usage u where u.identity = v_identity and u.day = v_day for update;
  return v_n;
end $$;

-- from supabase/migrations/20261122000000_links_expand.sql
-- The owner's identity count today, 0 when it has none.
create function private.identity_used(p_owner uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select u.n from public.owners o
                     join private.identity_usage u
                       on u.identity = private.identity_of(o.github_id, o.id) and u.day = (now() at time zone 'utc')::date
                    where o.id = p_owner), 0)
$$;

-- from supabase/migrations/20261122000000_links_expand.sql
-- Every insert into public.thanks, from any role and any path: lock the identity row, refuse at the cap, count.
create function private.count_thanks() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_identity text;
  v_day      date := (now() at time zone 'utc')::date;
  v_n        integer;
begin
  select private.identity_of(o.github_id, o.id) into v_identity from public.owners o where o.id = new.owner_id for share;
  if v_identity is null then
    return new; -- no such owner: the foreign key refuses the row
  end if;
  insert into private.identity_usage (identity, day) values (v_identity, v_day) on conflict do nothing;
  select u.n into v_n from private.identity_usage u where u.identity = v_identity and u.day = v_day for update;
  if v_n >= private.daily_cap() then
    raise exception 'thanks cap: % thanks a UTC day per GitHub identity', private.daily_cap()
      using errcode = 'check_violation', constraint = 'thanks_daily_cap';
  end if;
  update private.identity_usage u set n = u.n + 1 where u.identity = v_identity and u.day = v_day;
  return new;
end $$;

-- from supabase/migrations/20261122000000_links_expand.sql
create trigger thanks_daily_cap before insert on public.thanks
  for each row execute function private.count_thanks();

-- from supabase/migrations/20261122000000_links_expand.sql
-- The board a kind lands on, as resources_kind_category checks it. Null for a kind the contract does not know.
create function private.kind_category(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_kind = 'site' then 'sites'
    when p_kind = 'docs' then 'docs'
    when p_kind = 'api' then 'apis'
    when p_kind = 'mcp' then 'mcp'
    when p_kind in ('repo', 'brew', 'docker', 'extension', 'tool') then 'tools'
    when p_kind in ('npm', 'pypi', 'crate', 'gem', 'go', 'packagist', 'nuget', 'pub', 'hex', 'maven', 'jsr') then 'packages'
  end
$$;

-- from supabase/migrations/20261122000000_links_expand.sql
create function private.thank_items(p_owner uuid, p_agent uuid, p_items jsonb)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_now    timestamptz := now();
  v_at     timestamptz := date_trunc('second', now());
  v_day    date := (now() at time zone 'utc')::date;
  o        record;
  v_used   integer;
  v_limit  integer;
  v_new    integer := 0;
  v_weight numeric(2, 1);
  v_status text;
  v_hold   text;
  v_self   text;
  v_cat    text;
  v_res    record;
  v_id     text;
  v_skip   text;
  v_acc    jsonb := '[]';
  v_skp    jsonb := '[]';
  it       record;
begin
  v_used := private.lock_identity(p_owner);
  select status, daily_budget, github_login, github_created_at into o from public.owners where id = p_owner;
  if v_used is null or not found then
    return jsonb_build_object('error', 'unauthorized');
  end if;
  v_limit := least(private.daily_cap(), o.daily_budget);
  v_weight := private.age_weight(o.github_created_at, v_now);
  v_status := case when o.status = 'active' then 'counted' else 'held' end;
  v_hold := case when o.status <> 'active' then 'owner held' end;
  v_self := lower(o.github_login);

  for it in
    select (x ->> 'i')::integer as i, x ->> 'kind' as kind, x ->> 'key' as key, x ->> 'name' as name,
           x ->> 'canonical_url' as canonical_url, x ->> 'url' as url
      from jsonb_array_elements(p_items) as e(x)
     order by x ->> 'key', (x ->> 'i')::integer -- one lock order for every call, so calls never deadlock
  loop
    v_skip := null;
    v_id := null;
    v_cat := private.kind_category(it.kind);
    select id, status, claimed_by into v_res from public.resources where key = it.key;
    -- The resolver never sends one of these: a malformed item is skipped, never the whole call.
    if coalesce(it.key, '') = '' or coalesce(it.name, '') = '' or coalesce(it.canonical_url, '') = '' or v_cat is null
       or char_length(it.key) > 300 or char_length(it.name) > 300 or char_length(it.canonical_url) > 2048
       or it.url is null or char_length(it.url) > 2048 or it.url !~ '^https?://[a-z0-9.-]+(/[^?#[:space:]]*)?$'
       or (it.kind in ('site', 'tool') and it.key !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$') then
      v_skip := 'invalid';
    -- Your own work under your login, in each key format that names a GitHub owner. Go module paths keep their case.
    elsif (v_self is not null and (starts_with(lower(it.key), 'github:' || v_self || '/')
                                   or starts_with(lower(it.key), 'mcp:github:' || v_self || '/')
                                   or starts_with(lower(it.key), 'mcp:io.github.' || v_self || '/')
                                   or starts_with(lower(it.key), 'mcp:glama:@' || v_self || '/')
                                   or starts_with(lower(it.key), 'mcp:smithery:@' || v_self || '/')
                                   or starts_with(lower(it.key), 'go:github.com/' || v_self || '/')
                                   or lower(it.key) = v_self || '.github.io'
                                   or starts_with(lower(it.key), v_self || '.github.io/')))
          or v_res.claimed_by = p_owner then
      v_skip := 'self';
    elsif v_res.id is not null and exists (
      select 1 from public.thanks t
       where t.agent_id = p_agent and t.resource_id = v_res.id and t.used_at > v_at - interval '30 minutes'
    ) then
      v_skip := 'duplicate';
    elsif v_used >= v_limit then
      v_skip := 'no_coins';
    elsif v_res.status = 'hidden' then
      v_skip := 'invalid';
    end if;

    if v_skip is null then
      if v_res.id is null then
        insert into public.resources (kind, key, category, display_name, canonical_url, type, identifier)
        values (it.kind, it.key, v_cat, it.name, it.canonical_url,
                case when it.kind in ('site', 'tool') then 'website' end, case when it.kind in ('site', 'tool') then it.key end)
        on conflict (key) do nothing
        returning id, status, claimed_by into v_res;
        if v_res.id is null then
          select id, status, claimed_by into v_res from public.resources where key = it.key;
        end if;
      end if;
      -- day, kind and weight keep the v1 readers working. No ON CONFLICT: the cap trigger runs before any
      -- conflict check, so a skipped row would still count.
      insert into public.thanks (owner_id, resource_id, day, agent_id, kind, weight, used_at, url, score_weight, status, hold_reason)
      values (p_owner, v_res.id, v_day, p_agent, 'cited', 1, v_at, it.url, v_weight, v_status, v_hold)
      returning public_id into v_id;
      v_used := v_used + 1;
      v_new := v_new + 1;
      v_acc := v_acc || jsonb_build_object('i', it.i, 'id', v_id, 'key', it.key, 'weight', v_weight, 'status', v_status);
    else
      v_skp := v_skp || jsonb_build_object('i', it.i, 'reason', v_skip);
    end if;
  end loop;

  -- What this owner spent today, for the dashboard. The cap reads the identity row, never this one.
  insert into public.owner_usage as u (owner_id, day, points) values (p_owner, v_day, v_new)
  on conflict (owner_id, day) do update set points = u.points + excluded.points;
  v_used := private.identity_used(p_owner);
  return jsonb_build_object('accepted', v_acc, 'skipped', v_skp, 'coins_left', greatest(v_limit - v_used, 0),
                            'used', v_used, 'budget', v_limit);
end $$;

-- from supabase/migrations/20261122000000_links_expand.sql
-- Same signature as before. p_task_kind and p_task_id are the old contract's: accepted from old clients, never read.
create or replace function public.say_thanks(p_key_hash bytea, p_items jsonb, p_task_kind text, p_task_id text)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  k     record;
  v_out jsonb;
begin
  select ak.id as key_id, ak.last_used_at as key_used, ak.owner_id, a.id as agent_id, a.public_id as agent, a.last_used_at as agent_used
    into k
    from public.api_keys ak
    join public.agents a on a.id = ak.agent_id
    join public.owners o on o.id = ak.owner_id
   where ak.key_hash = p_key_hash
     and ak.revoked_at is null and a.revoked_at is null
     and o.deleted_at is null and o.status <> 'banned' and not o.banned;
  if not found then
    return jsonb_build_object('error', 'unauthorized');
  end if;

  v_out := private.thank_items(k.owner_id, k.agent_id, coalesce(p_items, '[]'));
  if v_out ? 'error' then
    return v_out;
  end if;
  if k.key_used is null or k.key_used < now() - interval '1 hour' then
    update public.api_keys set last_used_at = now() where id = k.key_id;
  end if;
  if k.agent_used is null or k.agent_used < now() - interval '1 hour' then
    update public.agents set last_used_at = now() where id = k.agent_id;
  end if;
  return jsonb_build_object('agent', k.agent, 'accepted', v_out -> 'accepted', 'skipped', v_out -> 'skipped',
                            'coins_left', v_out -> 'coins_left');
end $$;

