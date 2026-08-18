import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { useOnlineStatus } from './hooks/useOnlineStatus'
import { SignIn } from './pages/SignIn'
import { Unauthorized } from './pages/Unauthorized'
import { Dashboard } from './pages/Dashboard'
import { AppLayout } from './routes/AppLayout'
import { AttendancePage } from './features/attendance/AttendancePage'
import { AssignmentsPage } from './features/assignments/AssignmentsPage'
import { YanbuaPage } from './features/yanbua/YanbuaPage'
import { QuranPage } from './features/quran/QuranPage'
import { MurajaahPage } from './features/murajaah/MurajaahPage'
import { ReportsPage } from './features/reports/ReportsPage'
import { NotificationSettingsPage } from './features/notifications/NotificationSettingsPage'
import { NotificationCentrePage } from './features/notifications/NotificationCentrePage'
import { RegistrationsPage } from './features/admin/RegistrationsPage'
import { ClassesPage } from './features/admin/ClassesPage'
import { StudentsPage } from './features/admin/StudentsPage'
import { RequireAdmin } from './components/RequireAdmin'

function Gate() {
  const { session, profile, loading, unregistered } = useAuth()
  // Mounted unconditionally (hooks can't follow the early returns below):
  // replays the offline write queue on reconnect regardless of which
  // screen is open when it happens. `replayQueue` itself no-ops without
  // a session, so this is harmless before sign-in.
  useOnlineStatus()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-ppme-text/60">
        …
      </div>
    )
  }

  if (!session) return <SignIn />
  if (unregistered || !profile) return <Unauthorized />

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/attendance" element={<AttendancePage />} />
        <Route path="/assignments" element={<AssignmentsPage />} />
        <Route path="/yanbua" element={<YanbuaPage />} />
        <Route path="/quran" element={<QuranPage />} />
        <Route path="/murajaah" element={<MurajaahPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        {/* Not a tab: the five operational tabs are the
            prototype-validated set (checklist §5) and settings is not
            one of them. Reached from the dashboard instead. */}
        <Route path="/settings/notifications" element={<NotificationSettingsPage />} />
        {/* Reached from the TopNav bell, and from the deep link every
            push notification carries once tapped (ADR-015 part 3). */}
        <Route path="/notifications" element={<NotificationCentrePage />} />
        {/* Single entry point into the enrollment section (the "Kelola"
            dashboard tile and desktop tab both point here). Kept as a
            real route rather than linking straight to the first
            sub-screen so the tab stays highlighted across all of
            `/admin/*`. */}
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <Navigate to="/admin/registrations" replace />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/registrations"
          element={
            <RequireAdmin>
              <RegistrationsPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/classes"
          element={
            <RequireAdmin>
              <ClassesPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/students"
          element={
            <RequireAdmin>
              <StudentsPage />
            </RequireAdmin>
          }
        />
      </Route>
    </Routes>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  )
}
