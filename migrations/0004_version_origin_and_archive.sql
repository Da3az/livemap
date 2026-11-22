-- 0004 — where each published version came from, and who may archive.
--
-- Versions: every row records the draft revision its content was built from
-- (`source_rev`), and whether it was a publish or a rollback. A rollback copies
-- its source's `source_rev`, so rolling back to a version that was itself a
-- rollback still knows which draft it shows. web/CONTRACT-CHANGES.md 27, 38.
--
-- Archiving: owners and admins only (web/DECISIONS.md R.5). A policy cannot
-- compare a row before and after an update, so the rule is a trigger. Features
-- of an archived map cannot be written by anyone.

begin;

-- map_versions -------------------------------------------------------------

-- 0003 emptied this table along with the maps, so the not-null columns need
-- no backfill.
alter table map_versions
  add column source_rev bigint not null,
  add column origin_type text not null default 'publish'
    check (origin_type in ('publish','rollback')),
  add column origin_from_version int;

alter table map_versions
  add constraint map_versions_origin_shape check (
    (origin_type = 'publish'  and origin_from_version is null) or
    (origin_type = 'rollback' and origin_from_version is not null)
  ),
  add constraint map_versions_source_rev_range check (source_rev >= 0);

-- archive rights -----------------------------------------------------------

-- Only the request path is held to the role rule. The migrator and the
-- platform role (reaping, provisioning) act across tenants with no role claim.
create or replace function livemap_guard_archive() returns trigger
language plpgsql
as $$
begin
  if current_user = 'livemap_app'
     and new.archived_at is distinct from old.archived_at
     and coalesce(livemap_granted_role(), '') not in ('owner','admin') then
    raise exception 'only an owner or an admin may archive or restore a map'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger maps_guard_archive
  before update of archived_at on maps
  for each row execute function livemap_guard_archive();

-- An archived map is read-only for everyone: its features refuse every write.
-- Still a single primary-key lookup, and still never called by a policy on
-- `maps` itself, so it cannot recurse.
create or replace function livemap_can_edit_map(p_map_id uuid) returns boolean
language sql stable
as $$
  select case
           when exists (
             select 1 from maps m where m.id = p_map_id and m.archived_at is not null
           ) then false
           else case livemap_granted_role()
                  when 'owner'  then true
                  when 'admin'  then true
                  when 'editor' then true
                  when 'contributor' then exists (
                    select 1
                      from maps m
                     where m.id = p_map_id
                       and m.created_by = livemap_current_user()
                  )
                  else false
                end
         end
$$;

commit;
