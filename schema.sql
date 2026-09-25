-- Eseguire nel SQL Editor di un progetto Supabase dedicato.
create table if not exists public.staff (id uuid primary key references auth.users(id), email text not null, role text not null check(role in ('admin','operator')), active boolean not null default true);
create table if not exists public.records (id uuid primary key, kind text not null check(kind in ('patients','appointments','reminders','documents')), data jsonb not null, version integer not null default 1);
create table if not exists public.consent_links (
 id uuid primary key,
 patient_id uuid not null references public.records(id) on delete cascade,
 token_hash text not null unique,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 used_at timestamptz,
 document_id uuid references public.records(id)
);
alter table public.staff enable row level security;
alter table public.records enable row level security;
alter table public.consent_links enable row level security;
revoke all on public.staff,public.records,public.consent_links from anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit) values ('patient-files','patient-files',false,3145728) on conflict do nothing;
create or replace function public.save_records(items jsonb) returns void language plpgsql security invoker set search_path=public as $$
declare item jsonb; old records; d jsonb;
begin
 perform pg_advisory_xact_lock(761937);
 for item in select * from jsonb_array_elements(items) loop
  select * into old from records where id=(item->>'id')::uuid;
  if found and old.version <> (item->>'version')::int then raise exception 'Dati modificati da un altro operatore. Sincronizza e riprova.'; end if;
  if found and old.kind <> item->>'kind' then raise exception 'Tipo non valido'; end if;
  d := item->'data';
  if item->>'kind'='appointments' and coalesce(d->>'cancelled','false') <> 'true' then
   if exists(select 1 from records r where r.kind='appointments' and r.id<>(item->>'id')::uuid and coalesce(r.data->>'cancelled','false')<>'true' and (r.data->>'start')::timestamptz < (d->>'end')::timestamptz and (r.data->>'end')::timestamptz > (d->>'start')::timestamptz) then raise exception 'Orario occupato da un appuntamento o impegno personale'; end if;
  end if;
  insert into records(id,kind,data) values((item->>'id')::uuid,item->>'kind',d) on conflict(id) do update set data=excluded.data,version=records.version+1;
 end loop;
end $$;
revoke execute on function public.save_records(jsonb) from public,anon,authenticated;
grant execute on function public.save_records(jsonb) to service_role;
create unique index if not exists records_external_id_unique on public.records ((data->>'externalId')) where kind='appointments' and data->>'externalId' is not null;
create index if not exists consent_links_patient_idx on public.consent_links(patient_id);
create index if not exists consent_links_expires_idx on public.consent_links(expires_at);
grant all on public.records, public.staff, public.consent_links to service_role;
