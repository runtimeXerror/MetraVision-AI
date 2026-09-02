import { Compass } from 'lucide-react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';

import { Button, Card } from '@/components/ui/primitives';
import { EmptyState } from '@/components/ui/states';
import { AppShell } from '@/layouts/AppShell';
import { DashboardPage } from '@/pages/DashboardPage';
import { InspectionDetailPage } from '@/pages/InspectionDetailPage';
import { InspectionsPage } from '@/pages/InspectionsPage';
import { InspectorDetailPage, InspectorsPage } from '@/pages/InspectorsPage';
import { LoginPage } from '@/pages/LoginPage';
import { ProductsPage } from '@/pages/ProductsPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { ReportsPage } from '@/pages/ReportsPage';
import { ReviewsPage } from '@/pages/ReviewsPage';
import { RuleDetailPage } from '@/pages/RuleDetailPage';
import { RulesPage } from '@/pages/RulesPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ViolationDetailPage } from '@/pages/ViolationDetailPage';
import { ViolationsPage } from '@/pages/ViolationsPage';

import { RedirectIfAuthed, RequireAuth, RequireRole } from './guards';

/**
 * The route table.
 *
 * Everything below `RequireAuth` needs a confirmed session; the inspector
 * roster additionally needs SUPERVISOR, matching what the API will actually
 * serve. The guard is there so a user is never shown a door that will not
 * open — the API is what keeps it shut.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <RedirectIfAuthed>
            <LoginPage />
          </RedirectIfAuthed>
        }
      />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />

          <Route path="/inspections" element={<InspectionsPage />} />
          <Route path="/inspections/:id" element={<InspectionDetailPage />} />

          <Route path="/reviews" element={<ReviewsPage />} />

          <Route path="/violations" element={<ViolationsPage />} />
          <Route path="/violations/:id" element={<ViolationDetailPage />} />

          {/* Supervisory view — the API refuses the roster below SUPERVISOR. */}
          <Route element={<RequireRole minRole="SUPERVISOR" />}>
            <Route path="/inspectors" element={<InspectorsPage />} />
            <Route path="/inspectors/:id" element={<InspectorDetailPage />} />
          </Route>

          <Route path="/products" element={<ProductsPage />} />

          <Route path="/rules" element={<RulesPage />} />
          <Route path="/rules/:id" element={<RuleDetailPage />} />

          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />

          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}

function NotFound() {
  return (
    <Card>
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="That address does not correspond to anything in the console."
        action={
          <Link to="/dashboard">
            <Button variant="secondary" size="sm">
              Back to the dashboard
            </Button>
          </Link>
        }
      />
    </Card>
  );
}
