import { useCallback, useEffect, useRef, useState } from 'react';

import { toApiError } from '../services/api';
import type { ApiError, AsyncState } from '../types';

/**
 * Runs an async operation and exposes it as an exhaustive `AsyncState`.
 *
 * Screens switch on `state.status`, which forces them to render an empty and an
 * error branch — the mechanism that keeps blank screens out of the app.
 */
export function useAsync<T>(
  operation: () => Promise<T>,
  options: { immediate?: boolean } = {},
): {
  state: AsyncState<T>;
  run: () => Promise<T | null>;
  reset: () => void;
} {
  const { immediate = true } = options;

  const [state, setState] = useState<AsyncState<T>>({ status: immediate ? 'loading' : 'idle' });

  // Keeps the latest callback without making `run` a new function each render.
  const operationRef = useRef(operation);
  operationRef.current = operation;

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const data = await operationRef.current();
      // Avoid setting state on a screen the inspector has already navigated away from.
      if (mounted.current) setState({ status: 'success', data });
      return data;
    } catch (error) {
      const apiError: ApiError = toApiError(error);
      if (mounted.current) setState({ status: 'error', error: apiError });
      return null;
    }
  }, []);

  const reset = useCallback(() => setState({ status: 'idle' }), []);

  useEffect(() => {
    if (immediate) void run();
    // Intentionally runs once: `run` is stable and re-running on every render
    // would put the screen in a request loop.
  }, [immediate, run]);

  return { state, run, reset };
}
