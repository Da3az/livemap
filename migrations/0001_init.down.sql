-- Reverse of 0001_init. Drops in dependency order.
-- Extensions and the livemap_app role are left in place: both are cluster- or
-- database-level and may be shared.

begin;

drop table if exists feeds;
drop table if exists publish_requests;
drop table if exists map_versions;
drop table if exists features;
drop table if exists maps;
drop table if exists assets;
drop table if exists themes;
drop table if exists memberships;
drop table if exists users;
drop table if exists tenants;

drop function if exists livemap_current_tenant();

commit;
