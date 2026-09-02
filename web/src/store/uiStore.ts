import { create } from 'zustand';

/**
 * Presentation preferences that outlive a route change.
 *
 * Persisted to `localStorage` rather than the session store: a collapsed
 * sidebar and a chosen theme are conveniences tied to the workstation, not to
 * the person signed in, and leaking them across a sign-out harms nobody.
 */

type Theme = 'light' | 'dark';

const THEME_KEY = 'sih26034.theme';
const RAIL_KEY = 'sih26034.rail';

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // A blocked store just means the choice lasts for this page.
  }
}

interface UiState {
  theme: Theme;
  sidebarCollapsed: boolean;
  /** Drives the slide-over rail below the lg breakpoint. */
  mobileNavOpen: boolean;

  toggleTheme: () => void;
  toggleSidebar: () => void;
  setMobileNav: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: readTheme(),
  sidebarCollapsed: readCollapsed(),
  mobileNavOpen: false,

  toggleTheme() {
    const theme = get().theme === 'dark' ? 'light' : 'dark';
    applyTheme(theme);
    set({ theme });
  },

  toggleSidebar() {
    const sidebarCollapsed = !get().sidebarCollapsed;
    try {
      localStorage.setItem(RAIL_KEY, sidebarCollapsed ? 'collapsed' : 'expanded');
    } catch {
      // Non-fatal.
    }
    set({ sidebarCollapsed });
  },

  setMobileNav(mobileNavOpen) {
    set({ mobileNavOpen });
  },
}));

/** Applies the stored theme before React paints, so there is no flash. */
export function initTheme(): void {
  applyTheme(readTheme());
}
