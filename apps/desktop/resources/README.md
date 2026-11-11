# Application Branding & Visual Assets

This directory houses the official visual identity assets for the **Ultimate WordPress & Website Auditor** desktop application and Windows installer.

## Asset Inventory

| File | Type | Resolution / Spec | Usage |
| :--- | :--- | :--- | :--- |
| `icon.svg` | Vector | 512x512 SVG source | Scalable brand source, documentation, web |
| `icon.ico` | Windows Icon | Multi-resolution (16, 24, 32, 48, 64, 128, 256) | Windows Application Icon, Taskbar, Executable, NSIS Installer |
| `icon.png` | Raster PNG | 512x512 RGBA | High-res desktop app icon default |
| `icon-512.png` | Raster PNG | 512x512 RGBA | High-DPI screens, app stores, about screens |
| `icon-256.png` | Raster PNG | 256x256 RGBA | Windows Explorer Large / Extra Large icons |
| `icon-128.png` | Raster PNG | 128x128 RGBA | Medium icon display |
| `icon-64.png` | Raster PNG | 64x64 RGBA | Taskbar display on high-DPI scaling |
| `icon-48.png` | Raster PNG | 48x48 RGBA | Standard Windows desktop shortcuts |
| `icon-32.png` | Raster PNG | 32x32 RGBA | Standard Windows taskbar / Start menu |
| `icon-24.png` | Raster PNG | 24x24 RGBA | Notification area, small dialogs |
| `icon-16.png` | Raster PNG | 16x16 RGBA | Window titlebar, system tray, Explorer details |

## Visual Design Specification
- **Theme:** High-end security, technical audit, and precision analysis.
- **Palette:**
  - Deep Navy / Slate background: `#0f172a` to `#1e293b`
  - Vibrant Cyan auditor shield: `#06b6d4` / `#0ea5e9`
  - Crisp Emerald checkmark accent: `#10b981` / `#22c55e`
  - High-contrast pure white verification checkmark: `#ffffff`

## Build Reproducibility
All assets are generated deterministically via:
```powershell
python scripts/generate-branding-assets.py
```
