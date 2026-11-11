# Installation & Uninstallation Guide

**Product:** Ultimate WordPress & Website Auditor  
**Version:** `0.1.0`  
**Platform:** Windows 10 / Windows 11 (64-bit)  

---

## 1. Installation Instructions

### 1.1 Standard Interactive Installation
1. Locate the downloaded installer file:  
   `Ultimate WordPress & Website Auditor Setup 0.1.0.exe`
2. Double-click the installer to launch setup.
3. If prompted by Windows Defender SmartScreen ("Windows protected your PC"):
   - Click **More info**.
   - Click **Run anyway**.  
   *(Note: This occurs because initial release v0.1.0 is unsigned. The executable is built directly from verified source).*
4. Select your preferred installation destination folder (or keep the default per-user folder: `%LOCALAPPDATA%\Programs\Ultimate WordPress & Website Auditor`).
5. Choose whether to create a Desktop shortcut.
6. Click **Install**. The setup wizard will unpack the application files and configure your Start Menu shortcuts.
7. Click **Finish** to launch the application.

### 1.2 Silent / Unattended Installation (Command Line)
For automated deployments or lab environments, the NSIS installer supports silent execution:

```powershell
# Silent installation to default per-user directory:
& ".\Ultimate WordPress & Website Auditor Setup 0.1.0.exe" /S

# Silent installation to a custom target directory:
& ".\Ultimate WordPress & Website Auditor Setup 0.1.0.exe" /S /D=C:\CustomPath\UltimateAuditor
```
> [!IMPORTANT]
> When using `/D=`, it must be the last parameter on the command line and must NOT contain surrounding quotation marks, even if the destination path includes spaces.

---

## 2. File & Directory Layout

The application maintains strict separation between program files and user data:

| Component | Standard Path | Description |
| :--- | :--- | :--- |
| **Installed Program Files** | `%LOCALAPPDATA%\Programs\Ultimate WordPress & Website Auditor\` | Core binaries, Electron runtime, and precompiled native SQLite addons. |
| **Application Executable** | `%LOCALAPPDATA%\Programs\Ultimate WordPress & Website Auditor\Ultimate WordPress & Website Auditor.exe` | Main Windows entry point. |
| **Uninstaller** | `%LOCALAPPDATA%\Programs\Ultimate WordPress & Website Auditor\Uninstall Ultimate WordPress & Website Auditor.exe` | NSIS uninstallation binary. |
| **User Data Root** | `%APPDATA%\ultimate-wordpress-and-website-auditor\` | Persistent user workspace directory. |
| **SQLite Database** | `%APPDATA%\ultimate-wordpress-and-website-auditor\database\auditor.db` | Local database storing projects, sites, scan runs, findings, and report metadata. |
| **Database Backups** | `%APPDATA%\ultimate-wordpress-and-website-auditor\database\backups\` | Hot SQLite database backups and migration journals. |
| **Generated Reports** | `%APPDATA%\ultimate-wordpress-and-website-auditor\reports\` | Standalone HTML and JSON audit reports. |
| **Audit Screenshots** | `%APPDATA%\ultimate-wordpress-and-website-auditor\reports\screenshots\` | Evidence screenshots captured during browser audits. |
| **Application Logs** | `%APPDATA%\ultimate-wordpress-and-website-auditor\logs\` | Redacted runtime diagnostic logs and startup error journals. |

---

## 3. Uninstallation Instructions

### 3.1 Standard Uninstallation
1. Open Windows **Settings** (`Win + I`) -> **Apps** -> **Installed apps** (or **Apps & features**).
2. Search for **Ultimate WordPress & Website Auditor**.
3. Click the three dots menu and select **Uninstall**.
4. Confirm uninstallation. The uninstaller will remove all application binaries, shortcuts, and registry entries.

### 3.2 Silent Uninstallation
To perform a silent uninstallation via PowerShell or Command Prompt:

```powershell
$uninst = "$env:LOCALAPPDATA\Programs\Ultimate WordPress & Website Auditor\Uninstall Ultimate WordPress & Website Auditor.exe"
Start-Process -FilePath $uninst -ArgumentList "/S" -Wait
```

---

## 4. User Data Preservation Policy

> [!TIP]
> **Zero Data Loss Guarantee on Uninstall:**  
> The NSIS uninstaller is configured with `deleteAppDataOnUninstall: false`. 
> 
> Uninstalling the application **never** deletes your SQLite database, audit history, exported reports, evidence screenshots, or database backups stored in `%APPDATA%\ultimate-wordpress-and-website-auditor`.
>
> If you reinstall the application in the future or upgrade to a new version, all your previous projects, target sites, audit runs, and findings will be automatically detected and loaded with 100% integrity.

### 4.1 Manual Backup Recommendations
To create a manual backup of your audit workspace (before transferring to another computer or performing major system maintenance):
1. Close Ultimate WordPress & Website Auditor.
2. Press `Win + R`, type `%APPDATA%`, and press Enter.
3. Copy the entire folder `ultimate-wordpress-and-website-auditor` to a secure external backup location.
4. To restore, paste the folder back into `%APPDATA%` on the target machine before launching the application.
