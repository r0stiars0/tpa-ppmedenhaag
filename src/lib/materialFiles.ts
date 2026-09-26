/**
 * Course-material files (PRD Feature 8 FR-005, TAD ADR-045(f)).
 *
 * The bucket refuses anything over 20 MB or not PDF/PPTX by itself, and
 * the table's check constraints refuse a row that says otherwise
 * (migration 028). These checks run first so the tutor gets a sentence,
 * not a failed upload.
 */
export const MAX_MATERIAL_BYTES = 20 * 1024 * 1024

export const PDF_MIME = 'application/pdf'
export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

const BY_EXTENSION: Record<string, string> = { pdf: PDF_MIME, pptx: PPTX_MIME }

export type MaterialFileCheck = { ok: true; mimeType: string } | { ok: false; reason: 'type' | 'size' | 'empty' }

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/**
 * Accepts by extension, and by the browser's reported type when it gives
 * one. Phones often report no type for a .pptx; a reported type that
 * contradicts the extension is refused. The type Storage is told is the
 * one the extension names, which is what the bucket's allow-list checks.
 */
export function checkMaterialFile(file: { name: string; size: number; type: string }): MaterialFileCheck {
  const mimeType = BY_EXTENSION[extensionOf(file.name)]
  if (!mimeType) return { ok: false, reason: 'type' }
  if (file.type && file.type !== mimeType) return { ok: false, reason: 'type' }
  if (file.size <= 0) return { ok: false, reason: 'empty' }
  if (file.size > MAX_MATERIAL_BYTES) return { ok: false, reason: 'size' }
  return { ok: true, mimeType }
}

/**
 * `{class_id}/{material_id}/{file_name}` — the shape the Storage rules
 * and the table's `group_materials_path_own_folder` constraint key on.
 * The file name is reduced to letters, digits, `-`, `_` and one
 * extension, so it can never add a folder or climb out of its own.
 * The original name is kept on the row (`file_name`) for the download.
 */
export function materialStoragePath(classId: string, materialId: string, fileName: string): string {
  const ext = extensionOf(fileName)
  const dot = fileName.lastIndexOf('.')
  const stem = (dot < 0 ? fileName : fileName.slice(0, dot))
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const originalExt = dot < 0 ? '' : fileName.slice(dot + 1).replace(/[^A-Za-z0-9]/g, '')
  const safeName = `${stem || 'file'}${ext ? `.${originalExt}` : ''}`
  return `${classId}/${materialId}/${safeName}`
}

/** An announcement or material shows "diubah" once it has been edited. */
export function isEdited(row: { created_at: string; updated_at: string }): boolean {
  return new Date(row.updated_at).getTime() > new Date(row.created_at).getTime()
}
