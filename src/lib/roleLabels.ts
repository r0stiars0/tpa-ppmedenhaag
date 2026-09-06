import type { Database } from './database.types'

type UserRole = Database['public']['Enums']['user_role']

// DB enum values (migration 001) don't match the i18n `roles` namespace
// keys 1:1 — the locale files use the community-facing terms (Guru /
// Docent, Orang Tua, Santri) rather than the schema's generic role
// names. The `roles.ustadz` *key* is kept for stability; only its
// displayed value changed to the gender-neutral "Guru" / "Docent".
export const ROLE_I18N_KEY: Record<UserRole, string> = {
  admin: 'roles.admin',
  tutor: 'roles.ustadz',
  parent: 'roles.orangTua',
  student: 'roles.santri',
}
