/**
 * Navigation Types and Module Definitions
 */

export type ViewId =
  'overview' | 'scans' | 'projects' | 'reports' | 'target-validator' | 'system-diagnostics';

export interface NavItem {
  readonly id: ViewId;
  readonly label: string;
  readonly description: string;
}

export interface UpcomingModule {
  readonly id: string;
  readonly label: string;
  readonly badge: string;
  readonly phase: string;
}

export const ACTIVE_NAV_ITEMS: readonly NavItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Dashboard overview and audit control summary',
  },
  {
    id: 'scans',
    label: 'Audit & Scans',
    description: 'Execute bounded site audits, monitor live crawling, and inspect findings',
  },
  {
    id: 'projects',
    label: 'Projects & Sites',
    description: 'Local workspace and audited web site registry',
  },
  {
    id: 'reports',
    label: 'Reports & Exports',
    description: 'Audit report generation, history, and exported technical files',
  },
  {
    id: 'target-validator',
    label: 'Target Validator',
    description: 'RFC 3986 target URL syntax and scope authorization',
  },
  {
    id: 'system-diagnostics',
    label: 'System Diagnostics',
    description: 'Electron runtime environment metadata and IPC health',
  },
] as const;

export const UPCOMING_MODULES: readonly UpcomingModule[] = [
  { id: 'wp-core', label: 'WordPress Core', badge: 'Upcoming', phase: 'Phase 6' },
  { id: 'plugins-themes', label: 'Plugins & Themes', badge: 'Upcoming', phase: 'Phase 6' },
  { id: 'elementor', label: 'Elementor', badge: 'Upcoming', phase: 'Phase 6' },
  { id: 'woocommerce', label: 'WooCommerce', badge: 'Upcoming', phase: 'Phase 6' },
  { id: 'security', label: 'Security', badge: 'Upcoming', phase: 'Phase 3' },
  { id: 'performance', label: 'Performance', badge: 'Upcoming', phase: 'Phase 5' },
] as const;
