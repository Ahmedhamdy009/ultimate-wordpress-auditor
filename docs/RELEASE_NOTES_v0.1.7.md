## Ultimate WordPress & Website Auditor — Release v0.1.7 (Developer Preview)

This release delivers **Phase 7 — Batch 7.1 (UI/UX Modernization & Workflow Refinement)** and **Batch 7.1.1 (Security & Preview Hardening)**, providing an active Overview dashboard with aggregate audit metrics, a dedicated Reports & Exports workflow with CSV export capabilities, authoritative Content Security Policy isolation for in-app report previews, and an RFC 4180 compliant CSV parser.

---

### What's New in v0.1.7

#### 1. Interactive Overview Dashboard (Batch 7.1)
- **Real-Time Audit Metrics:** Aggregates overall health scores, completed scans, total detected issues, and critical vulnerability counts directly from local SQLite persistence.
- **Severity & Category Distribution:** Visual breakdown of findings across categories (Security, SEO, Accessibility, Layouts, Content Quality).
- **Recent Scan Activity:** Direct access to recent scans with immediate navigation to detailed findings and audit reports.
- **Target Site Directory:** Quick visibility of managed project sites and audit history.

#### 2. Dedicated Reports & Exports Workflow (Batch 7.1)
- **Centralized Reports View:** Inspect, filter, sort, and search across generated audit reports from historical scan runs.
- **Multi-Format Report Generation:** Generate self-contained interactive HTML reports, structured machine-readable JSON exports, and tabular CSV spreadsheets with a single click.
- **On-Demand Regeneration:** Re-generate missing reports directly from completed scan runs stored in the local SQLite database.
- **Native File System Integration:** Direct "Open File" and "Show in Folder" actions leveraging secure Electron shell abstractions.

#### 3. Security-Hardened Report Previews (Batch 7.1.1)
- **Authoritative Content Security Policy (CSP):** Injects a restrictive Content Security Policy (`default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'`) into all generated HTML reports.
- **Zero External Network Egress:** Guarantees that opening or previewing an untrusted HTML report triggers zero external HTTP/HTTPS requests for scripts, remote images, stylesheets, fonts, tracking pixels, or WebSockets.
- **Strict Iframe Sandbox Isolation:** Report previews render inside an `iframe` with empty `sandbox=""` token isolation, blocking top-level navigation breakouts, popups, and parent frame inspection.
- **Embedded Visual Evidence:** Safely renders base64 data URI element and viewport screenshots without relaxing security boundaries.

#### 4. RFC 4180 Compliant CSV Engine (Batch 7.1.1)
- **Deterministic State-Machine Parser:** Eliminates naïve line-based splitting by implementing an RFC 4180 compliant lexical tokenizer that accurately preserves embedded newlines, double quotes, and commas within fields.
- **Tabular In-App Previews:** Renders clean, paginated table previews for CSV exports with search, column filtering, and metadata inspection.

---

### Quality & Verification Metrics

- **Automated Tests:** 1,391 / 1,391 tests passing across 133 test files (100% pass rate).
- **Quality Gates:** 6 / 6 quality gates passing (package-exports, format, ESLint strict, TypeScript typecheck, production build, Vitest suite).
- **Packaged Runtime Verification:** 100% verified against installed production Windows x64 binary (`Ultimate WordPress & Website Auditor.exe`).
- **Privacy Guarantee:** 100% local processing; zero cloud telemetry; all audit data and screenshots remain on the local workstation.

---

### System Requirements & Installation

- **Operating System:** Windows 10 / Windows 11 (64-bit)
- **Architecture:** x64
- **Installation Method:**
  1. Download **`Ultimate WordPress & Website Auditor Setup 0.1.7.exe`** below.
  2. Launch the installer and follow the setup wizard.
  3. Start auditing WordPress and web sites locally.

> [!NOTE]
> **Windows SmartScreen Notice:**
> Because this is an open-source alpha developer preview without an enterprise EV Code Signing certificate, Windows Defender SmartScreen may display an *"Unknown Publisher / Windows protected your PC"* prompt.
> To proceed: Click **More info**, then click **Run anyway**.

---

### Package Verification & Checksum

| Attribute | Value |
| :--- | :--- |
| **File Name** | `Ultimate WordPress & Website Auditor Setup 0.1.7.exe` |
| **File Size** | `125,812,103 bytes` (~120 MB) |
| **SHA-256 Checksum** | `c82e7d94e764dd8cddb778c3459aa9a01675ecdaf74a69f69c6c1ef24f3cf9cf` |

Verify checksum locally in PowerShell:
```powershell
Get-FileHash -Path ".\Ultimate WordPress & Website Auditor Setup 0.1.7.exe" -Algorithm SHA256
```
