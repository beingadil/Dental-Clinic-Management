import { useEffect, useState } from 'react';

/**
 * A value that only settles once it stops changing for `delayMs`.
 *
 * Search boxes use it to keep the input instant (every keystroke paints)
 * while the list behind it refilters at most once per pause, instead of on
 * every character — which is what makes a 10k-row register feel sluggish on
 * every keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
