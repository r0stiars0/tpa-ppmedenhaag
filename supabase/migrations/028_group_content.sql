-- ============================================================
-- Migration 028 — group announcements and course materials
-- (TAD ADR-045 (e)–(g), PRD Feature 8 release 8b-1, FR-004–FR-007)
--
-- ── What changes ────────────────────────────────────────────
-- A group's tutors (a 16+ student assistant included) and admins can
-- post ANNOUNCEMENTS and COURSE MATERIALS to one group. A material is
-- one PDF/PPTX file in a private bucket, or one link to a Google
-- Docs/Slides/Drive file or a personal OneDrive file. Families are
-- notified on posting (a webhook to `notify-group-content`), never on
-- an edit.
--
-- ── Who reads (FR-006) ─────────────────────────────────────
-- fn_my_content_classes() = the groups the caller teaches (archived
-- included), the other groups of the students they teach in an ACTIVE
-- group (not for student assistants), and the groups their children —
-- or they themselves — are enrolled in. It is 026's
-- fn_my_tutor_readable_classes() plus fn_my_family_classes().
--
-- ── Who writes ─────────────────────────────────────────────
-- Posting: a tutor of the group, or an admin, always as themselves.
-- Editing: the author only (a co-tutor does not edit another tutor's
-- post, FR-004), or an admin. Deleting: the author or an admin — an
-- admin's delete is the one-click takedown, and works in an archived
-- group because the freeze trigger does not block DELETE.
--
-- ── Order in production ─────────────────────────────────────
-- Additive only. Apply before merging the 8b-1 PR; the 8a app does not
-- read any of it. The webhook needs the Function deployed to deliver,
-- and fn_post_webhook already swallows a failed call.
-- ============================================================

-- ---------- 1. notification events ----------
alter type public.notification_event add value if not exists 'groupAnnouncement';
alter type public.notification_event add value if not exists 'newMaterial';

-- ---------- 2. who reads a group's content ----------
create or replace function public.fn_my_content_classes()
returns setof uuid language sql stable security definer set search_path = public as $$
  select * from public.fn_my_tutor_readable_classes()
  union
  select * from public.fn_my_family_classes()
$$;

comment on function public.fn_my_content_classes() is
  'Groups whose announcements, materials and files the caller may read (PRD Feature 8 FR-006, ADR-045(e)/(f)).';

-- ---------- 3. announcements ----------
create table public.group_announcements (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes (id) on delete cascade,
  author_id   uuid not null references public.users (id),
  title       text not null check (char_length(btrim(title)) between 1 and 200),
  body        text not null default '' check (char_length(body) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index group_announcements_class_idx on public.group_announcements (class_id, created_at desc);

create trigger trg_group_announcements_touch before update on public.group_announcements
  for each row execute function public.fn_touch_updated_at();

alter table public.group_announcements enable row level security;

create policy group_announcements_read on public.group_announcements for select to authenticated
  using (public.fn_is_admin() or class_id in (select public.fn_my_content_classes()));
create policy group_announcements_insert on public.group_announcements for insert to authenticated
  with check (author_id = auth.uid()
              and (public.fn_is_admin() or class_id in (select public.fn_my_classes())));
create policy group_announcements_update on public.group_announcements for update to authenticated
  using (public.fn_is_admin() or author_id = auth.uid())
  with check (public.fn_is_admin()
              or (author_id = auth.uid() and class_id in (select public.fn_my_classes())));
create policy group_announcements_delete on public.group_announcements for delete to authenticated
  using (public.fn_is_admin() or author_id = auth.uid());

-- ---------- 4. course materials ----------
create table public.group_materials (
  id            uuid primary key default gen_random_uuid(),
  class_id      uuid not null references public.classes (id) on delete cascade,
  uploaded_by   uuid not null references public.users (id),
  title         text not null check (char_length(btrim(title)) between 1 and 200),
  description   text check (description is null or char_length(description) <= 500),
  kind          text not null check (kind in ('file', 'link')),
  storage_path  text,
  file_name     text,
  mime_type     text check (mime_type is null or mime_type in (
                  'application/pdf',
                  'application/vnd.openxmlformats-officedocument.presentationml.presentation')),
  size_bytes    bigint check (size_bytes is null or size_bytes between 1 and 20971520),
  url           text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Exactly one file, or exactly one link.
  constraint group_materials_shape check (
    (kind = 'file' and storage_path is not null and file_name is not null
                   and mime_type is not null and size_bytes is not null and url is null)
    or
    (kind = 'link' and url is not null and storage_path is null and file_name is null
                   and mime_type is null and size_bytes is null)),
  -- The link allow-list (PRD Resolved Decision 28). Refuses Google Forms
  -- and every other Google path, Drive folders, 1drv.ms short links
  -- (their destination cannot be checked), *.sharepoint.com, and all
  -- other URLs. The host is followed by '/', so a look-alike host
  -- (docs.google.com.example) does not match.
  constraint group_materials_link_allowed check (
    url is null or url ~ '^https://(docs\.google\.com/(document|presentation)/d/|drive\.google\.com/file/d/|onedrive\.live\.com/)'),
  -- A file row can only point into its own group's and its own folder.
  constraint group_materials_path_own_folder check (
    storage_path is null or storage_path like class_id::text || '/' || id::text || '/%')
);
create index group_materials_class_idx on public.group_materials (class_id, created_at desc);

create trigger trg_group_materials_touch before update on public.group_materials
  for each row execute function public.fn_touch_updated_at();

alter table public.group_materials enable row level security;

create policy group_materials_read on public.group_materials for select to authenticated
  using (public.fn_is_admin() or class_id in (select public.fn_my_content_classes()));
create policy group_materials_insert on public.group_materials for insert to authenticated
  with check (uploaded_by = auth.uid()
              and (public.fn_is_admin() or class_id in (select public.fn_my_classes())));
create policy group_materials_update on public.group_materials for update to authenticated
  using (public.fn_is_admin() or uploaded_by = auth.uid())
  with check (public.fn_is_admin()
              or (uploaded_by = auth.uid() and class_id in (select public.fn_my_classes())));
create policy group_materials_delete on public.group_materials for delete to authenticated
  using (public.fn_is_admin() or uploaded_by = auth.uid());

-- ---------- 5. archived groups are frozen (026's trigger, two more tables) ----------
create or replace function public.fn_class_not_archived()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_new uuid;
  v_old uuid;
begin
  if tg_table_name in ('sessions', 'assignments', 'class_members', 'group_announcements', 'group_materials') then
    v_new := new.class_id;
    if tg_op = 'UPDATE' then v_old := old.class_id; end if;
  elsif tg_table_name in ('attendance', 'tutor_attendance') then
    v_new := public.fn_session_class(new.session_id);
    if tg_op = 'UPDATE' then v_old := public.fn_session_class(old.session_id); end if;
  elsif tg_table_name = 'assignment_status' then
    v_new := public.fn_assignment_class(new.assignment_id);
    if tg_op = 'UPDATE' then v_old := public.fn_assignment_class(old.assignment_id); end if;
  end if;

  if exists (select 1 from public.classes
             where id in (v_new, v_old) and archived_at is not null) then
    raise exception 'group is archived'
      using errcode = 'check_violation',
            hint = 'Unarchive the group to change it (PRD Feature 8 FR-010).';
  end if;
  return new;
end $$;

create trigger trg_class_not_archived before insert or update on public.group_announcements
  for each row execute function public.fn_class_not_archived();
create trigger trg_class_not_archived before insert or update on public.group_materials
  for each row execute function public.fn_class_not_archived();

-- ---------- 6. the private bucket and its object rules ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('group-materials', 'group-materials', false, 20971520,
        array['application/pdf',
              'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The path is {class_id}/{material_id}/{file_name}; the rules key on the
-- first folder, compared as text so a malformed name is simply no match.
-- Downloads are signed URLs, which Storage checks against the SELECT
-- rule; no Function sits in the download path.
create policy group_materials_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'group-materials'
         and (public.fn_is_admin()
              or (storage.foldername(name))[1] in (select c::text from public.fn_my_content_classes() c)));
-- Upload only into an ACTIVE group one teaches: an archived group takes
-- no new material, so an object there could only ever be an orphan.
create policy group_materials_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'group-materials'
              and (public.fn_is_admin()
                   or (storage.foldername(name))[1] in (select c::text from public.fn_my_active_classes() c)));
-- Delete one's own upload (the replace and delete flows), or any as admin.
create policy group_materials_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'group-materials'
         and (public.fn_is_admin()
              or (owner_id = auth.uid()::text
                  and (storage.foldername(name))[1] in (select c::text from public.fn_my_classes() c))));

-- ---------- 7. notify families on posting (never on an edit) ----------
create or replace function public.fn_notify_group_announcement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.fn_post_webhook('notify-group-content', 'group_announcements', tg_op, new.id);
  return new;
exception
  when others then
    raise warning 'fn_notify_group_announcement: % (%)', sqlerrm, sqlstate;
    return new;
end $$;

create or replace function public.fn_notify_group_material()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.fn_post_webhook('notify-group-content', 'group_materials', tg_op, new.id);
  return new;
exception
  when others then
    raise warning 'fn_notify_group_material: % (%)', sqlerrm, sqlstate;
    return new;
end $$;

create trigger trg_notify_group_announcement after insert on public.group_announcements
  for each row execute function public.fn_notify_group_announcement();
create trigger trg_notify_group_material after insert on public.group_materials
  for each row execute function public.fn_notify_group_material();

-- ---------- 8. a group's tutors, by name, for its page (FR-007) ----------
-- `users` is readable only by oneself and admins, so a family could not
-- otherwise see who teaches their child's group. Names only, only to
-- those who can read the group, and no 16+ student assistant: they are
-- a pupil themselves, and their name is not given to other families.
create or replace function public.fn_group_tutor_names(p_class uuid)
returns table (full_name text)
language sql stable security definer set search_path = public as $$
  select u.full_name
  from public.classes c
  join public.users u on u.id = any (c.tutor_ids)
  where c.id = p_class
    and (public.fn_is_admin() or p_class in (select public.fn_my_content_classes()))
    and not exists (select 1 from public.students s where s.user_id = u.id)
  order by u.full_name
$$;

revoke all on function public.fn_group_tutor_names(uuid) from public, anon;
grant execute on function public.fn_group_tutor_names(uuid) to authenticated;

-- The author line on each announcement and material: the names of the
-- people who posted in the group, to those who can read it, with the
-- same student-assistant exclusion.
create or replace function public.fn_group_author_names(p_class uuid)
returns table (user_id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select u.id, u.full_name
  from public.users u
  where u.id in (select author_id from public.group_announcements where class_id = p_class
                 union
                 select uploaded_by from public.group_materials where class_id = p_class)
    and (public.fn_is_admin() or p_class in (select public.fn_my_content_classes()))
    and not exists (select 1 from public.students s where s.user_id = u.id)
$$;

revoke all on function public.fn_group_author_names(uuid) from public, anon;
grant execute on function public.fn_group_author_names(uuid) to authenticated;

-- ---------- 9. storage used, for admins ----------
create or replace function public.fn_admin_storage_usage()
returns table (bucket_id text, objects bigint, bytes bigint)
language sql stable security definer set search_path = public as $$
  select o.bucket_id, count(*)::bigint, coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint
  from storage.objects o
  where public.fn_is_admin()
  group by o.bucket_id
  order by o.bucket_id
$$;

revoke all on function public.fn_admin_storage_usage() from public, anon;
grant execute on function public.fn_admin_storage_usage() to authenticated;
