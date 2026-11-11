# Ultimate WordPress & Website Auditor — Release Notes (v0.1.0)

**Release Version:** `0.1.0`  
**Release Date:** November 9, 2026  
**Target Platform:** Windows 10 / Windows 11 (x64)  
**Package Type:** Standalone NSIS Installer (`Ultimate WordPress & Website Auditor Setup 0.1.0.exe`)  
**Architecture:** Electron 44.10.2 / Chromium 152.0.7977.169 / Node.js 24.22.2 / Native SQLite ABI 149  

---

## 1. Overview

**Ultimate WordPress & Website Auditor** is an enterprise-grade, local-first Windows desktop application designed for technical, performance, and security auditing of WordPress, Elementor, WooCommerce, and modern web applications. 

Engineered with a **security-first, read-only** approach, all audits run strictly from the user's desktop computer without routing website traffic or proprietary audit data through external cloud servers.

---

## 2. Key Capabilities & Features

### 2.1 Project & Target Site Management
- **Local SQLite Persistence:** Complete offline persistence of projects, sites, scan runs, findings, and reports using SQLite WAL mode.
- **RFC 3986 URL Normalization:** Strict validation of audit targets, stripping embedded credentials and normalizing trailing slashes, hostnames, and ports.
- **Environment & Platform Tagging:** Classification of target environments (production, staging, development, local) and platforms (WordPress, WooCommerce, generic web).

### 2.2 Safe External Scanner Engine
- **SSRF & DNS Rebinding Protection:** Resolves hostnames to IP addresses before socket creation and validates every address against the authoritative IANA IPv4 and IPv6 Special-Purpose Address Registries. Rejects loopback (`127.0.0.0/8`), RFC 1918 private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local (`169.254.0.0/16`), Carrier-Grade NAT (`100.64.0.0/10`), and multicast addresses.
- **Socket-Level IP Pinning:** Directly connects TCP sockets to the exact validated IP address to eliminate Time-Of-Check to Time-Of-Use (TOCTOU) DNS rebinding vulnerabilities.
- **Bounded Web Crawler:** Crawls websites within strict user-configured boundaries (max pages, max depth, concurrency limits, payload size caps, request timeouts).
- **Strict Scope Guard:** Restricts crawling to the authorized domain origin, preventing traversal to external domains or unauthorized subdomains.

### 2.3 Comprehensive Audit Analyzers
- **Technology & CMS Identification:** Detects WordPress core, version footprints, themes, active plugins, Elementor/WooCommerce indicators, and web server software.
- **Security Headers Analyzer:** Evaluates Content-Security-Policy (CSP), Strict-Transport-Security (HSTS), X-Content-Type-Options, Referrer-Policy, Permissions-Policy, and X-Frame-Options (anti-clickjacking).
- **Technical & Social SEO Auditor:** Inspects document title tags, meta descriptions, canonical URLs, robots directives, OpenGraph tags, and Twitter Card metadata.
- **Broken Link & Dead Resource Checker:** Detects dead hyperlinks, missing stylesheets, broken scripts, and broken images.
- **Content Quality & Hygiene:** Flags insecure form submissions (HTTP action on HTTPS pages), missing form labels, and malformed markup structures.

### 2.4 Hardened Browser Auditing (Headless Chromium)
- **Runtime Error & Crash Interception:** Intercepts unhandled JavaScript runtime exceptions, failed promises, and browser console warnings in an isolated headless Chromium process.
- **Network Resource Failure Tracker:** Detects failed subresource requests, 4xx/5xx HTTP errors, and dropped network connections.
- **Multi-Viewport Emulation:** Tests responsive behavior across standard desktop, tablet, and mobile device viewports with accurate screen dimensions, device scale factors, and touch emulation.
- **Layout Stability & CLS Measurement:** Measures Cumulative Layout Shift (CLS) via PerformanceObserver with session-window aggregation, identifying shifting DOM elements.
- **Evidence Screenshots:** Captures viewport and full-page screenshots with bounded file sizes, dimension validation, and automatic sensitive text redaction.
- **Automated Accessibility Engine (axe-core):** Evaluates WCAG 2.1 Level AA accessibility rules (color contrast, missing alt attributes, ARIA attributes, button labels, form controls).

### 2.5 Standalone Reporting & Evidence Export
- **Self-Contained HTML Reports:** Generates responsive, standalone single-file HTML reports containing interactive finding filters, severity breakdowns, evidence code blocks, and embedded base64 screenshots. Requires zero external CDNs or network connections to view.
- **Structured JSON Reports:** Exports full audit findings and scan metadata in machine-readable JSON format for integration into external pipelines or compliance archives.
- **Report Reconciliation:** Automatically verifies that report metadata in SQLite corresponds to physical report files on disk, pruning orphan references safely.

### 2.6 Hardened Desktop Architecture
- **Process Isolation:** Clean separation between Electron Main process, typed Preload bridge, and React Renderer process.
- **Electron Security Settings:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, and strict production Meta Content-Security-Policy.
- **Navigation Guards:** Denies arbitrary external window creation (`window.open`) and blocks in-app document navigation away from the local application bundle.
- **Secret Redaction:** Startup error handler and audit logs redact Bearer tokens, passwords, database URIs, and secret query parameters before writing to disk.

---

## 3. System Requirements

| Requirement | Minimum | Recommended |
| :--- | :--- | :--- |
| **Operating System** | Windows 10 (64-bit) Build 19041+ | Windows 11 (64-bit) |
| **Processor** | Intel Core i3 / AMD Ryzen 3 (x64) | Intel Core i5 / AMD Ryzen 5 or higher |
| **Memory (RAM)** | 4 GB | 8 GB or higher (for concurrent browser auditing) |
| **Disk Space** | 500 MB free disk space | 2 GB free disk space (for local audit reports & screenshots) |
| **Display** | 1280 x 720 minimum resolution | 1920 x 1080 resolution |

---

## 4. Known Limitations & Scope Boundaries

1. **Passive / Read-Only Auditing:**  
   The application intentionally performs non-destructive, read-only analysis. It does **not** launch active exploitation attempts, SQL injection fuzzing, cross-site scripting payloads, or password brute-forcing against production web servers.
2. **Code Signing Status (Initial Release):**  
   Version 0.1.0 is distributed as an unsigned Windows executable. When launched on Windows 10/11, Windows Defender SmartScreen will present an "Unknown Publisher" prompt. Users can click *More info -> Run anyway* to proceed. Code signing will be integrated in future releases when an EV Authenticode certificate is provisioned.
3. **Single-User Local Storage:**  
   The SQLite database and audit reports are stored per-user in `%APPDATA%`. Cross-machine synchronization and multi-tenant database sharing are not included in this release.
4. **CSV Export Availability:**  
   RFC 4180 CSV export generation is implemented at the library level (`generateCsvReport`) and verified via automated tests. In version 0.1.0, the desktop user interface exposes HTML and JSON report creation workflows directly.
