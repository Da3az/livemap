-- 0002_role_aware_rls — move the role model out of Fastify and into the database.
--
-- 0001 enabled row-level security but every policy was `for all` with a single
-- `tenant_id = livemap_current_tenant()` predicate. Tenant isolation was real;
-- role enforcement was not, and lived only in packages/api. A missing check in
-- a route had no backstop. This migration adds one.
--
-- Three things change:
--   1. Two new GUCs are read — app.user_id and app.role — so a policy can see
--      who is acting, not only which tenant they belong to.
--   2. Each table's single `for all` policy becomes a `for select` policy with
--      the old predicate plus per-command write policies that also require a
--      role. Reads are unchanged, so `viewer` keeps working exactly as before.
--   3. A `livemap_admin` role carries bypassrls for cross-tenant platform work,
--      so that work stops borrowing the migration role.
--
-- Additive: no column is added, dropped or rewritten, and no row is touched.
-- The policy swap happens inside this transaction, so there is no instant at
-- which a table is left with row-level security enabled and no policy.

begin;

-- ---------------------------------------------------------------------------
-- Session context
-- ---------------------------------------------------------------------------

-- Same failure shape as livemap_current_tenant(): when the GUC is unset the
-- result is NULL, every comparison against it is NULL, and the row is excluded.
-- An unset context denies; it never widens.
--
-- The shape test is deliberate rather than a bare `::uuid` cast. A cast raises
-- 22P02 (invalid_text_representation) on malformed input, and because this is
-- evaluated inside a policy that would surface as a 500 from a write rather
-- than a refusal. Unparseable input has to deny like absent input does.
-- (livemap_current_tenant() in 0001 predates this and still casts directly;
-- its argument comes from the same signed token, so it is not reachable with
-- garbage in practice.)
create or replace function livemap_current_user() returns uuid
language sql stable
as $$
  select case
           when current_setting('app.user_id', true)
                ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then current_setting('app.user_id', true)::uuid
         end
$$;

create or replace function livemap_current_role() returns text
language sql stable
as $$ select nullif(current_setting('app.role', true), '') $$;

-- The authoritative role, and the reason this is not just a GUC comparison.
--
-- app.role is set by the application from a signed session token, so a client
-- cannot forge it — but a token outlives the membership it was minted from. A
-- user demoted from editor to viewer keeps a valid editor token until it
-- expires. So the GUC is treated as a *claim* and honoured only where a
-- membership row in this tenant still grants exactly that role. The effective
-- role is therefore the intersection of what the token says and what the
-- database records, which is never wider than either.
--
-- security invoker (the default) is deliberate: the lookup runs under the
-- caller, so memberships' own policies apply to it. That policy is tenant-only
-- and calls no function, which is also what stops this from recursing when it
-- is evaluated for a write to memberships itself.
create or replace function livemap_granted_role() returns text
language sql stable
as $$
  select m.role
    from memberships m
   where m.tenant_id = livemap_current_tenant()
     and m.user_id   = livemap_current_user()
     and m.role      = livemap_current_role()
$$;

-- Row ownership, for the one role that has it. owner/admin/editor may edit any
-- map in their tenant; a contributor may edit only maps they created. Used by
-- features, where the owning map is a join away rather than a column.
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

-- ---------------------------------------------------------------------------
-- Replace the 0001 policies
-- ---------------------------------------------------------------------------

drop policy tenant_isolation on tenants;
drop policy tenant_isolation on users;
drop policy tenant_isolation on memberships;
drop policy tenant_isolation on themes;
drop policy tenant_isolation on assets;
drop policy tenant_isolation on maps;
drop policy tenant_isolation on features;
drop policy tenant_isolation on map_versions;
drop policy tenant_isolation on publish_requests;
drop policy tenant_isolation on feeds;

-- tenants — readable, never writable through the application. Provisioning a
-- tenant is cross-tenant by nature and belongs to the bypassrls role.
create policy tenants_select on tenants
  for select using (id = livemap_current_tenant());

-- users — global rows, so visibility comes from a shared membership rather than
-- a tenant_id column. No write policy: user records are provisioned, not edited
-- by the application.
create policy users_select on users
  for select using (
    exists (
      select 1 from memberships m
      where m.user_id = users.id
        and m.tenant_id = livemap_current_tenant()
    )
  );

-- memberships — who may change who can do what. owner and admin only.
create policy memberships_select on memberships
  for select using (tenant_id = livemap_current_tenant());

create policy memberships_insert on memberships
  for insert with check (
    tenant_id = livemap_current_tenant()
    and livemap_granted_role() in ('owner','admin')
  );

create policy memberships_update on memberships
  for update using (
    tenant_id = livemap_current_tenant()
    and livemap_granted_role() in ('owner','admin')
  ) with check (
    tenant_id = livemap_current_tenant()
    and livemap_granted_role() in ('owner','admin')
  );

create policy memberships_delete on memberships
  for delete using (
    tenant_id = livemap_current_tenant()
    and livemap_granted_role() in ('owner','admin')
  );

-- themes and assets — house style. Editing roles may change them; a
-- contributor may not, because a theme change affects every map in the tenant
-- and is not scoped to one author's work.
create policy themes_select on themes
  for select using (tenant_id = livemap_current_tenant());

create policy themes_write on themes
  for all using (
    tenant_id = livemap_current_tenant()
    and livemap_granted_role() in ('owner','admin','editor')
  ) with check (
    tenant_id = livemap_current_tenant()
    and livemap_granted_role() in ('owner','admin','editor')
  );

create policy assets_select on assets
  for select using (tenant_id = livemap_current_tenant());

create policy assets_write on assets
  for all using (
    tenant_id = livemap_current_tenant()
    and livemap_granted_role() in ('owner','admin','editor')
  ) with check (
    tenant_id = livemap_current_tenant()
    and livemap_granted_role() in ('owner','admin','editor')
  );

-- maps — every role in the tenant reads; the four editing roles write. The
-- ownership test is written inline rather than through livemap_can_edit_map()
-- so that a policy on maps never selects from maps.
create policy maps_select on maps
  for select using (tenant_id = livemap_current_tenant());

create policy maps_insert on maps
  for insert with check (
    tenant_id = livemap_current_tenant()
    and livemap_granted_role() in ('owner','admin','editor','contributor')
  );

create policy maps_update on maps
  for update using (
    tenant_id = livemap_current_tenant()
    and (
      livemap_granted_role() in ('owner','admin','editor')
      or (
        livemap_granted_role() = 'contributor'
        and created_by = livemap_current_user()
      )
    )
  ) with check (
    tenant_id = livemap_current_tenant()
    and (
      livemap_granted_role() in ('owner','admin','editor')
      or (
        livemap_granted_role() = 'contributor'
        and created_by = livemap_current_user()
      )
    )
  );

-- Deleting a map destroys its features and its version ledger by cascade, so it
-- is not a contributor's to do even for their own map. Archiving is an update.
create policy maps_delete on maps
  for delete using (
    tenant_id = livemap_current_tenant()
    and livemap_granted_role() in ('owner','admin')
  );

-- features — the hot write path. One PK lookup per row through
-- livemap_can_edit_map(), which short-circuits to true for the three
-- unrestricted roles and only touches maps for a contributor.
create policy features_select on features
  for select using (tenant_id = livemap_current_tenant());

create policy features_write on features
  for all using (
    tenant_id = livemap_current_tenant()
    and livemap_can_edit_map(map_id)
  ) with check (
    tenant_id = livemap_current_tenant()
    and livemap_can_edit_map(map_id)
  );

-- map_versions — the published ledger. Insert requires a publishing role, and
-- there is deliberately no update or delete policy: append-only is an invariant
-- of the read path (readers hold immutable artifacts keyed by these rows), so
-- the database enforces it rather than trusting every future call site.
create policy map_versions_select on map_versions
  for select using (tenant_id = livemap_current_tenant());

create policy map_versions_insert on map_versions
  for insert with check (
    tenant_id = livemap_current_tenant()
    and livemap_granted_role() in ('owner','admin','editor')
  );

-- publish_requests — a contributor MAY insert one: submitting for review is
-- precisely what a role that cannot publish is supposed to do instead.
-- Deciding the request needs a role that could have published it directly.
create policy publish_requests_select on publish_requests
  for select using (tenant_id = livemap_current_tenant());

create policy publish_requests_insert on publish_requests
  for insert with check (
    tenant_id = livemap_current_tenant()
    and livemap_granted_role() in ('owner','admin','editor','contributor')
  );

create policy publish_requests_update on publish_requests
  for update using (
    tenant_id = livemap_current_tenant()
    and livemap_granted_role() in ('owner','admin','editor')
  ) with check (
    tenant_id = livemap_current_tenant()
    and livemap_granted_role() in ('owner','admin','editor')
  );

-- feeds — cadence is the pricing axis, so changing a feed is an account-level
-- act rather than an editorial one.
create policy feeds_select on feeds
  for select using (tenant_id = livemap_current_tenant());

create policy feeds_write on feeds
  for all using (
    tenant_id = livemap_current_tenant()
    and livemap_granted_role() in ('owner','admin')
  ) with check (
    tenant_id = livemap_current_tenant()
    and livemap_granted_role() in ('owner','admin')
  );

-- ---------------------------------------------------------------------------
-- Platform role
-- ---------------------------------------------------------------------------

-- Cross-tenant work — provisioning a tenant, a support query, a backfill — has
-- had no path but the migration role, which also owns the schema. Separating
-- them means a platform operation cannot accidentally run DDL, and revoking
-- platform access does not revoke the ability to migrate.
--
-- bypassrls is the whole point of this role and the reason it must never be the
-- connection the request path uses. serve.mjs asserts that at boot.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'livemap_admin') then
    execute format(
      'create role livemap_admin login bypassrls password %L',
      current_setting('livemap.admin_password')
    );
  end if;
end $$;

grant usage on schema public to livemap_admin;
grant select, insert, update, delete on all tables in schema public to livemap_admin;

grant execute on function livemap_current_user()         to livemap_app, livemap_admin;
grant execute on function livemap_current_role()         to livemap_app, livemap_admin;
grant execute on function livemap_granted_role()         to livemap_app, livemap_admin;
grant execute on function livemap_can_edit_map(uuid)     to livemap_app, livemap_admin;
grant execute on function livemap_current_tenant()       to livemap_admin;

commit;
