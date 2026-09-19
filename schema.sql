-- Eseguire nel SQL Editor di un progetto Supabase dedicato.
create table public.staff (id uuid primary key references auth.users(id), email text not null, role text not null check(role in ('admin','operator')), active boolean not null default true);
create table public.records (id uuid primary key, kind text not null check(kind in ('patients','appointments','reminders','documents')), data jsonb not null, version integer not null default 1);
alter table public.staff enable row level security;
alter table public.records enable row level security;
revoke all on public.staff,public.records from anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit) values ('patient-files','patient-files',false,3145728) on conflict do nothing;
create function public.save_records(items jsonb) returns void language plpgsql security invoker set search_path=public as $$
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
create unique index records_external_id_unique on public.records ((data->>'externalId')) where kind='appointments' and data->>'externalId' is not null;
grant all on public.records, public.staff to service_role;
