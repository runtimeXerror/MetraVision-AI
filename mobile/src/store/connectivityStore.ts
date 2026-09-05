import { AppState } from 'react-native';
import { create } from 'zustand';

import { API_BASE_URL } from '../constants/config';

/**
 * ── IS THE DEPARTMENT'S SERVER REACHABLE? ───────────────────────────────────
 *
 * One boolean, and it means something narrower than "is there a network".
 *
 * A field handset is routinely *connected* and unable to reach anything: a
 * captive portal in a mall, a rural cell that holds an association but passes
 * no traffic, a phone on the shop's Wi-Fi while the backend is on the
 * inspector's own LAN. A radio-level check — which is all `NetInfo` gives —
 * would report every one of those as online and leave the officer looking at a
 * spinner that resolves into an error two thirds of a minute later.
 *
 * So this asks the only question the app actually cares about: did a request to
 * *our* API just work? It is answered from two places.
 *
 *   - **Real traffic.** `api.ts` reports the outcome of every call it makes.
 *     This is the cheap signal and the accurate one: no extra request, and it
 *     is by definition testing the exact path the app needs.
 *   - **A `/health` probe.** Used when there is no traffic to learn from — at
 *     launch, when the app returns to the foreground, and on a slow poll while
 *     offline so that walking back into coverage restores the app without the
 *     officer having to prod it.
 *
 * No dependency is added for this. `@react-native-community/netinfo` would
 * answer a different and less useful question, and would need a native rebuild
 * of a working client to do it.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * How long the probe waits.
 *
 * Deliberately far below the app's ordinary request timeout. This call exists
 * to decide *quickly* whether the app should be rendering from disk; an
 * inspector should never sit in front of a splash screen while a probe waits
 * out twenty seconds to tell them what the cache could have told them at once.
 */
const PROBE_TIMEOUT_MS = 3_000;

/**
 * How often the app re-probes while it believes it is offline.
 *
 * Twenty seconds. Frequent enough that walking out of a basement restores the
 * app before the officer thinks to pull-to-refresh, and rare enough that a
 * genuinely disconnected phone is not spending its battery on the radio. There
 * is no poll while online — real traffic is a better signal than a synthetic
 * one, and polling a server that is answering fine is pure cost.
 */
const OFFLINE_POLL_MS = 20_000;

interface ConnectivityState {
  /**
   * The current belief.
   *
   * Starts `true`. An app that opened assuming the worst would flash an offline
   * banner on every healthy launch, and a banner that cries wolf is one the
   * officer stops reading — which matters, because the honest one carries the
   * difference between a live record and a saved copy.
   */
  online: boolean;
  /** When the server was last known to answer. Null until it has, ever. */
  lastOnlineAt: string | null;
  /** True while a probe is in flight, so a manual retry can show progress. */
  probing: boolean;

  /** Called by `api.ts` when any request completes — the server is there. */
  noteReachable: () => void;
  /** Called by `api.ts` when a request never reached the server at all. */
  noteUnreachable: () => void;
  /** Asks `/health` directly. Resolves to the new belief. */
  probe: () => Promise<boolean>;
}

export const useConnectivityStore = create<ConnectivityState>((set, get) => ({
  online: true,
  lastOnlineAt: null,
  probing: false,

  noteReachable() {
    // `lastOnlineAt` is refreshed on every success, but `online` is only
    // *written* on a change: an unconditional `set` here would notify every
    // subscribed screen on every request the app makes.
    const now = new Date().toISOString();
    if (get().online) set({ lastOnlineAt: now });
    else set({ online: true, lastOnlineAt: now });
  },

  noteUnreachable() {
    if (get().online) set({ online: false });
  },

  async probe() {
    if (get().probing) return get().online;
    set({ probing: true });

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

      try {
        // Raw `fetch`, not `request()` from `api.ts`. That module reports its
        // outcomes *into* this store, and importing it here would close the
        // cycle. `/health` needs no token, so nothing is lost by going direct.
        const response = await fetch(`${API_BASE_URL}/health`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });

        // Any answer at all means the server is reachable. A 500 from a backend
        // with a sick database is still a backend the app can talk to, and
        // rendering the whole app from disk because of it would be wrong.
        if (response.status > 0) {
          get().noteReachable();
          return true;
        }

        get().noteUnreachable();
        return false;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      get().noteUnreachable();
      return false;
    } finally {
      set({ probing: false });
    }
  },
}));

/** Most screens want the boolean, not the store. */
export const useIsOnline = () => useConnectivityStore((state) => state.online);

/**
 * Starts watching, and returns the teardown.
 *
 * Mounted once by the root navigator. Two triggers, both chosen because they
 * are moments when the app's belief is likely to be stale and nothing else
 * would correct it:
 *
 *   - **Returning to the foreground.** The phone may have changed network,
 *     lost the shop's Wi-Fi, or been in a pocket in a lift for ten minutes.
 *   - **A slow poll, only while offline.** So coverage returning is noticed by
 *     the app rather than by the officer.
 */
export function startConnectivityWatch(): () => void {
  const { probe } = useConnectivityStore.getState();

  void probe();

  const timer = setInterval(() => {
    if (!useConnectivityStore.getState().online) void useConnectivityStore.getState().probe();
  }, OFFLINE_POLL_MS);

  const subscription = AppState.addEventListener('change', (status) => {
    if (status === 'active') void useConnectivityStore.getState().probe();
  });

  return () => {
    clearInterval(timer);
    subscription.remove();
  };
}

/**
 * Runs `onReconnect` each time the app crosses from offline to online.
 *
 * Separate from the store so the reaction — reloading the register — lives with
 * the navigator that owns those stores, rather than in the module that only
 * knows whether a socket opened.
 */
export function onReconnect(handler: () => void): () => void {
  let previous = useConnectivityStore.getState().online;

  return useConnectivityStore.subscribe((state) => {
    if (state.online && !previous) handler();
    previous = state.online;
  });
}
