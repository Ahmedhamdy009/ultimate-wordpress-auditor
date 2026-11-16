/**
 * Embedded CSS stylesheet for standalone offline bilingual HTML reports.
 * Supports responsive grids, dark/light system theme, Arabic RTL & English LTR,
 * pure-CSS Simple/Technical/Dual audience switcher (zero JS), and print layout.
 */
export function getStandaloneReportCss(): string {
  return `
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --card-subtle: #293548;
      --border: #334155;
      --text: #f8fafc;
      --text-muted: #cbd5e1;
      --text-dim: #94a3b8;
      --accent: #38bdf8;
      --critical: #ef4444;
      --critical-bg: rgba(239, 68, 68, 0.15);
      --high: #f97316;
      --high-bg: rgba(249, 115, 22, 0.15);
      --medium: #f59e0b;
      --medium-bg: rgba(245, 158, 11, 0.15);
      --low: #3b82f6;
      --low-bg: rgba(59, 130, 246, 0.15);
      --info: #64748b;
      --info-bg: rgba(100, 116, 139, 0.15);
      --success: #10b981;
      --success-bg: rgba(16, 185, 129, 0.15);
      --warning: #eab308;
      --warning-bg: rgba(234, 179, 8, 0.15);
      --radius-sm: 4px;
      --radius-md: 8px;
      --radius-lg: 12px;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      --font-sans: "Segoe UI", Tahoma, Arial, system-ui, -apple-system, sans-serif;
    }

    @media (prefers-color-scheme: light) {
      :root {
        --bg: #f8fafc;
        --card-bg: #ffffff;
        --card-subtle: #f1f5f9;
        --border: #cbd5e1;
        --text: #0f172a;
        --text-muted: #334155;
        --text-dim: #64748b;
        --accent: #0284c7;
        --critical: #dc2626;
        --critical-bg: #fee2e2;
        --high: #ea580c;
        --high-bg: #ffedd5;
        --medium: #d97706;
        --medium-bg: #fef3c7;
        --low: #2563eb;
        --low-bg: #dbeafe;
        --info: #475569;
        --info-bg: #f1f5f9;
        --success: #059669;
        --success-bg: #d1fae5;
        --warning: #ca8a04;
        --warning-bg: #fef9c3;
      }
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      line-height: 1.65;
      font-size: 14px;
      padding: 28px 16px;
    }

    .container { max-width: 1120px; margin: 0 auto; }
    .font-mono { font-family: var(--font-mono); }
    .text-accent { color: var(--accent); text-decoration: none; }
    .text-accent:hover { text-decoration: underline; }

    /* LTR isolation for URLs, selectors, rules, code blocks inside RTL */
    code, pre, [dir="ltr"] {
      unicode-bidi: isolate;
      direction: ltr;
    }

    /* Pure-CSS Audience View-Mode Switcher */
    .vm-radio {
      position: absolute;
      opacity: 0;
      width: 1px;
      height: 1px;
      pointer-events: none;
    }
    .vm-switcher-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 10px 16px;
      margin-bottom: 18px;
    }
    .vm-labels { display: flex; gap: 8px; flex-wrap: wrap; }
    .vm-tab {
      cursor: pointer;
      padding: 6px 14px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--card-subtle);
      color: var(--text-muted);
      font-size: 13px;
      font-weight: 600;
      user-select: none;
    }
    #vm-simple:checked ~ .vm-switcher-bar .vm-tab-simple,
    #vm-technical:checked ~ .vm-switcher-bar .vm-tab-technical,
    #vm-dual:checked ~ .vm-switcher-bar .vm-tab-dual {
      background: var(--accent);
      color: #ffffff;
      border-color: var(--accent);
    }
    #vm-simple:checked ~ .report-main .audience-technical { display: none; }
    #vm-technical:checked ~ .report-main .audience-simple { display: none; }
    #vm-dual:checked ~ .report-main .audience-simple,
    #vm-dual:checked ~ .report-main .audience-technical { display: block; }

    /* Cards & Layout */
    .report-header, .section-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 24px;
      margin-bottom: 20px;
    }
    .brand-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      padding-bottom: 14px;
      margin-bottom: 14px;
      border-bottom: 1px solid var(--border);
    }
    .brand-title {
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--accent);
    }
    .brand-badges { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .report-main-title { font-size: 24px; line-height: 1.3; margin-bottom: 10px; }
    .site-target-row {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      color: var(--text-muted);
      font-size: 13px;
      margin-bottom: 16px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--border);
    }
    .meta-item { display: flex; flex-direction: column; gap: 2px; }
    .meta-label { font-size: 11px; text-transform: uppercase; color: var(--text-dim); font-weight: 600; }
    .meta-value { font-size: 13px; color: var(--text); word-break: break-all; }

    .section-title { font-size: 18px; font-weight: 700; margin-bottom: 12px; }
    .section-subtitle { font-size: 13px; color: var(--text-muted); margin-bottom: 16px; }
    .section-head-stack { margin-bottom: 14px; }

    /* Badges & Status */
    .status-badge, .badge {
      display: inline-block;
      padding: 3px 9px;
      border-radius: var(--radius-sm);
      font-size: 11px;
      font-weight: 700;
      border: 1px solid var(--border);
      background: var(--card-subtle);
      color: var(--text);
    }
    .badge-sev.sev-critical, .status-badge.failed { background: var(--critical-bg); color: var(--critical); border-color: var(--critical); }
    .badge-sev.sev-high { background: var(--high-bg); color: var(--high); border-color: var(--high); }
    .badge-sev.sev-medium, .status-badge.cancelled { background: var(--medium-bg); color: var(--medium); border-color: var(--medium); }
    .badge-sev.sev-low { background: var(--low-bg); color: var(--low); border-color: var(--low); }
    .badge-sev.sev-info, .badge-sev.sev-informational { background: var(--info-bg); color: var(--text-muted); }
    .status-badge.completed { background: var(--success-bg); color: var(--success); border-color: var(--success); }

    .badge-conf.conf-confirmed { background: var(--success-bg); color: var(--success); border-color: var(--success); }
    .badge-conf.conf-firm { background: var(--low-bg); color: var(--low); border-color: var(--low); }
    .badge-conf.conf-potential { background: var(--warning-bg); color: var(--warning); border-color: var(--warning); }

    .alert-banner {
      border-radius: var(--radius-md);
      padding: 16px 20px;
      margin-bottom: 20px;
      border: 1px solid var(--warning);
      background: var(--warning-bg);
    }
    .alert-banner p { margin-top: 6px; font-size: 13px; }
    .alert-banner ul { margin: 8px 20px; font-size: 13px; }

    /* Health Triad & Summary Grids */
    .triad-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px;
      margin-bottom: 18px;
    }
    .triad-card {
      background: var(--card-subtle);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 16px;
    }
    .triad-value { font-size: 28px; font-weight: 800; line-height: 1.2; margin: 4px 0; }
    .triad-sub { font-size: 12px; color: var(--text-muted); }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .summary-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 14px;
      text-align: center;
    }
    .summary-card .count { font-size: 24px; font-weight: 800; }
    .summary-card .label { font-size: 12px; color: var(--text-muted); }
    .summary-card.card-critical { border-top: 3px solid var(--critical); }
    .summary-card.card-high { border-top: 3px solid var(--high); }
    .summary-card.card-medium { border-top: 3px solid var(--medium); }
    .summary-card.card-low { border-top: 3px solid var(--low); }
    .summary-card.card-info { border-top: 3px solid var(--info); }

    .details-table-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
    }
    .data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .data-table th, .data-table td {
      padding: 8px 10px;
      border-bottom: 1px solid var(--border);
      text-align: start;
      vertical-align: top;
    }
    .data-table th { color: var(--text-dim); font-size: 11px; text-transform: uppercase; }

    /* Detected Stack Pills */
    .stack-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }
    .stack-chip {
      padding: 4px 10px;
      border-radius: var(--radius-sm);
      background: var(--card-subtle);
      border: 1px solid var(--border);
      font-size: 12px;
    }

    /* 7-Chart Grid */
    .charts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 16px;
    }
    .chart-card {
      background: var(--card-subtle);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .chart-card-wide { grid-column: 1 / -1; }
    .chart-card-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }
    .chart-card-title { font-size: 14px; font-weight: 700; }
    .chart-status-pill {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--card-bg);
      color: var(--text-muted);
    }
    .chart-status-measured { color: var(--success); border-color: var(--success); }
    .chart-status-approximated, .chart-status-partial { color: var(--warning); border-color: var(--warning); }
    .chart-status-unavailable, .chart-status-excluded { color: var(--text-dim); }
    .chart-rows { display: flex; flex-direction: column; gap: 10px; }
    .chart-row-meta {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8px;
      font-size: 12px;
      margin-bottom: 3px;
    }
    .chart-row-label { font-weight: 600; word-break: break-word; }
    .chart-row-value { font-size: 12px; color: var(--text-muted); white-space: nowrap; }
    .chart-svg { width: 100%; height: 14px; display: block; }
    .chart-row-sub { font-size: 11px; color: var(--text-dim); margin-top: 2px; }
    .chart-empty-note, .chart-disclaimer-note { font-size: 12px; color: var(--text-muted); }
    .chart-reasons-list { margin: 4px 16px; font-size: 11px; color: var(--text-dim); }
    .chart-url-truncate { max-width: 72%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* Laboratory Performance Metrics */
    .perf-disclaimer-callout {
      padding: 12px 14px;
      border-radius: var(--radius-md);
      background: rgba(56, 189, 248, 0.08);
      border: 1px solid rgba(56, 189, 248, 0.3);
      margin-bottom: 14px;
      font-size: 13px;
    }
    .perf-metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
      gap: 12px;
      margin-bottom: 14px;
    }
    .perf-metric-tile {
      background: var(--card-subtle);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 12px;
    }
    .perf-metric-top { display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-bottom: 6px; }
    .perf-metric-label { font-size: 12px; font-weight: 600; }
    .perf-metric-value { font-size: 20px; font-weight: 800; }
    .perf-metric-target, .perf-metric-limitation, .perf-metric-capped { font-size: 11px; color: var(--text-dim); margin-top: 4px; }
    .badge-rating.rating-good { background: var(--success-bg); color: var(--success); border-color: var(--success); }
    .badge-rating.rating-needs-improvement { background: var(--warning-bg); color: var(--warning); border-color: var(--warning); }
    .badge-rating.rating-poor { background: var(--critical-bg); color: var(--critical); border-color: var(--critical); }
    .perf-resources-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 10px;
      margin-bottom: 12px;
    }
    .perf-resource-stat { background: var(--card-subtle); padding: 10px; border-radius: var(--radius-sm); display: flex; flex-direction: column; }
    .perf-stat-label { font-size: 11px; color: var(--text-dim); }
    .perf-stat-val { font-size: 14px; font-weight: 700; }
    .perf-bottleneck-card { background: var(--card-subtle); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 12px; margin-top: 8px; }

    /* Finding & Recommendation Cards */
    .rec-card, .finding-card {
      background: var(--card-subtle);
      border: 1px solid var(--border);
      border-inline-start: 4px solid var(--accent);
      border-radius: var(--radius-md);
      padding: 18px;
      margin-bottom: 16px;
    }
    .rec-card.sev-critical, .finding-card.sev-critical { border-inline-start-color: var(--critical); }
    .rec-card.sev-high, .finding-card.sev-high { border-inline-start-color: var(--high); }
    .rec-card.sev-medium, .finding-card.sev-medium { border-inline-start-color: var(--medium); }
    .rec-card.sev-low, .finding-card.sev-low { border-inline-start-color: var(--low); }
    .rec-card.sev-info, .finding-card.sev-info { border-inline-start-color: var(--info); }

    .finding-header {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 12px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
    }
    .finding-title-row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .finding-index { font-weight: 800; color: var(--text-dim); font-family: var(--font-mono); }
    .finding-title { font-size: 16px; font-weight: 700; }
    .finding-badges { display: flex; flex-wrap: wrap; gap: 6px; }
    .detail-label { font-size: 12px; font-weight: 700; color: var(--accent); margin-bottom: 4px; text-transform: uppercase; }
    .finding-detail-section { margin-top: 12px; }
    .step-list { margin: 6px 20px; display: flex; flex-direction: column; gap: 4px; }
    .evidence-block, .code-block {
      background: #0b1120;
      color: #e2e8f0;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 12px;
      overflow-x: auto;
      font-size: 12px;
      margin-top: 6px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .visual-evidence-figure {
      margin-top: 8px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      overflow: hidden;
      background: var(--card-bg);
    }
    .visual-evidence-img {
      display: block;
      max-width: 100%;
      max-height: 460px;
      width: auto;
      height: auto;
      margin: 0 auto;
    }
    .visual-evidence-caption {
      padding: 8px 12px;
      font-size: 12px;
      color: var(--text-muted);
      border-top: 1px solid var(--border);
    }
    .visual-evidence-fallback {
      margin-top: 8px;
      padding: 10px 12px;
      border-radius: var(--radius-sm);
      border: 1px dashed var(--border);
      font-size: 12px;
      color: var(--text-dim);
    }
    .empty-findings { text-align: center; padding: 36px 16px; color: var(--text-muted); }
    .empty-icon { font-size: 32px; color: var(--success); margin-bottom: 8px; }

    .report-footer {
      text-align: center;
      padding: 24px 16px;
      color: var(--text-dim);
      font-size: 12px;
      border-top: 1px solid var(--border);
      margin-top: 24px;
    }

    @media (max-width: 640px) {
      body { padding: 12px 8px; }
      .report-header, .section-card { padding: 16px; }
      .charts-grid { grid-template-columns: 1fr; }
    }

    @media print {
      body { background: #fff !important; color: #000 !important; font-size: 10.5pt; padding: 0; }
      .no-print { display: none !important; }
      .container { max-width: 100%; }
      .report-header, .section-card, .rec-card, .finding-card, .chart-card, .triad-card {
        background: #fff !important;
        color: #111 !important;
        border: 1px solid #cbd5e1 !important;
        box-shadow: none !important;
        break-inside: avoid;
      }
      .evidence-block, .code-block { background: #f8fafc !important; color: #0f172a !important; }
      details > summary { list-style: none; }
    }
  `;
}
