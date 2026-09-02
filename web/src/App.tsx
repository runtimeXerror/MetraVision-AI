import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { BrowserRouter, useNavigate } from 'react-router-dom';

import { ApiError, setSessionLostHandler } from '@/services/client';
import { AppRoutes } from '@/routes/AppRoutes';
import { useAuthStore } from '@/store/authStore';

/**
 * Application root.
 *
 * Holds the three things that must exist before any page renders: the query
 * client, the router, and a confirmed answer to "is anyone signed in".
 */

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // The console is read-mostly and the data behind it changes when an
        // inspector files something in the field, not while a supervisor reads
        // a page. Refetching on focus keeps a tab left open overnight honest.
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          // Retrying an authorisation failure or a 404 just delays the error
          // the user needs to see.
          if (error instanceof ApiError) {
            if (['unauthorized', 'forbidden', 'not_found', 'validation'].includes(error.kind)) {
              return false;
            }
            // Hammering a limiter is what got us limited. Surface it instead.
            if (error.kind === 'rate_limited') return false;
          }
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

export function App() {
  // Created once per mount rather than at module scope, so a hot reload does
  // not leave two clients holding different caches.
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionGate>
          <AppRoutes />
        </SessionGate>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

/**
 * Confirms the stored session before the routes mount, and wires the HTTP
 * client's "this session is gone" signal to an actual navigation.
 */
function SessionGate({ children }: { children: React.ReactNode }) {
  const restore = useAuthStore((state) => state.restore);
  const navigate = useNavigate();

  useEffect(() => {
    void restore();
  }, [restore]);

  useEffect(() => {
    setSessionLostHandler(() => {
      useAuthStore.setState({ user: null });
      navigate('/login', { replace: true });
    });
  }, [navigate]);

  return <>{children}</>;
}
