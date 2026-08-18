// Confirmed order (PPME-TPA-Development-Checklist.md §5): Hadir | Tugas |
// Yanbu'a | Al-Quran | Murajaah. Do not reorder without re-validating
// against the Figma Make prototype.
//
// Every signed-in role gets these five, admin included (ADR-014) — a
// super admin can do anything a tutor can on any class, so it navigates
// the same way a tutor does. `ADMIN_SECTION_TABS` below is *additional*,
// never a replacement, which is the opposite of the pre-ADR-014 shape.
export const NAV_TABS = [
  { to: '/attendance', key: 'nav.hadir' },
  { to: '/assignments', key: 'nav.tugas' },
  { to: '/yanbua', key: 'nav.yanbua' },
  { to: '/quran', key: 'nav.alquran' },
  { to: '/murajaah', key: 'nav.murajaah' },
] as const

// The enrollment/setup screens, which stay admin-only (`RequireAdmin`).
// These are *not* top-level tabs: 5 operational + 3 enrollment would be
// 8 entries in a mobile bottom nav that only fits 5 at a 44px tap target,
// and the 5 above are the prototype-validated set. They render as a
// secondary tab strip inside the admin section instead
// (`AdminSectionNav`), reached from the single "Kelola" entry point on
// the dashboard and the desktop tab bar.
//
// `/admin/reports` is deliberately absent: bulk draft generation folded
// into the admin's own Reports screen when ADR-014 gave admin real
// access to report content, so a separate counts-only screen no longer
// has a reason to exist (it existed only because ADR-013 kept admin away
// from what the reports actually said).
export const ADMIN_SECTION_TABS = [
  { to: '/admin/registrations', key: 'nav.pendaftaran' },
  { to: '/admin/classes', key: 'nav.kelas' },
  { to: '/admin/students', key: 'nav.santri' },
] as const
