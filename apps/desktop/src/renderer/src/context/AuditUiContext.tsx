import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import {
  DESKTOP_DASHBOARD_LABELS_I18N,
  UI_LABELS,
  getLocaleDirection,
  normalizeReportLocale,
  normalizeReportViewMode,
  resolveBilingualText,
  type BilingualText,
  type ReportDirection,
  type ReportLocale,
  type ReportViewMode,
} from '@auditor/shared';

export type DesktopLabelKey = keyof typeof DESKTOP_DASHBOARD_LABELS_I18N;
export type SharedUiLabelKey = keyof typeof UI_LABELS;

export interface AuditUiContextValue {
  readonly locale: ReportLocale;
  readonly direction: ReportDirection;
  readonly viewMode: ReportViewMode;
  readonly setLocale: (locale: ReportLocale) => void;
  readonly toggleLocale: () => void;
  readonly setViewMode: (mode: ReportViewMode) => void;
  readonly tDesktop: (key: DesktopLabelKey) => string;
  readonly tUi: (key: SharedUiLabelKey) => string;
  readonly tText: (entry: Partial<BilingualText> | null | undefined, fallback?: string) => string;
}

const DEFAULT_LOCALE: ReportLocale = 'en';
const DEFAULT_VIEW_MODE: ReportViewMode = 'dual';

function resolveDesktopLabel(key: DesktopLabelKey, locale: ReportLocale): string {
  return resolveBilingualText(DESKTOP_DASHBOARD_LABELS_I18N[key], locale, key).text;
}

function resolveSharedUiLabel(key: SharedUiLabelKey, locale: ReportLocale): string {
  return resolveBilingualText(UI_LABELS[key], locale, key).text;
}

const DEFAULT_CONTEXT_VALUE: AuditUiContextValue = {
  locale: DEFAULT_LOCALE,
  direction: getLocaleDirection(DEFAULT_LOCALE),
  viewMode: DEFAULT_VIEW_MODE,
  setLocale: () => {},
  toggleLocale: () => {},
  setViewMode: () => {},
  tDesktop: key => resolveDesktopLabel(key, DEFAULT_LOCALE),
  tUi: key => resolveSharedUiLabel(key, DEFAULT_LOCALE),
  tText: (entry, fallback = '') => resolveBilingualText(entry, DEFAULT_LOCALE, fallback).text,
};

const AuditUiContext = createContext<AuditUiContextValue>(DEFAULT_CONTEXT_VALUE);

export interface AuditUiProviderProps {
  readonly initialLocale?: ReportLocale;
  readonly initialViewMode?: ReportViewMode;
  readonly children: React.ReactNode;
}

export const AuditUiProvider: React.FC<AuditUiProviderProps> = ({
  initialLocale = DEFAULT_LOCALE,
  initialViewMode = DEFAULT_VIEW_MODE,
  children,
}) => {
  const [locale, setLocaleState] = useState<ReportLocale>(() =>
    normalizeReportLocale(initialLocale),
  );
  const [viewMode, setViewModeState] = useState<ReportViewMode>(() =>
    normalizeReportViewMode(initialViewMode),
  );

  const direction = useMemo(() => getLocaleDirection(locale), [locale]);

  useEffect(() => {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.dir = direction;
      document.documentElement.lang = locale;
    }
  }, [direction, locale]);

  const setLocale = useCallback((next: ReportLocale) => {
    setLocaleState(normalizeReportLocale(next));
  }, []);

  const toggleLocale = useCallback(() => {
    setLocaleState(prev => (prev === 'ar' ? 'en' : 'ar'));
  }, []);

  const setViewMode = useCallback((next: ReportViewMode) => {
    setViewModeState(normalizeReportViewMode(next));
  }, []);

  const tDesktop = useCallback(
    (key: DesktopLabelKey) => resolveDesktopLabel(key, locale),
    [locale],
  );

  const tUi = useCallback((key: SharedUiLabelKey) => resolveSharedUiLabel(key, locale), [locale]);

  const tText = useCallback(
    (entry: Partial<BilingualText> | null | undefined, fallback = '') =>
      resolveBilingualText(entry, locale, fallback).text,
    [locale],
  );

  const value = useMemo<AuditUiContextValue>(
    () => ({
      locale,
      direction,
      viewMode,
      setLocale,
      toggleLocale,
      setViewMode,
      tDesktop,
      tUi,
      tText,
    }),
    [locale, direction, viewMode, setLocale, toggleLocale, setViewMode, tDesktop, tUi, tText],
  );

  return <AuditUiContext.Provider value={value}>{children}</AuditUiContext.Provider>;
};

export function useAuditUi(): AuditUiContextValue {
  return useContext(AuditUiContext);
}
