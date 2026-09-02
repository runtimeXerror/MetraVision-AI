import { useQuery } from '@tanstack/react-query';
import { Outlet } from 'react-router-dom';

import { dashboardService } from '@/services';

import { Header } from './Header';
import { Sidebar } from './Sidebar';

/**
 * The authenticated frame.
 *
 * Owns the one piece of state both the rail and the header need — the counts
 * that say what is waiting — so it is fetched once here rather than by each.
 */
export function AppShell() {
  const { data } = useQuery({
    queryKey: ['analytics', 'summary', 'shell'],
    queryFn: () => dashboardService.getSummary(),
    staleTime: 60_000,
  });

  const counts = {
    pendingReviews: data?.pendingReviews ?? 0,
    violations: data?.totalViolationFindings ?? 0,
  };

  return (
    // `dvh` rather than `vh`: on a phone the browser chrome is counted out of
    // the viewport height, and `h-screen` puts the last row under it.
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <Sidebar counts={counts} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="scroll-slim flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[100rem] px-3 py-5 sm:px-6 sm:py-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
