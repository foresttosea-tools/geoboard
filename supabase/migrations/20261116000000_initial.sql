-- =============================================================================
-- GeoBoard 初期スキーマ（ステップ3）
-- Supabase の SQL Editor でこのファイルの内容をまるごと実行する。
-- 標準的な PostgreSQL の機能だけで書いてあり、セルフホスト版にもそのまま流せる。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 共通：ユーザー（profiles）と権限判定
-- -----------------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  role text not null default 'member' check (role in ('admin', 'member')),
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 有効なユーザー（停止されていない）か
create function public.is_active_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and not disabled);
$$;

-- 有効な管理者か
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and not disabled and role = 'admin');
$$;

-- プロフィールがある（停止中でも）か。停止されたユーザーも未送信データだけは送れるようにする（要件4.1）
create function public.has_profile() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid());
$$;

-- ユーザーが作られたらプロフィールを自動作成。最初の1人は管理者にする
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, display_name, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)),
    case when exists (select 1 from public.profiles) then 'member' else 'admin' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 一般ユーザーは自分の表示名だけ変更できる。権限・停止の変更は管理者のみ
create function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    if new.user_id <> auth.uid() or new.role <> old.role or new.disabled <> old.disabled then
      raise exception '権限がありません';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger guard_profile_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

alter table public.profiles enable row level security;
create policy profiles_select on public.profiles for select to authenticated using (public.has_profile());
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_admin() or user_id = auth.uid()) with check (public.is_admin() or user_id = auth.uid());
grant select, update on public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- 共通トリガー
-- -----------------------------------------------------------------------------

-- 作成者はサーバー側で決める（端末から送られた値は使わない）
create function public.set_created_by() returns trigger
language plpgsql as $$
begin
  new.created_by := auth.uid();
  return new;
end;
$$;

-- 差分取得用のサーバー更新日時
create function public.touch_server_updated_at() returns trigger
language plpgsql as $$
begin
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

-- 端末の更新日時が古い更新は無視する（後から来た古いデータで上書きしない）。
-- 項目単位のマージと衝突の記録はステップ4で追加する
create function public.ignore_stale_update() returns trigger
language plpgsql as $$
begin
  if new.updated_at < old.updated_at then
    return old;
  end if;
  return new;
end;
$$;

-- 論理削除の権限：管理者のみ。作業記録・追加写真・作成した黒板は作成者も可（要件4.2）
create function public.guard_soft_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is distinct from old.deleted_at and not public.is_admin() then
    if tg_table_name in ('records', 'record_extras', 'blackboard_templates') and old.created_by = auth.uid() then
      return new;
    end if;
    raise exception '削除する権限がありません';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 顧客
-- -----------------------------------------------------------------------------
create sequence public.customer_code_seq;

create table public.customers (
  id uuid primary key,
  code text unique,
  name text not null,
  is_provisional boolean not null default false,
  merged_into uuid references public.customers (id),
  created_by uuid references auth.users (id),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp()
);

-- 正式な顧客には顧客コードを自動採番する（仮顧客は確定時に採番。要件6.1）
create function public.assign_customer_code() returns trigger
language plpgsql as $$
begin
  if not new.is_provisional and new.code is null then
    new.code := 'C-' || lpad(nextval('public.customer_code_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create trigger t40_code before insert or update on public.customers
  for each row execute function public.assign_customer_code();

-- -----------------------------------------------------------------------------
-- 台帳
-- -----------------------------------------------------------------------------
create table public.ledgers (
  id uuid primary key,
  customer_id uuid not null references public.customers (id),
  name text not null,
  start_date date,
  end_date date,
  manager text not null default '',
  note text not null default '',
  last_board jsonb,
  merged_into uuid references public.ledgers (id),
  created_by uuid references auth.users (id),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp()
);
create index ledgers_customer_id on public.ledgers (customer_id);

-- -----------------------------------------------------------------------------
-- 作業記録
-- -----------------------------------------------------------------------------
create table public.records (
  id uuid primary key,
  ledger_id uuid not null references public.ledgers (id),
  mode text not null check (mode in ('with_board', 'without_board', 'both')),
  board jsonb,
  board_layout jsonb,
  memo text not null default '',
  handover text not null default '',
  handover_in_report boolean not null default false,
  shot_at timestamptz not null,
  shot_date_needs_check boolean not null default false,
  source text not null check (source in ('camera', 'import')),
  latitude double precision,
  longitude double precision,
  location_accuracy double precision,
  image_width int not null,
  image_height int not null,
  composite_path text,
  original_path text,
  thumb_path text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp()
);
create index records_ledger_id on public.records (ledger_id);

-- -----------------------------------------------------------------------------
-- 追加写真
-- -----------------------------------------------------------------------------
create table public.record_extras (
  id uuid primary key,
  record_id uuid not null references public.records (id),
  source text not null check (source in ('camera', 'import')),
  width int not null,
  height int not null,
  path text,
  thumb_path text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp()
);
create index record_extras_record_id on public.record_extras (record_id);

-- -----------------------------------------------------------------------------
-- 作成した黒板
-- -----------------------------------------------------------------------------
create table public.blackboard_templates (
  id uuid primary key,
  name text not null,
  content jsonb not null,
  last_used_at timestamptz not null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp()
);

-- -----------------------------------------------------------------------------
-- トリガーとアクセス制御（顧客・台帳・作業記録・追加写真・作成した黒板で共通）
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['customers', 'ledgers', 'records', 'record_extras', 'blackboard_templates'] loop
    -- 同じタイミングのトリガーは名前順に動くため、番号で順序を固定する
    execute format('create trigger t10_created_by before insert on public.%1$s for each row execute function public.set_created_by()', t);
    execute format('create trigger t20_ignore_stale before update on public.%1$s for each row execute function public.ignore_stale_update()', t);
    execute format('create trigger t30_soft_delete before update on public.%1$s for each row execute function public.guard_soft_delete()', t);
    execute format('create trigger t90_touch before insert or update on public.%1$s for each row execute function public.touch_server_updated_at()', t);
    execute format('create index %1$s_server_updated_at on public.%1$s (server_updated_at)', t);

    execute format('alter table public.%s enable row level security', t);
    -- 読み取り・更新は有効なユーザーのみ
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_active_member())', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (public.is_active_member()) with check (public.is_active_member())', t);
    -- 追加は停止中のユーザーも可（未送信データを送り切るため。要件4.1）
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_profile())', t);
    -- 物理削除は不可（論理削除のみ）
    execute format('grant select, insert, update on public.%s to authenticated', t);
  end loop;
end;
$$;

-- 停止中のユーザーが追加する作業記録・追加写真は、未送信データの送信に限る（顧客・台帳・黒板の新規作成は不可）
create function public.guard_disabled_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_member() and tg_table_name not in ('records', 'record_extras') then
    raise exception 'アカウントが停止されています';
  end if;
  return new;
end;
$$;

create trigger t05_disabled before insert on public.customers for each row execute function public.guard_disabled_insert();
create trigger t05_disabled before insert on public.ledgers for each row execute function public.guard_disabled_insert();
create trigger t05_disabled before insert on public.blackboard_templates for each row execute function public.guard_disabled_insert();

grant usage on sequence public.customer_code_seq to authenticated;
grant execute on function public.is_active_member(), public.is_admin(), public.has_profile() to authenticated;

-- -----------------------------------------------------------------------------
-- 写真の保存先（Storage）
-- パス：{customer_id}/{ledger_id}/{record_id}_composite.jpg など（要件5.4）
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

create policy photos_select on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.is_active_member());
create policy photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.has_profile());
create policy photos_update on storage.objects for update to authenticated
  using (bucket_id = 'photos' and public.is_active_member())
  with check (bucket_id = 'photos' and public.is_active_member());
create policy photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.is_admin());
