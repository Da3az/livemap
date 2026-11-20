-- Reverse of 0002. Restores the 0001 `tenant_isolation` policies verbatim, so a
-- database rolled back to 0001 still has tenant isolation — it only loses the
-- role layer. The policy swap is one transaction in both directions.
--
-- livemap_admin is left in place, like livemap_app: a role is cluster-level and
-- may already be referenced by a connection string outside this repo.

begin;

drop policy if exists tenants_select            on tenants;
drop policy if exists users_select              on users;
drop policy if exists memberships_select        on memberships;
drop policy if exists memberships_insert        on memberships;
drop policy if exists memberships_update        on memberships;
drop policy if exists memberships_delete        on memberships;
drop policy if exists themes_select             on themes;
drop policy if exists themes_write              on themes;
drop policy if exists assets_select             on assets;
drop policy if exists assets_write              on assets;
drop policy if exists maps_select               on maps;
drop policy if exists maps_insert               on maps;
drop policy if exists maps_update               on maps;
drop policy if exists maps_delete               on maps;
drop policy if exists features_select           on features;
drop policy if exists features_write            on features;
drop policy if exists map_versions_select       on map_versions;
drop policy if exists map_versions_insert       on map_versions;
drop policy if exists publish_requests_select   on publish_requests;
drop policy if exists publish_requests_insert   on publish_requests;
drop policy if exists publish_requests_update   on publish_requests;
drop policy if exists feeds_select              on feeds;
drop policy if exists feeds_write               on feeds;

create policy tenant_isolation on tenants
  using (id = livemap_current_tenant())
  with check (id = livemap_current_tenant());

create policy tenant_isolation on users
  using (
    exists (
      select 1 from memberships m
      where m.user_id = users.id
        and m.tenant_id = livemap_current_tenant()
    )
  );

create policy tenant_isolation on memberships
  using (tenant_id = livemap_current_tenant())
  with check (tenant_id = livemap_current_tenant());

create policy tenant_isolation on themes
  using (tenant_id = livemap_current_tenant())
  with check (tenant_id = livemap_current_tenant());

create policy tenant_isolation on assets
  using (tenant_id = livemap_current_tenant())
  with check (tenant_id = livemap_current_tenant());

create policy tenant_isolation on maps
  using (tenant_id = livemap_current_tenant())
  with check (tenant_id = livemap_current_tenant());

create policy tenant_isolation on features
  using (tenant_id = livemap_current_tenant())
  with check (tenant_id = livemap_current_tenant());

create policy tenant_isolation on map_versions
  using (tenant_id = livemap_current_tenant())
  with check (tenant_id = livemap_current_tenant());

create policy tenant_isolation on publish_requests
  using (tenant_id = livemap_current_tenant())
  with check (tenant_id = livemap_current_tenant());

create policy tenant_isolation on feeds
  using (tenant_id = livemap_current_tenant())
  with check (tenant_id = livemap_current_tenant());

drop function if exists livemap_can_edit_map(uuid);
drop function if exists livemap_granted_role();
drop function if exists livemap_current_role();
drop function if exists livemap_current_user();

commit;
