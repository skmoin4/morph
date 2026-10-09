import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AppProviders } from './providers/AppProviders';
import { AuthProvider, useAuth } from './providers/AuthProvider';
import { AppShell } from './components/layout/AppShell';
import { LoginPage, SplashScreen } from './pages/LoginPage';
import { SettingsPage } from './pages/SettingsPage';
import { PeoplePage } from './pages/PeoplePage';
import { EmployeeDetailPage } from './pages/EmployeeDetailPage';
import { UiKitPage } from './pages/UiKitPage';
import { HomePage } from './pages/HomePage';
import { ClientsPage } from './pages/ClientsPage';
import { BookingsPage } from './pages/BookingsPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { TasksPage } from './pages/TasksPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { EmptyState } from './components/ui/EmptyState';
import { PageHeader } from './components/layout/PageHeader';
import { Panel } from './components/ui/Panel';

const MODULES: Array<{
  path: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  step: string;
  permission: string;
}> = [
  {
    path: '/attendance',
    eyebrow: 'People & Work',
    title: 'Attendance',
    subtitle: 'Mobile and office punches, rules and the register.',
    step: 'step 8',
    permission: 'attendance.view',
  },
  {
    path: '/shifts',
    eyebrow: 'People & Work',
    title: 'Shifts',
    subtitle: 'Shift templates and the weekly roster.',
    step: 'step 8',
    permission: 'shift.view',
  },
  {
    path: '/leave',
    eyebrow: 'People & Work',
    title: 'Leave',
    subtitle: 'Balances, requests and the team calendar.',
    step: 'step 9',
    permission: 'leave.view',
  },
  {
    path: '/timesheets',
    eyebrow: 'People & Work',
    title: 'Timesheets',
    subtitle: 'Weekly grids, submission and approval.',
    step: 'step 10',
    permission: 'timesheet.view',
  },
  {
    path: '/expenses',
    eyebrow: 'Money',
    title: 'Expenses',
    subtitle: 'Claims through manager then finance approval.',
    step: 'step 11',
    permission: 'expense.view',
  },
  {
    path: '/project-cost',
    eyebrow: 'Money',
    title: 'Project Cost',
    subtitle: 'The cost ledger, budget vs actual.',
    step: 'step 12',
    permission: 'cost.view',
  },
  {
    path: '/reports',
    eyebrow: 'Insights',
    title: 'Reports',
    subtitle: 'Filtered reports with Excel export.',
    step: 'step 13',
    permission: 'report.view',
  },
  {
    path: '/roles',
    eyebrow: 'Admin',
    title: 'Roles & Permissions',
    subtitle: 'The permission matrix and custom roles.',
    step: 'a later step',
    permission: 'role.view',
  },
];

export function App() {
  return (
    <AppProviders>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedShell />}>
              <Route index element={<HomePage />} />
              <Route path="/ui-kit" element={<UiKitPage />} />
              <Route
                path="/settings"
                element={
                  <RequirePermission permission="settings.view">
                    <SettingsPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/clients"
                element={
                  <RequirePermission permission="client.view">
                    <ClientsPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/bookings"
                element={
                  <RequirePermission permission="booking.view">
                    <BookingsPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/projects"
                element={
                  <RequirePermission permission="project.view">
                    <ProjectsPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/projects/:id"
                element={
                  <RequirePermission permission="project.view">
                    <ProjectDetailPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/tasks"
                element={
                  <RequirePermission permission="task.view">
                    <TasksPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/people"
                element={
                  <RequirePermission permission="employee.view">
                    <PeoplePage />
                  </RequirePermission>
                }
              />
              <Route
                path="/people/:id"
                element={
                  <RequirePermission permission="employee.view">
                    <EmployeeDetailPage />
                  </RequirePermission>
                }
              />
              {MODULES.map((module) => (
                <Route
                  key={module.path}
                  path={module.path}
                  element={
                    <RequirePermission permission={module.permission}>
                      <PlaceholderPage
                        eyebrow={module.eyebrow}
                        title={module.title}
                        subtitle={module.subtitle}
                        step={module.step}
                      />
                    </RequirePermission>
                  }
                />
              ))}
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </AppProviders>
  );
}

/** Everything inside the shell needs a session. */
function ProtectedShell() {
  const { user, permissions, loading, signOut } = useAuth();
  const location = useLocation();

  if (loading) return <SplashScreen />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  return (
    <AppShell
      userName={user.fullName}
      roleName={user.roleName}
      permissions={permissions}
      onSignOut={signOut}
    >
      <Outlet />
    </AppShell>
  );
}

/**
 * Route-level permission gate.
 *
 * Deep-linking to a module a role cannot open shows a clear message instead of
 * a blank screen. The API refuses the data regardless — this is only so the
 * refusal reads well.
 */
function RequirePermission({
  permission,
  children,
}: {
  permission: string;
  children: React.ReactNode;
}) {
  const { can } = useAuth();
  if (can(permission)) return <>{children}</>;

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Access" title="Not available" />
      <Panel>
        <EmptyState
          title="You do not have access to this screen"
          description="Your role does not include this module. Ask an administrator if you need it."
        />
      </Panel>
    </div>
  );
}

function NotFound() {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="404" title="Page not found" />
      <Panel>
        <EmptyState
          title="That page does not exist"
          description="Check the address, or pick a screen from the sidebar."
        />
      </Panel>
    </div>
  );
}
