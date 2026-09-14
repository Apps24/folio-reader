-- Dedicated Folio project only. Auth owns passwords; no app password table.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  customer text unique,
  paid_until bigint not null default 0 check (paid_until >= 0)
);
create table public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  author text not null default '' check (char_length(author) <= 200),
  object_key text not null unique,
  size integer not null check (size between 1 and 52428800),
  ready boolean not null default false,
  created_at timestamptz not null default now(),
  unique(id,user_id),
  check (object_key = user_id::text || '/' || id::text || '.epub')
);
create index books_owner_created on public.books(user_id,created_at desc);
create table public.reading_state (
  book_id uuid primary key,
  user_id uuid not null,
  data jsonb not null default '{}' check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 100000),
  updated_at timestamptz not null default now(),
  foreign key (book_id,user_id) references public.books(id,user_id) on delete cascade
);
create index reading_state_owner on public.reading_state(user_id);
create table public.voice_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  characters integer not null default 0 check (characters >= 0),
  primary key(user_id,month)
);

alter table public.entitlements enable row level security;
alter table public.books enable row level security;
alter table public.reading_state enable row level security;
alter table public.voice_usage enable row level security;
revoke all on public.entitlements, public.books, public.reading_state, public.voice_usage from anon, authenticated;
grant select on public.entitlements, public.books, public.reading_state, public.voice_usage to authenticated;
grant insert, delete on public.books to authenticated;
grant update (ready) on public.books to authenticated;
grant insert, update, delete on public.reading_state to authenticated;
grant all on public.entitlements, public.books, public.reading_state, public.voice_usage to service_role;

create policy entitlement_owner on public.entitlements for select to authenticated using ((select auth.uid()) = user_id);
create policy books_read on public.books for select to authenticated using ((select auth.uid()) = user_id);
create policy books_add on public.books for insert to authenticated with check ((select auth.uid()) = user_id);
create policy books_update on public.books for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy books_remove on public.books for delete to authenticated using ((select auth.uid()) = user_id);
create policy state_read on public.reading_state for select to authenticated using ((select auth.uid()) = user_id);
create policy state_add on public.reading_state for insert to authenticated with check ((select auth.uid()) = user_id);
create policy state_update on public.reading_state for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy state_remove on public.reading_state for delete to authenticated using ((select auth.uid()) = user_id);
create policy usage_read on public.voice_usage for select to authenticated using ((select auth.uid()) = user_id);

-- A private trigger locks each user's reservation stream, including direct API inserts.
-- SECURITY DEFINER is needed to read immutable entitlements under the same lock.
-- It is not an RPC and checks auth.uid before accessing any row.
create function private.enforce_book_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or auth.uid() <> new.user_id then
    raise exception 'Book owner must match the signed-in user' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 0));
  if not exists (select 1 from public.entitlements where user_id = new.user_id and paid_until > extract(epoch from now()))
    and (select count(*) from public.books where user_id = new.user_id) >= 5 then
    raise exception 'Free accounts can keep five books' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_book_limit() from public, anon, authenticated;
create trigger enforce_book_limit before insert on public.books for each row execute function private.enforce_book_limit();

-- Service-only, SECURITY INVOKER RPCs. Browsers cannot spend/refund or alter allowances.
create function public.reserve_voice(p_user uuid,p_month text,p_characters integer,p_limit integer) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  if p_characters < 1 or p_characters > 1800 or p_limit < 1 then raise exception 'Invalid allowance request'; end if;
  if not exists (select 1 from public.entitlements where user_id=p_user and paid_until>extract(epoch from now())) then return false; end if;
  insert into public.voice_usage(user_id,month,characters) values(p_user,p_month,0) on conflict do nothing;
  update public.voice_usage set characters=characters+p_characters where user_id=p_user and month=p_month and characters+p_characters<=p_limit;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;
create function public.refund_voice(p_user uuid,p_month text,p_characters integer) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if p_characters < 1 or p_characters > 1800 then raise exception 'Invalid refund'; end if;
  update public.voice_usage set characters=greatest(0,characters-p_characters) where user_id=p_user and month=p_month;
end;
$$;
revoke all on function public.reserve_voice(uuid,text,integer,integer), public.refund_voice(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.reserve_voice(uuid,text,integer,integer), public.refund_voice(uuid,text,integer) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('epubs','epubs',false,52428800,array['application/epub+zip']);
create policy epub_read on storage.objects for select to authenticated using (
  bucket_id='epubs' and (storage.foldername(name))[1]=(select auth.uid())::text
  and exists(select 1 from public.books where object_key=name and user_id=(select auth.uid()))
);
create policy epub_add on storage.objects for insert to authenticated with check (
  bucket_id='epubs' and (storage.foldername(name))[1]=(select auth.uid())::text
  and exists(select 1 from public.books where object_key=name and user_id=(select auth.uid()) and not ready)
);
create policy epub_remove on storage.objects for delete to authenticated using (
  bucket_id='epubs' and (storage.foldername(name))[1]=(select auth.uid())::text
);
