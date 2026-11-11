# Security & Privacy Notes

**Product:** Ultimate WordPress & Website Auditor  
**Version:** `0.1.0`  
**Security Model:** Local-First, Zero-Cloud, Read-Only Auditing  

---

## 1. Security Architecture & Trust Boundaries

The application is architected around strict process isolation and defense-in-depth security principles:

```text
+-------------------------------------------------------------+
|                     TARGET WEBSITE (UNTRUSTED)              |
+-------------------------------------------------------------+
                               ^
                               | HTTP/HTTPS (IP-Pinned)
+-------------------------------------------------------------+
|                     ELECTRON MAIN PROCESS                   |
|  - Scope Guard & IANA SSRF Policy                           |
|  - Safe HTTP Client with Socket IP Pinning                  |
|  - ScanOrchestrator & Concurrency Limiter                   |
|  - Local SQLite Database (auditor.db)                       |
|  - Report Exporter & Sanitizer                              |
+-------------------------------------------------------------+
         |                                           ^
         | IPC (Strict Zod Validation)               | CDP
         v                                           v
+-----------------------------+   +---------------------------+
|    ELECTRON RENDERER (UI)   |   | HEADLESS CHROMIUM BROWSER |
|  - React & Vite UI          |   |  - Process Sandboxed      |
|  - contextIsolation = true  |   |  - WebRTC Disabled        |
|  - nodeIntegration = false  |   |  - Proxy-Routed Only      |
|  - Strict Meta CSP          |   |  - Popups Intercepted     |
+-----------------------------+   +---------------------------+
```

### 1.1 Process Sandboxing & Isolation
- **Node Integration Disabled:** Renderer processes run with `nodeIntegration: false` and `contextIsolation: true`. Renderer code cannot directly invoke Node.js filesystem, child process, or network APIs.
- **Typed Preload Bridge:** Communication between Renderer and Main process is exclusively handled through a frozen, typed `window.electronAPI` bridge implementing `safeInvoke`.
- **Bidirectional Validation:** Every IPC request and response payload is validated against strict Zod schemas. Unexpected or hostile properties are stripped automatically.
- **Fail-Closed Content-Security-Policy:** Enforced in both HTTP headers and HTML metadata (`default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'`).

---

## 2. Server-Side Request Forgery (SSRF) & Network Defense

### 2.1 Authoritative IANA Registry Classification
The application includes snapshots of the official IANA IPv4 and IPv6 Special-Purpose Address Registries. Before any HTTP request or browser connection is made:
1. Target hostnames are resolved via system DNS.
2. Every resolved IP address is validated against prohibited address ranges.
3. Requests to private networks (RFC 1918: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), loopback (`127.0.0.0/8`, `::1`), link-local (`169.254.0.0/16`, `fe80::/10`), CGNAT (`100.64.0.0/10`), documentation blocks, or multicast addresses fail closed with `ERR_SSRF_PROHIBITED_IP`.

### 2.2 TOCTOU DNS Rebinding Prevention & Socket IP Pinning
To defeat DNS rebinding attacks (where a malicious DNS server returns a public IP during resolution but a private IP when the connection opens), the application implements **Socket-Level IP Pinning**:
- TCP sockets connect directly to the exact pre-validated IP address.
- Host headers and TLS Server Name Indication (SNI) retain the original target domain name for virtual host routing and certificate verification.
- Internal test hooks (`pinnedIpOverride`, `lookupFn`) are strictly excluded from production IPC contracts, preload APIs, user configurations, and production orchestrator initialization.

---

## 3. Browser Hardening & Evidence Sanitization

### 3.1 Headless Chromium Protection
- **WebRTC Neutralization:** Direct UDP communication and local IP leakage via WebRTC are explicitly neutralized (`--disable-webrtc`, `--webrtc-ip-handling-policy=disable_non_proxied_udp`).
- **Site Isolation & Process Separation:** Chromium Site Isolation is actively preserved to isolate cross-origin frames into separate rendering processes.
- **Popup Interception:** `window.open` requests inside audited pages are intercepted and denied (`action: 'deny'`) to prevent unauthorized windows or tab hijacking.

### 3.2 Sensitive Evidence Redaction
- **Credential Stripping:** URLs containing embedded basic auth credentials (`http://user:pass@host/`) are rejected by URL normalization.
- **Form Value Redaction:** HTML parser extracts form metadata (names, types, actions) but never collects form input values, session cookies, or user tokens.
- **Diagnostic Logging Redaction:** The startup error handler and logger run all messages and stack traces through regex filters that redact Bearer tokens, API keys, passwords, database URIs, and sensitive query parameters before writing to disk or displaying dialogs.
- **Spreadsheet Formula Injection Defense:** CSV exports escape leading characters (`=`, `+`, `-`, `@`, Tab, CR) with single quotes to prevent formula execution when opened in Microsoft Excel.

---

## 4. Code Signing Status & Windows SmartScreen

### 4.1 Current Status: Unsigned Developer Release
Version `0.1.0` is an unsigned initial release (`no code signing certificate configured, signing is skipped`).

Because of this:
- **Windows Defender SmartScreen** will flag the installer as coming from an "Unknown Publisher".
- This is normal behavior on Windows for freshly built open-source desktop applications without established SmartScreen reputation or an EV Authenticode digital certificate.

### 4.2 Verifying Installer Integrity Manually
You can verify that the installer binary matches the official build by calculating its SHA-256 checksum in PowerShell:

```powershell
Get-FileHash -Algorithm SHA256 ".\Ultimate WordPress & Website Auditor Setup 0.1.0.exe"
```

Expected SHA-256 for release `0.1.0`:
`4A7508CA3A45E38D21D5D54D389BDC5D3B48FDD1BDA445AE19D35DF1EE7C48B7`

### 4.3 Future Signing Configuration
The project is architected for seamless transition to automated code signing via Azure Trusted Signing or Hardware Security Module (HSM). The CI/CD release workflow can be configured by providing:
- `CSC_LINK` / `WIN_CSC_LINK` (Path or base64 of Authenticode certificate)
- `CSC_KEY_PASSWORD` (Certificate password)
- RFC 3161 Timestamp Server: `http://timestamp.digicert.com`
