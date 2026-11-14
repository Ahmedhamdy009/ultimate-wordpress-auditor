# Phase 7 — Batch 7.3: Advanced Performance Engine
## Technical Architecture & Implementation Plan

- **Project:** Ultimate WordPress & Website Auditor
- **Workspace:** `D:\ahmed`
- **Repository:** `https://github.com/Ahmedhamdy009/ultimate-wordpress-auditor`
- **Branch:** `main` (Synchronized with `origin/main`)
- **Base Release:** `v0.1.7` (Commit `0f8ec89c349d9efe9cb7a989da46f0bdb5d7f03b`)
- **Batch 7.2 Final Correction Commit:** `c63e2b32c18e2fcc909451846e6b228acb988975`
- **Authoritative CI Run:** `#43480375216`
- **Automated Test Baseline:** **1,445 tests passed across 139 test files** (0 failures, 6 skipped)
- **Target Subsystem:** Advanced Performance Engine (Lab Web Vitals, Navigation & Resource Timing, Asset Optimization, Bottleneck Classification)

---

## 1. Executive Summary & Objectives

The primary objective of **Batch 7.3** is to expand the *Ultimate WordPress & Website Auditor* from basic static HTML performance checks (e.g., response duration, HTML document byte size, raw script/stylesheet counts) into an evidence-based, standards-compliant **Advanced Performance Engine**.

This engine operates across two synchronized auditing tiers:
1. **Static HTML & Crawler Tier:** Pre-render structural analysis, link inspection, and raw transport transfer metrics.
2. **Hardened Chromium Browser Tier:** Deep, empirical lab measurements collected during controlled Playwright sessions through the local SSRF-filtered proxy without external network leaks.

### Core Architectural Principles
- **Empirical Lab Grounding:** Every reported metric must represent actual measured values collected from the browser or network pipeline under documented conditions.
- **Strict Metric Taxonomy & Truth-in-Measurement:** Never conflate lab measurements with real-user field data (CrUX). Never claim simulated INP is field INP. Never claim Lighthouse simulation equivalence without running the Lighthouse synthetic simulation engine.
- **Strict Nullability:** Missing, unsupported, or timed-out metrics must remain `null` or `unavailable`, never coerced or defaulted to `0` or `0ms`.
- **Zero Additional Navigations:** All browser-tier performance data is collected during the single, existing page navigation pass within `ScanOrchestrator.executeBrowserAudit()`.
- **Zero Security Boundary Regressions:** All subresource fetches remain constrained by the local proxy server with DNS pinning, loopback defense, and WebRTC neutralization strictly preserved.

---

## 2. Metric Taxonomy & Measurement Boundaries

To prevent misleading claims, all performance metrics are classified into three distinct categories:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          METRIC TAXONOMY & BOUNDARIES                           │
├─────────────────────────┬──────────────────────────┬────────────────────────────┤
│   A. LAB MEASUREMENTS   │   B. FIELD MEASUREMENTS  │   C. ESTIMATED INDICATORS  │
│ (Empirical in Chromium) │ (Real-User Experiences)  │ (Evidence-Based Heuristic) │
├─────────────────────────┼──────────────────────────┼────────────────────────────┤
│ • Navigation TTFB (ms)  │ • Field INP (CrUX)       │ • Render-Blocking CSS/JS   │
│ • DNS / TCP / TLS (ms)  │ • Field LCP (CrUX)       │ • Oversized Images Risk    │
│ • First Paint / FP (ms) │ • Field CLS (CrUX)       │ • Missing Modern Formats   │
│ • First Contentful Paint│                          │ • Bottleneck Classification│
│   (FCP) (ms)            │ [Explicitly Unsupported  │ • Unminified / Uncompressed│
│ • Largest Contentful    │  in Local Lab Sessions]  │   Asset Indicators         │
│   Paint (LCP) (ms)      │                          │                            │
│ • Lab CLS (Session Win) │                          │                            │
│ • Total Blocking Time   │                          │                            │
│   (TBT) (ms)            │                          │                            │
│ • Resource Timing (ms)  │                          │                            │
└─────────────────────────┴──────────────────────────┴────────────────────────────┘
```

### 2.1 Navigation & Web Vitals Measurement Specifications

| Metric | Measurement Source & Methodology | Exact Window & Termination Conditions | Measurement Boundaries & Limitations |
|---|---|---|---|
| **TTFB (Time to First Byte)** | `PerformanceNavigationTiming` (`responseStart - requestStart`) | Initial document navigation from socket dispatch to receipt of first response byte | Measures network transit time + server wait/queue latency. Does NOT isolate pure server-side processing without `Server-Timing` header evidence. |
| **First Contentful Paint (FCP)** | `PerformancePaintTiming` (`name === 'first-contentful-paint'`) | From navigation start to first rendering of text, image, or non-white canvas/SVG | Empirical Chromium lab observation. Represents when user first sees content. Missing value yields `null`. |
| **Largest Contentful Paint (LCP)** | `PerformanceObserver({ type: 'largest-contentful-paint', buffered: true })` | Observation begins at navigation start. **Lifecycle Termination:** First of `visibilitychange` to hidden, user interaction, or page load settle (load event + 1,000ms settle delay; max 5,000ms hard ceiling). Tracks explicit **Completeness States**: `complete`, `capped`, `unavailable`, `interrupted`. | Captures largest contentful element (image, video poster, block text). The last candidate before termination is taken. Capped observations are explicitly flagged in findings/reports and never presented as complete. Missing candidate yields `null`, never `0`. Automated crawl does not simulate continuous real-user behavior. |
| **Total Blocking Time (TBT)** | `PerformanceObserver({ type: 'longtask', buffered: true })` | Exact window between `FCP` and Page Settle | Sums `(duration - 50ms)` for all long tasks >= 50ms occurring strictly after FCP. Documented as Chromium Empirical Lab TBT; NO claim of Lighthouse simulation. Missing FCP yields `null`. |
| **Cumulative Layout Shift (CLS)** | `PerformanceObserver({ type: 'layout-shift', buffered: true })` | Entire single-page session duration | Implements official W3C session-window algorithm (5s max window, 1s max gap, excluding `hadRecentInput === true`). Unified with `VisualAuditor` to prevent duplicate observers. |
| **Interaction to Next Paint (INP)** | **Field-Only / Unsupported** | N/A | Fundamentally requires continuous discrete real-user input streams across session lifecycle. Stored as `null` with status `"unsupported_in_lab"`. Zero synthetic INP claims. |

---

## 3. Detailed Architecture of the Four Subsystems

```
apps/desktop/src/main/scanner/performance/
├── index.ts                          # Public exports and facade
├── types.ts                          # Performance metric interfaces, schemas, thresholds
├── browser-performance-collector.ts  # In-browser PerformanceObserver & Timing extractor
├── resource-performance-engine.ts    # Render-blocking, payload, image & compression analysis
├── performance-analyzer.ts           # Metric evaluation, threshold checking & finding generator
└── bottleneck-classifier.ts          # Root-cause diagnostic classifier
```

### 3.1 Subsystem 1: Browser Performance Collector (`browser-performance-collector.ts`)

- **Unified In-Browser Init Script (`window.__auditorPerformance`):**
  - Injected into page context prior to navigation via Playwright `page.addInitScript()`.
  - Concurrently registers observers for:
    - `'largest-contentful-paint'` (buffered: true)
    - `'layout-shift'` (buffered: true)
    - `'longtask'` (buffered: true)
  - Tracks `document.visibilityState` to handle visibility changes per W3C lifecycle specifications.
  - Sets `performance.setResourceTimingBufferSize(500)` to prevent buffer truncation on asset-dense pages.
- **Post-Navigation Evaluation:**
  - Extracts Navigation Timing timestamps: DNS (`domainLookupEnd - domainLookupStart`), TCP (`connectEnd - connectStart`), TLS (`connectEnd - secureConnectionStart`), TTFB (`responseStart - requestStart`), Content Download (`responseEnd - responseStart`), DOM Interactive, DOM Content Loaded, and Load Event.
  - Extracts Paint Timing: First Paint (`FP`) and First Contentful Paint (`FCP`).
  - Terminates LCP observation cleanly and records explicit completeness states:
    - `complete`: Observation terminated under a valid lifecycle condition (e.g. document hidden, settled post-load) with an established candidate.
    - `capped`: Observation terminated because the configured deadline (5,000ms ceiling) was reached before full lifecycle settlement. The candidate is preserved with limitation notice.
    - `unavailable`: No valid LCP candidate was recorded by the browser engine.
    - `interrupted`: Navigation error, browser crash, or collection failure prevented reliable observation.
    - Extracts winning candidate's selector, tag name, element URL, load time, render time, and bounding dimensions. Capped status is transparently surfaced in finding evidence and report telemetry.
  - Documents that automated crawling does not reproduce continuous real-user interaction behavior.
  - Evaluates all `longtask` entries occurring between FCP and settle to compute TBT.
  - Aggregates layout shifts using the existing session-window algorithm, sharing data with `LayoutShiftCollector` without duplicate script overhead.

### 3.2 Subsystem 2: Resource Performance Engine (`resource-performance-engine.ts`)

- **Cross-Origin Restrictions & Timing-Allow-Origin (TAO):**
  - Inspects `PerformanceResourceTiming` entries.
  - Cross-references each entry URL against Playwright network interception records (`CapturedNetworkResource`).
  - **Rule:** `transferSize === 0` is NEVER interpreted as a zero-byte resource or assumed to be cached solely from that value.
  - Classifies `transferSize === 0` strictly based on corroborating evidence:
    - `cached`: Supported by reliable evidence, such as a verified HTTP 304 Not Modified status code or an explicit browser cache indicator in response headers.
    - `tao_restricted`: Cross-origin asset without matching `Timing-Allow-Origin` header (timestamps/sizes zeroed by browser security).
    - `zero_byte`: Verified via HTTP 204 No Content or confirmed `Content-Length: 0` in Playwright response headers.
    - `unknown`: When evidence cannot distinguish between cached, TAO-restricted, and zero-byte states, size is marked as `unknown` / `unavailable`. Resource sizes are never fabricated.
- **Transport Compression Analysis:**
  - Validates `Content-Encoding` directly from Playwright HTTP response headers (`gzip`, `br`, `zstd`, `deflate`).
  - Emits `PERF_RES_UNCOMPRESSED_ASSET` for compressible text MIME types (`text/html`, `text/css`, `application/javascript`, `application/json`, `image/svg+xml`) exceeding 10 KiB without compression.
- **Three-Tier Size Metrics:**
  - Transferred Size (headers + compressed body over wire).
  - Encoded Body Size (compressed body).
  - Decoded Body Size (uncompressed body in memory).
- **Render-Blocking Resource Analysis:**
  - Detects synchronous `<link rel="stylesheet">` tags in `<head>` without `disabled` or non-matching `media` attributes.
  - Detects synchronous `<script src="...">` tags in `<head>` lacking `async`, `defer`, or `type="module"`.
  - Correlates with Resource Timing duration to quantify total critical path render delay.
- **Image Optimization & Layout Analysis:**
  - Evaluates `img.currentSrc` (the actual resource chosen by the browser layout engine) rather than static fallback `src`.
  - Calibrates for Device Pixel Ratio (`dpr = window.devicePixelRatio`): target pixels = `renderedWidthCss * dpr`.
  - Oversized Image Rule: Only flags when `naturalWidth > (renderedWidthCss * dpr * 1.5)` (50% safety margin above DPR requirements).
  - SVG Assets: Strictly excluded from dimension mismatch and bitmap re-compression checks.
  - CSS Background Images: Evaluates `background-image: url(...)` on containers exceeding 100px width/height.
  - **LCP Lazy Loading Anti-Pattern:** Flags images with `loading="lazy"` that are identified as the LCP element or positioned in the initial above-the-fold viewport (`top < window.innerHeight`) under `PERF_LCP_IMG_LAZY_LOADED`.
  - **Lazy Loading Recommendation Guard:** Strictly restricts recommendations for adding `loading="lazy"` to images positioned below the viewport fold (`top >= window.innerHeight`). NEVER recommends lazy loading for above-the-fold or LCP images.
  - **Zero Speculative Savings Claims:** Avoids unsubstantiated percentage claims when identifying legacy JPEG/PNG assets (> 100 KiB); frames modern format migration as an evidence-based recommendation for evaluation.

### 3.3 Subsystem 3: Performance Bottleneck Classifier (`bottleneck-classifier.ts`)

Synthesizes timing, resource, and thread contention metrics into a structured diagnosis:

```typescript
export interface BottleneckDiagnosis {
  readonly classification:
    | 'SERVER_LATENCY'
    | 'RENDER_BLOCKING_RESOURCES'
    | 'HEAVY_ASSET_PAYLOAD'
    | 'MAIN_THREAD_EXECUTION'
    | 'LAYOUT_INSTABILITY';
  readonly confidence: 'confirmed' | 'potential';
  readonly status: 'confirmed' | 'potential';
  readonly supportingEvidence: {
    readonly primaryMetricName: string;
    readonly observedValue: number;
    readonly thresholdValue: number;
    readonly unit: string;
    readonly relatedMeasurements: Record<string, unknown>;
  };
  readonly inferenceRationale: string;
  readonly limitationsNotice: string;
}
```

- **Diagnostic Inference Rules:**
  - `SERVER_LATENCY`: TTFB > 800ms. Confidence is `'potential'`. Rationale documents that TTFB represents combined transit and server response latency; it does not isolate internal database or script runtime without server instrumentation.
  - `RENDER_BLOCKING_RESOURCES`: FCP > 1,800ms with >= 2 render-blocking resources in `<head>` accounting for > 50% of FCP delay. Confidence is `'confirmed'` when Resource Timing proves critical path blockage.
  - `HEAVY_ASSET_PAYLOAD`: Total page transfer > 3 MiB or individual resource > 1 MiB. Confidence is `'confirmed'`.
  - `MAIN_THREAD_EXECUTION`: TBT > 600ms or long tasks total duration > 1,000ms. Confidence is `'confirmed'`.
  - `LAYOUT_INSTABILITY`: Lab CLS > 0.25. Confidence is `'confirmed'`.
- All classifications are labeled as *"Evidence-Based Diagnostic Inferences"* with full transparent disclosures.

### 3.4 Subsystem 4: Orchestrator, Findings & Reporting Integration

- **Orchestration Integration:**
  - Wires directly into `ScanOrchestrator.executeBrowserAudit()`.
  - Reuses the existing managed page acquisition; zero additional page navigations.
  - Enforces a bounded 5,000ms settling budget so slow-loading scripts cannot delay scan completion.
  - Respects caller `AbortSignal` for instant in-flight cancellation.
- **Findings Taxonomy & Categorization:**
  - Canonical categories in `@auditor/shared`: `static-performance` and `layout-stability`.
  - Standardized rule IDs:
    - `PERF_LAB_SLOW_TTFB` (Medium severity, potential confidence)
    - `PERF_LAB_SLOW_FCP` (Medium severity, confirmed confidence)
    - `PERF_LAB_SLOW_LCP` (High/Medium severity, confirmed confidence)
    - `PERF_LAB_HIGH_TBT` (High/Medium severity, confirmed confidence)
    - `PERF_RES_RENDER_BLOCKING_CSS` (Medium severity, confirmed confidence)
    - `PERF_RES_RENDER_BLOCKING_JS` (Medium severity, confirmed confidence)
    - `PERF_RES_OVERSIZED_IMAGE` (Low severity, firm confidence)
    - `PERF_RES_UNCOMPRESSED_ASSET` (Medium severity, confirmed confidence)
    - `PERF_LCP_IMG_LAZY_LOADED` (Medium severity, confirmed confidence)
    - `PERF_BOTTLENECK_DIAGNOSIS` (Info/Medium severity, evidence-backed diagnostic)
- **Reporting Enhancements:**
  - Updates `ReportScanRunModel` and `ReportSummaryModel` to serialize the performance metrics summary block.
  - HTML Report Generator renders a dedicated **Performance Lab Metrics** card with visual threshold badges (Good / Needs Improvement / Poor), explicit lab methodology notes, and CrUX field-data disclaimers.
  - JSON Exporter includes full structured `performance` telemetry.
  - CSV Exporter exports tabular performance findings with sanitized evidence.

---

## 4. Logical Implementation Batches

The work is organized into five sequential batches, each with clear deliverables and acceptance criteria:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   BATCH 7.3 IMPLEMENTATION ROADMAP                     │
├───────────────┬────────────────────────────────────────────────────────┤
│ Batch 7.3.1   │ Core Web Vitals Lab Engine                             │
│               │ (Timing, Paint, LCP, CLS, TBT, INP boundary)           │
├───────────────┼────────────────────────────────────────────────────────┤
│ Batch 7.3.2   │ Resource Performance Engine                            │
│               │ (Render-blocking, Payload weights, Images, Compression)│
├───────────────┼────────────────────────────────────────────────────────┤
│ Batch 7.3.3   │ Bottleneck Classification & Orchestrator Integration   │
│               │ (Root cause diagnosis, Browser audit wiring, Timeouts) │
├───────────────┼────────────────────────────────────────────────────────┤
│ Batch 7.3.4   │ Findings Taxonomy, Persistence & Report Integration    │
│               │ (SQLite persistence, HTML/JSON/CSV report generators)  │
├───────────────┼────────────────────────────────────────────────────────┤
│ Batch 7.3.5   │ Quality Gates Verification & Acceptance Audit          │
│               │ (Unit/E2E test suites, 6 quality gates, Delivery Report)│
└───────────────┴────────────────────────────────────────────────────────┘
```

### 4.1 Batch 7.3.1: Core Web Vitals Lab Engine
- **Files to create/modify:**
  - `packages/shared/src/schemas/performance.ts`: Shared DTOs, thresholds, nullability definitions.
  - `apps/desktop/src/main/browser/performance-collector.ts`: Unified init script and evaluation logic for Navigation Timing, Paint Timing, LCP, CLS, and TBT.
  - `apps/desktop/src/main/browser/performance-types.ts`: Collector interfaces and options.
- **Acceptance Criteria:**
  - Accurate extraction of Navigation Timing (TTFB, DNS, TCP, TLS, DOMContentLoaded, Load).
  - Accurate extraction of Paint Timing (FCP, FP).
  - LCP candidate extraction with element selector, render time, and bounding dimensions.
  - TBT calculated strictly from long tasks >= 50ms between FCP and settle.
  - INP explicitly recorded as `null` with status `"unsupported_in_lab"`.
  - Missing metrics return `null`, never `0`.
  - Comprehensive unit test suite covering collector logic and mock performance entries.

### 4.2 Batch 7.3.2: Resource & Asset Performance Engine
- **Files to create/modify:**
  - `apps/desktop/src/main/browser/resource-performance-engine.ts`: Resource Timing evaluation, TAO restrictions, compression headers, render-blocking detection, DPR-adjusted image analysis.
- **Acceptance Criteria:**
  - Detection of render-blocking stylesheets and synchronous scripts in `<head>`.
  - `transferSize === 0` classified accurately into `tao_restricted`, `cached`, or `zero_byte`.
  - `Content-Encoding` verified via Playwright response headers (not guessed).
  - Oversized image analysis adjusted for DPR (`renderedWidth * dpr * 1.5`); SVGs exempted.
  - Anti-pattern finding emitted when LCP or above-the-fold image has `loading="lazy"`.
  - Zero speculative percentage savings claims on modern formats.
  - Unit tests verifying all resource and image checks against HTML/timing fixtures.

### 4.3 Batch 7.3.3: Bottleneck Classification & Orchestrator Integration
- **Files to create/modify:**
  - `apps/desktop/src/main/scanner/performance/bottleneck-classifier.ts`: Diagnostic classification logic.
  - `apps/desktop/src/main/scanner/orchestrator/orchestrator.ts`: Integration into `executeBrowserAudit()`.
- **Acceptance Criteria:**
  - Evidence-backed bottleneck classifications with documented inference rationales and limitations notices.
  - TTFB does not infer server processing without server instrumentation evidence.
  - Direct integration into browser audit pass without additional page navigations.
  - Strict 5,000ms settling budget and clean `AbortSignal` cancellation handling.

### 4.4 Batch 7.3.4: Findings Taxonomy, Persistence & Report Integration
- **Files to create/modify:**
  - `packages/shared/src/schemas/categories.ts`: Register rule IDs and canonical category mapping.
  - `apps/desktop/src/main/reports/assembler.ts`, `html-generator.ts`, `json-generator.ts`, `csv-generator.ts`: Performance lab metrics section with visual threshold badges and CrUX disclaimers.
  - `apps/desktop/src/renderer/src/components/reports/SecureReportPreview.tsx`: Safe sandboxed iframe preview rendering.
- **Acceptance Criteria:**
  - Findings persisted cleanly into SQLite with confirmed/potential confidence ratings.
  - HTML, JSON, and CSV reports present performance metrics and bottleneck diagnoses.
  - Zero PII, credentials, or secrets leak into finding evidence blocks.

### 4.5 Batch 7.3.5: Quality Gates Verification & Acceptance Audit
- **Files to create/modify:**
  - Automated test suites:
    - `apps/desktop/tests/browser/performance-collector.test.ts`
    - `apps/desktop/tests/browser/resource-performance-engine.test.ts`
    - `apps/desktop/tests/scanner/performance/bottleneck-classifier.test.ts`
    - `apps/desktop/tests/integration/performance-audit-e2e.test.ts`
  - Delivery Report: `docs/audits/phase-7-batch-7.3-delivery-report.md`.
- **Acceptance Criteria:**
  - All 1,445 existing automated tests preserved green.
  - Net addition of ~40+ new automated tests covering all performance engines.
  - All 6 quality gates passing locally (`test:package-exports`, `format:check`, `lint`, `typecheck`, `build`, `test`).
  - Production build clean and verified.
  - Comprehensive delivery report documenting architecture, limitations, and verification evidence.

---

## 5. Risk Assessment & Mitigation

| Potential Risk | Technical Mitigation |
|---|---|
| **PerformanceObserver buffer overflow on heavy pages** | Explicitly set `performance.setResourceTimingBufferSize(500)` during init script execution; flag `resourceBufferLimitReached: true` if exceeded. |
| **Cross-origin resource size misinterpretation** | Cross-reference Resource Timing entries with Playwright network response headers; classify `transferSize === 0` as `tao_restricted` rather than zero-byte. |
| **Overly aggressive lazy loading recommendation** | Restrict `loading="lazy"` recommendations strictly to below-the-fold images (`top >= window.innerHeight`); flag above-the-fold/LCP lazy loading as an anti-pattern. |
| **High TTFB misattributed to server backend** | Document that TTFB reflects combined network round-trip and server queue latency; only claim pure server processing when `Server-Timing` header is present. |
| **Slow scripts delaying scan finalization** | Enforce bounded 5,000ms settling budget after page load; cleanly abort performance collection on scan cancellation or timeout. |
| **Duplicate PerformanceObservers impacting page performance** | Unify `layout-shift`, `largest-contentful-paint`, and `longtask` into a single coordinated init script (`window.__auditorPerformance`). |

---

## 6. Formal Approval & Next Steps

This document represents the complete, binding technical specification for Phase 7 — Batch 7.3. 

Upon your approval to commence implementation, execution will begin immediately with **Batch 7.3.1: Core Web Vitals Lab Engine**.
