import { useEffect, useState } from 'react';

/**
 * Delays a value until it stops changing.
 *
 * Used by every server-side search in the console: without it each keystroke is
 * a regex scan across a collection, and a supervisor typing a nine-character
 * reference number costs nine queries.
 */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
