alter table public.profile_imports
drop constraint if exists profile_imports_user_payload_unique;

create unique index if not exists profile_imports_user_payload_active_unique
on public.profile_imports(user_id, payload_hash)
where status <> 'deleted';
