-- 0003 — the document model the front end (web/) speaks.
--
-- Map-level settings move into one `settings` column, which replaces the view
-- and basemap columns, so the opening view and basemap have one home. Features
-- gain the fields the server acts on (publish strip, reference checks, time)
-- as columns; per-kind style stays in `props`. See web/CONTRACT-CHANGES.md
-- entries 1–28 and web/DECISIONS.md (Integration).
--
-- Existing maps are discarded rather than converted (approved): the local
-- database held nothing worth keeping, and an annotation's old pixel offset
-- cannot become a coordinate without a zoom it never stored.

begin;

-- Cascades to features, map_versions, publish_requests and feeds. Tenants,
-- users and memberships stay. Runs before the not-null columns are added,
-- which have no default to fill existing rows with.
delete from maps;

-- maps ---------------------------------------------------------------------

alter table maps
  drop column center,
  drop column zoom,
  drop column bearing,
  drop column pitch,
  drop column basemap_style_id,
  drop column label_langs;

alter table maps
  add column settings jsonb not null,
  add column updated_by uuid not null references users(id),
  add column published_rev bigint;

-- The whole MapSettings object, bounded so one map cannot carry an unbounded
-- blob. Features stay one row each; this is map-level and small.
alter table maps
  add constraint maps_settings_object
    check (jsonb_typeof(settings) = 'object'),
  add constraint maps_settings_size
    check (octet_length(settings::text) <= 262144),
  -- The revision the live version was built from: never ahead of the draft,
  -- and only present when something is live.
  add constraint maps_published_rev_range
    check (published_rev is null or (published_rev between 0 and rev)),
  add constraint maps_published_rev_needs_version
    check (published_rev is null or published_version is not null);

-- The model has no 'auto' direction for a map; only text does.
alter table maps drop constraint maps_ui_dir_check;
alter table maps
  add constraint maps_ui_dir_check check (ui_dir in ('ltr','rtl'));

-- features -----------------------------------------------------------------

-- `order` is reserved in SQL. The (map_id, at) index follows the rename.
alter table features rename column at to order_key;
alter index features_map_order_idx rename to features_map_order_key_idx;

alter table features
  add column group_id   text,
  add column preset_id  text,
  add column lineage_id text,
  add column hidden     boolean not null default false,
  add column locked     boolean not null default false,
  add column valid_from timestamptz,
  add column valid_to   timestamptz,
  alter column updated_by set not null;

alter table features
  add constraint features_valid_window
    check (valid_from is null or valid_to is null or valid_to >= valid_from);

-- The publish strip filters by group; the editor loads a map by group too.
create index features_map_group_idx on features (map_id, group_id);

commit;
