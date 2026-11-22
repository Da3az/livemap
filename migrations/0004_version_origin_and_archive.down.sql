-- Reverse of 0004. Restores livemap_can_edit_map() exactly as 0002 defined it.

begin;

drop trigger if exists maps_guard_archive on maps;
drop function if exists livemap_guard_archive();

create or replace function livemap_can_edit_map(p_map_id uuid) returns boolean
language sql stable
as $$
  select case livemap_granted_role()
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
$$;

alter table map_versions
  drop constraint if exists map_versions_source_rev_range,
  drop constraint if exists map_versions_origin_shape,
  drop column origin_from_version,
  drop column origin_type,
  drop column source_rev;

commit;
