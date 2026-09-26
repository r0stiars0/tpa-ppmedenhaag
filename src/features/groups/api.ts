import { supabase } from '../../lib/supabase'
import type { Tables } from '../../lib/database.types'
import { materialStoragePath } from '../../lib/materialFiles'

/**
 * The "Pengumuman & Materi" page (PRD Feature 8 FR-004–FR-007, TAD
 * ADR-045(e)/(f)). Every read here is filtered by RLS to the groups the
 * caller may read (`fn_my_content_classes()`, migration 028); the page
 * never widens that, it only picks which of those groups to list.
 */
export type Announcement = Tables<'group_announcements'>
export type Material = Tables<'group_materials'>

export const MATERIALS_BUCKET = 'group-materials'
/** A signed download link lives five minutes (ADR-045(f)). */
const DOWNLOAD_LINK_SECONDS = 300

export interface GroupHeader {
  id: string
  name: string
  meeting_days: number[]
  schedule: string | null
  archived_at: string | null
  tutor_ids: string[]
}

export interface GroupSummary {
  announcements: number
  materials: number
  /** ISO timestamp of the newest item, or null when the group has none. */
  latest: string | null
}

/** Counts and newest date per group, for the list of groups. */
export async function fetchGroupSummaries(classIds: string[]): Promise<Map<string, GroupSummary>> {
  const summaries = new Map<string, GroupSummary>(
    classIds.map((id) => [id, { announcements: 0, materials: 0, latest: null }]),
  )
  if (classIds.length === 0) return summaries
  const [announcements, materials] = await Promise.all([
    supabase.from('group_announcements').select('class_id, created_at').in('class_id', classIds),
    supabase.from('group_materials').select('class_id, created_at').in('class_id', classIds),
  ])
  if (announcements.error) throw announcements.error
  if (materials.error) throw materials.error
  const bump = (classId: string, createdAt: string, key: 'announcements' | 'materials') => {
    const s = summaries.get(classId)
    if (!s) return
    s[key] += 1
    if (!s.latest || createdAt > s.latest) s.latest = createdAt
  }
  for (const row of announcements.data ?? []) bump(row.class_id, row.created_at, 'announcements')
  for (const row of materials.data ?? []) bump(row.class_id, row.created_at, 'materials')
  return summaries
}

export async function fetchGroupHeader(classId: string): Promise<GroupHeader | null> {
  const { data, error } = await supabase
    .from('classes')
    .select('id, name, meeting_days, schedule, archived_at, tutor_ids')
    .eq('id', classId)
    .maybeSingle()
  if (error) throw error
  return data
}

/** The group's tutors by name (FR-007); student assistants are not named. */
export async function fetchGroupTutorNames(classId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('fn_group_tutor_names', { p_class: classId })
  if (error) throw error
  return (data ?? []).map((row) => row.full_name)
}

export async function fetchAnnouncements(classId: string): Promise<Announcement[]> {
  const { data, error } = await supabase
    .from('group_announcements')
    .select('*')
    .eq('class_id', classId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function fetchMaterials(classId: string): Promise<Material[]> {
  const { data, error } = await supabase
    .from('group_materials')
    .select('*')
    .eq('class_id', classId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/** The authors' and uploaders' names, for the "· Ustadzah Maryam" line. */
export async function fetchAuthorNames(classId: string): Promise<Map<string, string>> {
  // Authors are the group's tutors (or an admin); the same function that
  // names the tutors answers for them, and an admin or former tutor who
  // is not listed simply shows no name.
  const names = await supabase.rpc('fn_group_author_names', { p_class: classId })
  if (names.error) throw names.error
  return new Map((names.data ?? []).map((row) => [row.user_id, row.full_name]))
}

export async function createAnnouncement(input: { classId: string; authorId: string; title: string; body: string }) {
  const { error } = await supabase.from('group_announcements').insert({
    class_id: input.classId,
    author_id: input.authorId,
    title: input.title.trim(),
    body: input.body,
  })
  if (error) throw error
}

export async function updateAnnouncement(id: string, input: { title: string; body: string }) {
  const { data, error } = await supabase
    .from('group_announcements')
    .update({ title: input.title.trim(), body: input.body })
    .eq('id', id)
    .select('id')
  if (error) throw error
  // RLS turns an edit one may not make into "no row matched", not an error.
  if (!data || data.length === 0) throw new Error('not allowed')
}

export async function deleteAnnouncement(id: string) {
  const { data, error } = await supabase.from('group_announcements').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('not allowed')
}

/**
 * Upload order is object first, then row (ADR-045(f)): the notification
 * fires on the row insert, so it never announces a file that is not
 * there yet. If the row fails, the object is removed again; if even that
 * fails, the nightly clean-up takes it.
 */
export async function createFileMaterial(input: {
  classId: string
  uploadedBy: string
  title: string
  description: string
  file: File
  mimeType: string
}) {
  const id = crypto.randomUUID()
  const path = materialStoragePath(input.classId, id, input.file.name)
  const bucket = supabase.storage.from(MATERIALS_BUCKET)
  const upload = await bucket.upload(path, input.file, { contentType: input.mimeType, upsert: false })
  if (upload.error) throw upload.error
  const { error } = await supabase.from('group_materials').insert({
    id,
    class_id: input.classId,
    uploaded_by: input.uploadedBy,
    title: input.title.trim(),
    description: input.description.trim() || null,
    kind: 'file',
    storage_path: path,
    file_name: input.file.name,
    mime_type: input.mimeType,
    size_bytes: input.file.size,
  })
  if (error) {
    await bucket.remove([path])
    throw error
  }
}

export async function createLinkMaterial(input: {
  classId: string
  uploadedBy: string
  title: string
  description: string
  url: string
}) {
  const { error } = await supabase.from('group_materials').insert({
    class_id: input.classId,
    uploaded_by: input.uploadedBy,
    title: input.title.trim(),
    description: input.description.trim() || null,
    kind: 'link',
    url: input.url,
  })
  if (error) throw error
}

export async function updateMaterial(id: string, input: { title: string; description: string; url?: string }) {
  const { data, error } = await supabase
    .from('group_materials')
    .update({
      title: input.title.trim(),
      description: input.description.trim() || null,
      ...(input.url !== undefined ? { url: input.url } : {}),
    })
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('not allowed')
}

/** Replace: upload the new file, point the row at it, then delete the old object. */
export async function replaceMaterialFile(material: Material, file: File, mimeType: string) {
  let path = materialStoragePath(material.class_id, material.id, file.name)
  if (path === material.storage_path) {
    // Same name as the file it replaces: a new object name, since the
    // bucket takes no overwrite (there is no UPDATE rule on objects).
    path = materialStoragePath(material.class_id, material.id, `${Date.now().toString(36)}-${file.name}`)
  }
  const bucket = supabase.storage.from(MATERIALS_BUCKET)
  const upload = await bucket.upload(path, file, { contentType: mimeType, upsert: false })
  if (upload.error) throw upload.error
  const { data, error } = await supabase
    .from('group_materials')
    .update({ storage_path: path, file_name: file.name, mime_type: mimeType, size_bytes: file.size })
    .eq('id', material.id)
    .select('id')
  if (error || !data || data.length === 0) {
    await bucket.remove([path])
    throw error ?? new Error('not allowed')
  }
  if (material.storage_path) await bucket.remove([material.storage_path])
}

/** Delete: object first, then row (ADR-045(f)). */
export async function deleteMaterial(material: Material) {
  if (material.storage_path) {
    const { error } = await supabase.storage.from(MATERIALS_BUCKET).remove([material.storage_path])
    if (error) throw error
  }
  const { data, error } = await supabase.from('group_materials').delete().eq('id', material.id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('not allowed')
}

/** A five-minute signed link that downloads under the original file name. */
export async function materialDownloadUrl(material: Material): Promise<string> {
  if (!material.storage_path || !material.file_name) throw new Error('not a file')
  const { data, error } = await supabase.storage
    .from(MATERIALS_BUCKET)
    .createSignedUrl(material.storage_path, DOWNLOAD_LINK_SECONDS, { download: material.file_name })
  if (error) throw error
  return data.signedUrl
}

export async function fetchStorageUsage() {
  const { data, error } = await supabase.rpc('fn_admin_storage_usage')
  if (error) throw error
  return data ?? []
}
