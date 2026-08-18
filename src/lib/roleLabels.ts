import type { Database } from './database.types'

type UserRole = Database['public']['Enums']['user_role']

// DB enum values (migration 001) don't match the i18n `roles` namespace
// keys 1:1 — the locale files use the community-facing terms (Ustadz,
// Orang Tua, Santri) rather than the schema's generic role names.
export const ROLE_I18N_KEY: Record<UserRole, string> = {
  admin: 'roles.admin',
  tutor: 'roles.ustadz',
  parent: 'roles.orangTua',
  student: 'roles.santri',
}
