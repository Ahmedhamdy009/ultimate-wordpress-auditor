## Ultimate WordPress & Website Auditor — Release v0.1.6 (Developer Preview)

This release delivers the **Phase 6 / Batch 6.1 Production Audit Accuracy Remediation**, introducing truthful coverage accounting, intelligent finding deduplication, taxonomy archive heuristics, and hardened SQLite engine lifecycle management.

---

### What's New in v0.1.6

#### 1. Truthful Coverage Accounting (P0)
- **Eliminated Misleading Full Coverage:** Fixed the UI and reporting behavior where scans were marked as "FULL COVERAGE" even when browser-rendered audits failed or covered only a subset of crawled pages.
- **Explicit Coverage Separation:** The application now explicitly reports both **Static Coverage** (e.g., 54 pages crawled & analyzed) and **Dynamic Browser Coverage** (e.g., 15 pages rendered in headless Playwright Chromium) across the scan UI, summary dashboards, JSON payloads, and HTML exports.
- **Accurate Browser Candidate Tracking:** Distinguishes successfully audited pages from skipped candidates and unreachable endpoints.

#### 2. Intelligent Template & Finding Deduplication (P0)
- **Consolidated Multi-Page Findings:** Automatically groups repetitive template findings (such as identical contrast or missing heading issues across 50+ pages) by normalized CSS selector and rule key.
- **Zero Evidence Loss:** Consolidation preserves full lists of affected URLs, individual occurrence counts, and atomic raw evidence for every single violation.
- **Unified Reporting:** Exported HTML and JSON reports provide both consolidated summary views for fast triage and granular raw records for technical remediation.

#### 3. WordPress Taxonomy & Archive Heuristics (P1)
- **Archive Classification:** Intelligently classifies WordPress category, tag, author, and date archives to prevent false positive "thin content" or excessive depth warnings.
- **Content vs. Navigation Distinction:** Tailors structural heuristics based on page classification (single post, static page, taxonomy archive, paginated index).

#### 4. Engine Reliability & Connection Hardening
- **Lifecycle Guarantees:** Enforces deterministic SQLite connection states (`OPEN`, `CLOSED`, `CORRUPTED`) with WAL mode and safety pragmas.
- **Clean In-Flight Teardown:** Fixed hanging database transactions on cancelled or failed scans with timeout enforcement.
- **Dual-ABI Native sqlite Support:** Included precompiled native bindings for Node.js (ABI 137) and Electron (ABI 149) on Windows x64.

---

### Quality & Verification Metrics

- **Automated Tests:** 1,360 / 1,360 tests passing across 131 test files (100% pass rate).
- **Acceptance Verification:** 29 / 29 independent acceptance test scenarios confirmed.
- **Quality Gates:** 6 / 6 quality gates passing (package-exports, format, ESLint, TypeScript, Vitest, build).
- **Memory & Resource Discipline:** Bounded concurrency, strictly local processing, zero network transmission outside target audit domains.

---

### System Requirements & Installation

- **Operating System:** Windows 10 / Windows 11 (64-bit)
- **Architecture:** x64
- **Installation Method:**
  1. Download **`Ultimate WordPress & Website Auditor Setup 0.1.6.exe`** below.
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
| **File Name** | `Ultimate WordPress & Website Auditor Setup 0.1.6.exe` |
| **File Size** | `125,806,288 bytes` (~119.98 MB) |
| **SHA-256 Checksum** | `99dfb08b068d5638c9cbefc25d73332d4e2be271e2fb04ccea282f82a179cacd` |

Verify checksum locally in PowerShell:
```powershell
Get-FileHash -Path ".\Ultimate WordPress & Website Auditor Setup 0.1.6.exe" -Algorithm SHA256
```
