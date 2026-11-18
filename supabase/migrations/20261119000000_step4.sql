-- =============================================================================
-- GeoBoard ステップ4：項目単位のマージ・衝突の記録、変更履歴・操作ログ、通知、台帳の重複検出と統合
-- Supabase の SQL Editor でこのファイルの内容をまるごと実行する（初期スキーマの実行後に1回だけ）。
-- =============================================================================

create schema if not exists extensions;
create extension if not exists fuzzystrmatch with schema extensions;

-- -----------------------------------------------------------------------------
-- 列の追加
-- -----------------------------------------------------------------------------
-- field_updated_at：項目ごとの最終更新 {"項目名": {"at": 日時, "by": ユーザーID}}
-- sync_base：端末が送る「編集を始めたときの値」{"項目名": 値}。サーバーには残さない（トリガーで消す）
alter table public.ledgers add column field_updated_at jsonb not null default '{}'::jsonb;
alter table public.ledgers add column sync_base jsonb;
alter table public.records add column field_updated_at jsonb not null default '{}'::jsonb;
alter table public.records add column sync_base jsonb;

-- -----------------------------------------------------------------------------
-- 変更履歴・操作ログ（要件4.3・7.3）
-- -----------------------------------------------------------------------------
create table public.change_logs (
  id uuid primary key default gen_random_uuid(),
  target_table text not null,
  target_id uuid not null,
  action text not null check (action in ('create', 'update', 'delete', 'restore', 'merge', 'unmerge', 'conflict_overwrite')),
  field text,
  before jsonb,
  after jsonb,
  user_id uuid references auth.users (id),
  -- 衝突で上書きされた内容を書いたユーザー
  overwritten_user_id uuid references auth.users (id),
  created_at timestamptz not null default clock_timestamp()
);
create index change_logs_target on public.change_logs (target_id, created_at desc);
create index change_logs_created_at on public.change_logs (created_at desc);

alter table public.change_logs enable row level security;
create policy change_logs_select on public.change_logs for select to authenticated using (public.is_active_member());
grant select on public.change_logs to authenticated;

-- -----------------------------------------------------------------------------
-- 通知（要件6.1・6.2・7.3）
-- -----------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('conflict', 'duplicate_candidate', 'provisional_customer')),
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  server_updated_at timestamptz not null default clock_timestamp()
);
create index notifications_user on public.notifications (user_id, server_updated_at);

create function public.guard_notification_update() returns trigger
language plpgsql as $$
begin
  -- 変えられるのは既読の印だけ
  new.id := old.id; new.user_id := old.user_id; new.type := old.type; new.payload := old.payload; new.created_at := old.created_at;
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger t10_guard before update on public.notifications for each row execute function public.guard_notification_update();

alter table public.notifications enable row level security;
create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, update (read_at) on public.notifications to authenticated;

-- 管理者全員（と、指定したユーザー）に通知する
-- p_skip_self：操作した本人には送らない（衝突の通知）
create function public.notify(p_type text, p_payload jsonb, p_extra_user uuid default null, p_skip_self boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, type, payload)
  select user_id, p_type, p_payload from public.profiles
  where ((role = 'admin' and not disabled) or user_id = p_extra_user)
    and not (p_skip_self and user_id is not distinct from auth.uid());
end;
$$;

-- -----------------------------------------------------------------------------
-- 重複ではないと判定したペア（要件6.2）。ledger_a < ledger_b の順で持つ
-- -----------------------------------------------------------------------------
create table public.duplicate_dismissals (
  ledger_a uuid not null references public.ledgers (id),
  ledger_b uuid not null references public.ledgers (id),
  dismissed_by uuid references auth.users (id),
  created_at timestamptz not null default clock_timestamp(),
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (ledger_a, ledger_b),
  check (ledger_a < ledger_b)
);

create function public.set_dismissed_by() returns trigger
language plpgsql as $$
begin
  new.dismissed_by := auth.uid();
  return new;
end;
$$;
create trigger t10_dismissed_by before insert on public.duplicate_dismissals for each row execute function public.set_dismissed_by();

alter table public.duplicate_dismissals enable row level security;
create policy duplicate_dismissals_select on public.duplicate_dismissals for select to authenticated using (public.is_active_member());
create policy duplicate_dismissals_insert on public.duplicate_dismissals for insert to authenticated with check (public.is_admin());
grant select, insert on public.duplicate_dismissals to authenticated;

-- -----------------------------------------------------------------------------
-- 項目単位のマージと変更履歴（要件7.3）
-- -----------------------------------------------------------------------------

-- 履歴に残さず、衝突も判定しない項目（撮影のたびに変わる黒板の前回値、写真の保存場所など）
create function public.is_silent_field(f text) returns boolean
language sql immutable as $$
  select f in ('last_board', 'composite_path', 'original_path', 'thumb_path', 'image_width', 'image_height');
$$;

-- 端末から送られても受け付けない項目
create function public.is_meta_field(f text) returns boolean
language sql immutable as $$
  select f in ('id', 'created_by', 'created_at', 'updated_at', 'server_updated_at', 'field_updated_at', 'sync_base');
$$;

-- 統合・統合の取り消し（merge_ledgers / unmerge_ledger）の中では、個々の変更を履歴に残さない
create function public.logging_suppressed() returns boolean
language sql stable as $$
  select coalesce(current_setting('geoboard.suppress_log', true), '') = '1';
$$;

create function public.log_change(p_table text, p_id uuid, p_action text, p_field text, p_before jsonb, p_after jsonb, p_overwritten uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.logging_suppressed() then return; end if;
  insert into public.change_logs (target_table, target_id, action, field, before, after, user_id, overwritten_user_id)
  values (p_table, p_id, p_action, p_field, p_before, p_after, auth.uid(), p_overwritten);
end;
$$;

/*
  台帳・作業記録の更新（端末からの送信）
  - sync_base がある場合：端末で編集した項目だけを反映する（ほかの項目はサーバーの値のまま）。
    編集を始めたときの値とサーバーの今の値が違い、その値を書いたのが別の人なら「衝突」として、
    上書きされる内容を conflict_overwrite で履歴に残し、上書きされた人と管理者に通知する。
    同じ項目は後から送信した内容を採用する
  - sync_base がない場合（古い版のアプリなど）：端末の更新日時が新しければ行ごと反映する
*/
create function public.merge_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  base jsonb := new.sync_base;
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  result jsonb := to_jsonb(old);
  meta jsonb := coalesce(old.field_updated_at, '{}'::jsonb);
  me text := coalesce(auth.uid()::text, '');
  f text;
  last_by text;
  act text;
  label text;
begin
  if base is null then
    if new.updated_at < old.updated_at then
      return old;
    end if;
    -- 行ごと反映する場合も、変わった項目は履歴に残す
    for f in select jsonb_object_keys(n) loop
      if public.is_meta_field(f) or (n -> f) is not distinct from (o -> f) then continue; end if;
      if not public.is_silent_field(f) then
        act := case when f = 'deleted_at' then (case when n -> f = 'null'::jsonb then 'restore' else 'delete' end) else 'update' end;
        perform public.log_change(tg_table_name, old.id, act, case when act = 'update' then f end, o -> f, n -> f);
      end if;
      meta := jsonb_set(meta, array[f], jsonb_build_object('at', clock_timestamp(), 'by', me));
    end loop;
    new.field_updated_at := meta;
    new.sync_base := null;
    return new;
  end if;

  for f in select jsonb_object_keys(base) loop
    if public.is_meta_field(f) or not (o ? f) then continue; end if;
    if (n -> f) is not distinct from (o -> f) then continue; end if;
    if public.is_silent_field(f) then
      result := jsonb_set(result, array[f], n -> f);
      continue;
    end if;
    last_by := coalesce(meta -> f ->> 'by', old.created_by::text, '');
    act := case when f = 'deleted_at' then (case when n -> f = 'null'::jsonb then 'restore' else 'delete' end) else 'update' end;
    if act = 'update' and (o -> f) is distinct from (base -> f) and last_by <> me and last_by <> '' then
      -- 衝突：別の人が先に変えた内容を上書きする
      perform public.log_change(tg_table_name, old.id, 'conflict_overwrite', f, o -> f, n -> f, last_by::uuid);
      if not public.logging_suppressed() then
        label := o ->> 'name';
        perform public.notify('conflict', jsonb_build_object(
          'table', tg_table_name, 'target_id', old.id, 'field', f,
          'ledger_id', case when tg_table_name = 'records' then o ->> 'ledger_id' else old.id::text end,
          'by', me, 'overwritten', last_by, 'label', label), last_by::uuid, true);
      end if;
    else
      perform public.log_change(tg_table_name, old.id, act, case when act = 'update' then f end, o -> f, n -> f);
    end if;
    result := jsonb_set(result, array[f], n -> f);
    meta := jsonb_set(meta, array[f], jsonb_build_object('at', clock_timestamp(), 'by', me));
  end loop;

  result := result || jsonb_build_object('field_updated_at', meta, 'sync_base', null, 'updated_at', to_jsonb(greatest(old.updated_at, new.updated_at)));
  new := jsonb_populate_record(new, result);
  return new;
end;
$$;

-- 台帳・作業記録は、古い更新を行ごと捨てる処理から、項目単位のマージに切り替える
drop trigger t20_ignore_stale on public.ledgers;
drop trigger t20_ignore_stale on public.records;
create trigger t20_merge before update on public.ledgers for each row execute function public.merge_update();
create trigger t20_merge before update on public.records for each row execute function public.merge_update();

-- 顧客・追加写真の変更履歴（行ごと反映のまま、変わった項目を残す）
create function public.log_simple_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  f text;
  act text;
begin
  for f in select jsonb_object_keys(n) loop
    if public.is_meta_field(f) or public.is_silent_field(f) or f in ('path', 'thumb_path', 'code') then continue; end if;
    if (n -> f) is not distinct from (o -> f) then continue; end if;
    act := case when f = 'deleted_at' then (case when n -> f = 'null'::jsonb then 'restore' else 'delete' end) else 'update' end;
    perform public.log_change(tg_table_name, old.id, act, case when act = 'update' then f end, o -> f, n -> f);
  end loop;
  return null;
end;
$$;
create trigger t95_log after update on public.customers for each row execute function public.log_simple_update();
create trigger t95_log after update on public.record_extras for each row execute function public.log_simple_update();

-- 作成の履歴
create function public.log_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.log_change(tg_table_name, new.id, 'create', null, null, null);
  return null;
end;
$$;
do $$
declare
  t text;
begin
  foreach t in array array['customers', 'ledgers', 'records', 'record_extras'] loop
    execute format('create trigger t95_log_insert after insert on public.%1$s for each row execute function public.log_insert()', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 台帳の重複検出（要件6.2）
-- 同じ顧客の台帳で、工事名称を正規化（全角半角・大文字小文字・空白・記号）して
-- 一方が他方を含む（短い方が2文字以上）、または文字の違いが少ない（短い方が3〜4文字なら1文字、5文字以上なら2文字まで）ものを候補とする
-- -----------------------------------------------------------------------------
create function public.normalize_ledger_name(s text) returns text
language sql immutable as $$
  select regexp_replace(lower(normalize(coalesce(s, ''), NFKC)), '[[:space:][:punct:]・「」『』（）【】〔〕［］｛｝〈〉《》、。，．：；！？ー－―‐~～]', '', 'g');
$$;

create function public.ledger_names_similar(a text, b text) returns boolean
language plpgsql immutable set search_path = public, extensions as $$
declare
  x text := public.normalize_ledger_name(a);
  y text := public.normalize_ledger_name(b);
  shortest int := least(char_length(x), char_length(y));
begin
  if x = '' or y = '' then return false; end if;
  if x = y then return true; end if;
  if shortest >= 2 and (position(x in y) > 0 or position(y in x) > 0) then return true; end if;
  if shortest < 3 then return false; end if;
  return extensions.levenshtein(x, y) <= case when shortest <= 4 then 1 else 2 end;
end;
$$;

create function public.detect_duplicate_ledgers() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  other record;
  a uuid;
  b uuid;
begin
  if new.deleted_at is not null or new.merged_into is not null then return null; end if;
  if tg_op = 'UPDATE' and new.name is not distinct from old.name and new.customer_id is not distinct from old.customer_id
     and old.deleted_at is not distinct from new.deleted_at and old.merged_into is not distinct from new.merged_into then
    return null;
  end if;
  for other in
    select l.id, l.name from public.ledgers l
    where l.customer_id = new.customer_id and l.id <> new.id and l.deleted_at is null and l.merged_into is null
      and public.ledger_names_similar(l.name, new.name)
  loop
    a := least(new.id, other.id);
    b := greatest(new.id, other.id);
    if exists (select 1 from public.duplicate_dismissals d where d.ledger_a = a and d.ledger_b = b) then continue; end if;
    -- 同じペアの通知は1回だけ
    if exists (select 1 from public.notifications n where n.type = 'duplicate_candidate' and n.payload ->> 'ledger_a' = a::text and n.payload ->> 'ledger_b' = b::text) then continue; end if;
    perform public.notify('duplicate_candidate', jsonb_build_object(
      'ledger_a', a, 'ledger_b', b, 'customer_id', new.customer_id,
      'names', jsonb_build_array(new.name, other.name)));
  end loop;
  return null;
end;
$$;
create trigger t96_duplicates after insert or update on public.ledgers for each row execute function public.detect_duplicate_ledgers();

-- 仮顧客が作られたら管理者に知らせる（要件6.1）
create function public.notify_provisional_customer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_provisional and new.deleted_at is null then
    perform public.notify('provisional_customer', jsonb_build_object('customer_id', new.id, 'name', new.name));
  end if;
  return null;
end;
$$;
create trigger t96_provisional after insert on public.customers for each row execute function public.notify_provisional_customer();

-- -----------------------------------------------------------------------------
-- 台帳の統合と取り消し（管理者のみ。要件6.2）
-- -----------------------------------------------------------------------------

-- 統合済みの台帳に後から送られてきた作業記録は、統合先の台帳に入れる（圏外で撮った記録など）
create function public.redirect_merged_ledger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  target uuid;
  hops int := 0;
begin
  loop
    select merged_into into target from public.ledgers where id = new.ledger_id;
    exit when target is null or hops > 10;
    new.ledger_id := target;
    hops := hops + 1;
  end loop;
  return new;
end;
$$;
create trigger t15_redirect before insert on public.records for each row execute function public.redirect_merged_ledger();

/*
  source の台帳を target に統合する。
  p_fields：target に残す値 {"name": ..., "start_date": ..., "end_date": ..., "manager": ..., "note": ...}
  source の作業記録を target に移し、source は merged_into を設定して非表示にする（削除はしない）
*/
create function public.merge_ledgers(p_target uuid, p_source uuid, p_fields jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.ledgers;
  s public.ledgers;
  moved jsonb;
  before_fields jsonb;
  now_ts timestamptz := clock_timestamp();
begin
  if not public.is_admin() then raise exception '権限がありません'; end if;
  select * into t from public.ledgers where id = p_target for update;
  select * into s from public.ledgers where id = p_source for update;
  if t.id is null or s.id is null then raise exception '台帳が見つかりません'; end if;
  if t.id = s.id then raise exception '同じ台帳は統合できません'; end if;
  if s.merged_into is not null or t.merged_into is not null then raise exception 'すでに統合された台帳です'; end if;

  before_fields := jsonb_build_object('name', t.name, 'start_date', t.start_date, 'end_date', t.end_date, 'manager', t.manager, 'note', t.note);
  select coalesce(jsonb_agg(id), '[]'::jsonb) into moved from public.records where ledger_id = s.id;

  perform set_config('geoboard.suppress_log', '1', true);
  update public.ledgers set
    name = coalesce(p_fields ->> 'name', t.name),
    start_date = case when p_fields ? 'start_date' then nullif(p_fields ->> 'start_date', '')::date else t.start_date end,
    end_date = case when p_fields ? 'end_date' then nullif(p_fields ->> 'end_date', '')::date else t.end_date end,
    manager = coalesce(p_fields ->> 'manager', t.manager),
    note = coalesce(p_fields ->> 'note', t.note),
    sync_base = null,
    updated_at = now_ts
  where id = t.id;
  update public.records set ledger_id = t.id, updated_at = greatest(updated_at, now_ts), sync_base = null where ledger_id = s.id;
  update public.ledgers set merged_into = t.id, updated_at = now_ts, sync_base = null where id = s.id;
  perform set_config('geoboard.suppress_log', '', true);

  insert into public.change_logs (target_table, target_id, action, before, after, user_id)
  values ('ledgers', t.id, 'merge',
    jsonb_build_object('target_fields', before_fields),
    jsonb_build_object('source', s.id, 'source_name', s.name, 'fields', p_fields, 'moved_records', moved),
    auth.uid());
end;
$$;

-- 統合を取り消す：統合で移した作業記録を元の台帳に戻し、統合先の項目を統合前の値に戻す
create function public.unmerge_ledger(p_source uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.ledgers;
  log public.change_logs;
  now_ts timestamptz := clock_timestamp();
  bf jsonb;
begin
  if not public.is_admin() then raise exception '権限がありません'; end if;
  select * into s from public.ledgers where id = p_source for update;
  if s.id is null or s.merged_into is null then raise exception '統合されていない台帳です'; end if;
  select * into log from public.change_logs
    where action = 'merge' and target_id = s.merged_into and after ->> 'source' = s.id::text
    order by created_at desc limit 1;

  perform set_config('geoboard.suppress_log', '1', true);
  if log.id is not null then
    update public.records set ledger_id = s.id, updated_at = greatest(updated_at, now_ts), sync_base = null
      where ledger_id = s.merged_into and id in (select (jsonb_array_elements_text(log.after -> 'moved_records'))::uuid);
    bf := log.before -> 'target_fields';
    update public.ledgers set
      name = coalesce(bf ->> 'name', name),
      start_date = nullif(bf ->> 'start_date', '')::date,
      end_date = nullif(bf ->> 'end_date', '')::date,
      manager = coalesce(bf ->> 'manager', manager),
      note = coalesce(bf ->> 'note', note),
      updated_at = now_ts,
      sync_base = null
    where id = s.merged_into;
  end if;
  update public.ledgers set merged_into = null, updated_at = now_ts, sync_base = null where id = s.id;
  perform set_config('geoboard.suppress_log', '', true);

  insert into public.change_logs (target_table, target_id, action, before, after, user_id)
  values ('ledgers', s.merged_into, 'unmerge', null, jsonb_build_object('source', s.id, 'source_name', s.name), auth.uid());
end;
$$;

grant execute on function public.merge_ledgers(uuid, uuid, jsonb), public.unmerge_ledger(uuid) to authenticated;
revoke execute on function public.notify(text, jsonb, uuid, boolean), public.log_change(text, uuid, text, text, jsonb, jsonb, uuid) from public, anon, authenticated;
