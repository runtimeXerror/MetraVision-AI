import { useEffect, useState } from 'react';

/**
 * Subscribes to a media query.
 *
 * Layout is Tailwind's job almost everywhere in this console; this exists for
 * the handful of places where a *value* rather than a class has to change with
 * the viewport — chart axis widths and tick density, which Recharts takes as
 * props and cannot read from CSS.
 *
 * Guarded for the server-render case and for the older `addListener` API, since
 * a console used on departmental hardware will meet some elderly browsers.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);

    // The query may have changed since the initial state was computed.
    setMatches(list.matches);

    if (list.addEventListener) {
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    }

    list.addListener(onChange);
    return () => list.removeListener(onChange);
  }, [query]);

  return matches;
}

/** True below Tailwind's `sm` breakpoint — phone widths. */
export function useIsNarrow(): boolean {
  return useMediaQuery('(max-width: 639px)');
}
