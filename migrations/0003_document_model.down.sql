-- Reverse of 0003. Map rows are deleted again: the restored view columns are
-- not null and nothing could fill them from the new model.

begin;

delete from maps;

drop index if exists features_map_group_idx;

alter table features
  drop constraint if exists features_valid_window,
  drop column group_id,
  drop column preset_id,
  drop column lineage_id,
  drop column hidden,
  drop column locked,
  drop column valid_from,
  drop column valid_to,
  alter column updated_by drop not null;

alter index features_map_order_key_idx rename to features_map_order_idx;
alter table features rename column order_key to at;

alter table maps drop constraint maps_ui_dir_check;
alter table maps
  add constraint maps_ui_dir_check check (ui_dir in ('ltr','rtl','auto'));

alter table maps
  drop constraint if exists maps_published_rev_needs_version,
  drop constraint if exists maps_published_rev_range,
  drop constraint if exists maps_settings_size,
  drop constraint if exists maps_settings_object,
  drop column published_rev,
  drop column updated_by,
  drop column settings;

alter table maps
  add column center geography(Point, 4326) not null,
  add column zoom real not null check (zoom between 0 and 24),
  add column bearing real not null default 0,
  add column pitch real not null default 0,
  add column basemap_style_id text not null,
  add column label_langs text[] not null default array['en'];

commit;
