#!/usr/bin/env python3
"""
Branding Asset Generator for Ultimate WordPress & Website Auditor.
Generates pixel-perfect icons in SVG, multi-resolution PNGs, and a standard Windows ICO.
"""

import os
import math
from PIL import Image, ImageDraw, ImageFilter

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
RESOURCES_DIR = os.path.join(PROJECT_ROOT, "apps", "desktop", "resources")

os.makedirs(RESOURCES_DIR, exist_ok=True)

def create_svg():
    svg_content = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="50%" stop-color="#1e293b" />
      <stop offset="100%" stop-color="#090d16" />
    </linearGradient>
    <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="100%" stop-color="#0284c7" />
    </linearGradient>
    <linearGradient id="shieldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#06b6d4" />
      <stop offset="50%" stop-color="#0ea5e9" />
      <stop offset="100%" stop-color="#10b981" />
    </linearGradient>
    <linearGradient id="checkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="100%" stop-color="#f0fdf4" />
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="12" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>

  <!-- Background Squircle -->
  <rect x="24" y="24" width="464" height="464" rx="108" fill="url(#bgGrad)" stroke="#334155" stroke-width="4" />

  <!-- Subtle Outer Accent Ring -->
  <circle cx="256" cy="256" r="190" fill="none" stroke="url(#ringGrad)" stroke-width="3" stroke-dasharray="16 12" opacity="0.4" />

  <!-- Auditor Shield -->
  <path d="M 256 96 
           C 340 96, 384 132, 384 216 
           C 384 324, 308 392, 256 424 
           C 204 392, 128 324, 128 216 
           C 128 132, 172 96, 256 96 Z" 
        fill="none" 
        stroke="url(#shieldGrad)" 
        stroke-width="18" 
        stroke-linejoin="round"
        filter="url(#glow)" />

  <!-- Core Lens / Radar Rings -->
  <circle cx="256" cy="240" r="92" fill="#0f172a" stroke="#0ea5e9" stroke-width="8" opacity="0.9" />
  <circle cx="256" cy="240" r="70" fill="none" stroke="#38bdf8" stroke-width="3" opacity="0.5" stroke-dasharray="8 6" />

  <!-- Crosshairs / Compass Guides -->
  <line x1="256" y1="156" x2="256" y2="180" stroke="#38bdf8" stroke-width="4" stroke-linecap="round" />
  <line x1="256" y1="300" x2="256" y2="324" stroke="#38bdf8" stroke-width="4" stroke-linecap="round" />
  <line x1="172" y1="240" x2="196" y2="240" stroke="#38bdf8" stroke-width="4" stroke-linecap="round" />
  <line x1="316" y1="240" x2="340" y2="240" stroke="#38bdf8" stroke-width="4" stroke-linecap="round" />

  <!-- Verification Checkmark -->
  <path d="M 216 240 L 244 268 L 304 204" 
        fill="none" 
        stroke="url(#checkGrad)" 
        stroke-width="22" 
        stroke-linecap="round" 
        stroke-linejoin="round" />
</svg>
'''
    svg_path = os.path.join(RESOURCES_DIR, "icon.svg")
    with open(svg_path, "w", encoding="utf-8") as f:
        f.write(svg_content)
    print(f"[branding] Generated SVG: {svg_path}")

def render_master_image(size=512):
    # Render with 2x supersampling for ultra-crisp antialiasing
    scale = 2
    canvas_size = size * scale
    img = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    margin = int(28 * scale)
    radius = int(108 * scale)
    rect_box = [margin, margin, canvas_size - margin, canvas_size - margin]

    # Background squircle with dark gradient approximation
    draw.rounded_rectangle(rect_box, radius=radius, fill=(15, 23, 42, 255), outline=(51, 65, 85, 255), width=int(5 * scale))

    center_x = canvas_size // 2
    center_y = int(244 * scale)

    # Subtle radar outer circle
    radar_r = int(185 * scale)
    draw.ellipse([center_x - radar_r, center_y - radar_r, center_x + radar_r, center_y + radar_r],
                 outline=(14, 165, 233, 90), width=int(3 * scale))

    # Outer Shield Points
    shield_pts = []
    # Parametric shield curve
    top_y = int(96 * scale)
    shoulder_y = int(140 * scale)
    max_w = int(136 * scale)
    bot_y = int(418 * scale)
    
    # Generate smooth shield polygon points
    # Top edge
    for t in range(-50, 51):
        x = center_x + int(t * max_w / 50)
        # Subtle dip in top center
        y = top_y + int(abs(t) * 14 * scale / 50)
        shield_pts.append((x, y))
    
    # Right curve down
    for t in range(0, 51):
        progress = t / 50.0
        # Curve from shoulder to bottom tip
        x = center_x + int(max_w * (1.0 - (progress ** 1.8)))
        y = shoulder_y + int((bot_y - shoulder_y) * (progress ** 0.85))
        shield_pts.append((x, y))
        
    # Left curve up
    for t in range(50, -1, -1):
        progress = t / 50.0
        x = center_x - int(max_w * (1.0 - (progress ** 1.8)))
        y = shoulder_y + int((bot_y - shoulder_y) * (progress ** 0.85))
        shield_pts.append((x, y))

    # Draw shield outline
    draw.polygon(shield_pts, outline=(6, 182, 212, 255), width=int(16 * scale))

    # Inner lens circle
    lens_r = int(94 * scale)
    draw.ellipse([center_x - lens_r, center_y - lens_r, center_x + lens_r, center_y + lens_r],
                 fill=(15, 23, 42, 240), outline=(14, 165, 233, 255), width=int(10 * scale))

    # Secondary dashed/inner ring
    inner_r = int(72 * scale)
    draw.ellipse([center_x - inner_r, center_y - inner_r, center_x + inner_r, center_y + inner_r],
                 outline=(56, 189, 248, 140), width=int(4 * scale))

    # Ticks / compass crosshairs
    tick_len = int(22 * scale)
    tick_w = int(5 * scale)
    draw.line([center_x, center_y - lens_r - int(2 * scale), center_x, center_y - lens_r + tick_len], fill=(56, 189, 248, 255), width=tick_w)
    draw.line([center_x, center_y + lens_r - tick_len, center_x, center_y + lens_r + int(2 * scale)], fill=(56, 189, 248, 255), width=tick_w)
    draw.line([center_x - lens_r - int(2 * scale), center_y, center_x - lens_r + tick_len, center_y], fill=(56, 189, 248, 255), width=tick_w)
    draw.line([center_x + lens_r - tick_len, center_y, center_x + lens_r + int(2 * scale), center_y], fill=(56, 189, 248, 255), width=tick_w)

    # Crisp emerald checkmark
    # Check points: left, vertex, right
    p1 = (center_x - int(44 * scale), center_y + int(2 * scale))
    p2 = (center_x - int(12 * scale), center_y + int(34 * scale))
    p3 = (center_x + int(54 * scale), center_y - int(38 * scale))

    check_w = int(22 * scale)
    draw.line([p1, p2], fill=(255, 255, 255, 255), width=check_w)
    draw.line([p2, p3], fill=(255, 255, 255, 255), width=check_w)
    
    # Cap vertices with smooth circles
    r_cap = check_w // 2
    draw.ellipse([p1[0] - r_cap, p1[1] - r_cap, p1[0] + r_cap, p1[1] + r_cap], fill=(255, 255, 255, 255))
    draw.ellipse([p2[0] - r_cap, p2[1] - r_cap, p2[0] + r_cap, p2[1] + r_cap], fill=(255, 255, 255, 255))
    draw.ellipse([p3[0] - r_cap, p3[1] - r_cap, p3[0] + r_cap, p3[1] + r_cap], fill=(255, 255, 255, 255))

    # Downsample using high quality Lanczos filter
    final_img = img.resize((size, size), Image.Resampling.LANCZOS)
    return final_img

def generate_all_assets():
    create_svg()
    master = render_master_image(512)

    sizes = [512, 256, 128, 64, 48, 32, 24, 16]
    images = {}

    for s in sizes:
        if s == 512:
            resized = master
        else:
            resized = master.resize((s, s), Image.Resampling.LANCZOS)
        images[s] = resized
        out_png = os.path.join(RESOURCES_DIR, f"icon-{s}.png")
        resized.save(out_png, format="PNG")
        print(f"[branding] Generated PNG {s}x{s}: {out_png}")

    # Standard icon.png (alias for 512x512)
    default_png = os.path.join(RESOURCES_DIR, "icon.png")
    master.save(default_png, format="PNG")
    print(f"[branding] Generated master PNG: {default_png}")

    # Multi-resolution ICO for Windows
    ico_path = os.path.join(RESOURCES_DIR, "icon.ico")
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    master.save(ico_path, format="ICO", sizes=ico_sizes)
    print(f"[branding] Generated Windows multi-res ICO: {ico_path} (size: {os.path.getsize(ico_path)} bytes)")

    # Generate README in resources/
    readme_path = os.path.join(RESOURCES_DIR, "README.md")
    readme_content = """# Application Branding & Visual Assets

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
"""
    with open(readme_path, "w", encoding="utf-8") as f:
        f.write(readme_content)
    print(f"[branding] Generated documentation: {readme_path}")

if __name__ == "__main__":
    generate_all_assets()
