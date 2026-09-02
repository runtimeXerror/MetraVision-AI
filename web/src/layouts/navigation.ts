import {
  ClipboardCheck,
  FileBarChart,
  LayoutDashboard,
  Package,
  ScrollText,
  Settings,
  ShieldAlert,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';

import type { UserRole } from '@/types/api';

/**
 * The navigation model.
 *
 * A single declaration drives the sidebar, the mobile rail and the route guards,
 * so a page cannot appear in the menu for a role the router will then refuse.
 */

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Minimum role. Omitted means any signed-in user. */
  minRole?: UserRole;
  /** Shown as a count chip when the value is non-zero. */
  badgeKey?: 'pendingReviews' | 'violations';
  description: string;
}

export interface NavSection {
  heading: string;
  items: NavItem[];
}

const RANK: Record<UserRole, number> = { INSPECTOR: 0, SUPERVISOR: 1, ADMIN: 2 };

export const NAV_SECTIONS: NavSection[] = [
  {
    heading: 'Overview',
    items: [
      {
        to: '/dashboard',
        label: 'Dashboard',
        icon: LayoutDashboard,
        description: 'Compliance position at a glance',
      },
    ],
  },
  {
    heading: 'Enforcement',
    items: [
      {
        to: '/inspections',
        label: 'Inspections',
        icon: ClipboardCheck,
        description: 'Every inspection on record',
      },
      {
        to: '/reviews',
        label: 'Review Centre',
        icon: UserRound,
        badgeKey: 'pendingReviews',
        description: 'Readings awaiting human verification',
      },
      {
        to: '/violations',
        label: 'Violations',
        icon: ShieldAlert,
        badgeKey: 'violations',
        description: 'Findings raised against packages',
      },
    ],
  },
  {
    heading: 'Registry',
    items: [
      {
        to: '/inspectors',
        label: 'Inspectors',
        icon: Users,
        minRole: 'SUPERVISOR',
        description: 'Field officers and their activity',
      },
      {
        to: '/products',
        label: 'Products',
        icon: Package,
        description: 'Commodities inspected, rolled up',
      },
      {
        to: '/rules',
        label: 'Rule Repository',
        icon: ScrollText,
        description: 'Declarations required, and since when',
      },
      {
        to: '/reports',
        label: 'Reports',
        icon: FileBarChart,
        description: 'Inspection and compliance reporting',
      },
    ],
  },
  {
    heading: 'Account',
    items: [
      {
        to: '/profile',
        label: 'Profile',
        icon: UserRound,
        description: 'Your account',
      },
      {
        to: '/settings',
        label: 'Settings',
        icon: Settings,
        description: 'Preferences and system information',
      },
    ],
  },
];

export function canSee(item: NavItem, role: UserRole | undefined): boolean {
  if (!item.minRole) return true;
  return role !== undefined && RANK[role] >= RANK[item.minRole];
}

/** The sections a role may see, with empty sections dropped. */
export function visibleSections(role: UserRole | undefined): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => canSee(item, role)),
  })).filter((section) => section.items.length > 0);
}
