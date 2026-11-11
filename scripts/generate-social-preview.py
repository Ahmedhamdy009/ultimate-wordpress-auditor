#!/usr/bin/env python3
"""
Generate high-resolution 1280x640 OpenGraph Social Preview banner for GitHub.
"""

import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
ASSETS_DIR = os.path.join(PROJECT_ROOT, "docs", "assets")
ICON_PATH = os.path.join(PROJECT_ROOT, "apps", "desktop", "resources", "icon-512.png")
OUTPUT_PATH = os.path.join(ASSETS_DIR, "social-preview.png")

os.makedirs(ASSETS_DIR, exist_ok=True)

WIDTH = 1280
HEIGHT = 640

# Create canvas
banner = Image.new("RGBA", (WIDTH, HEIGHT), (11, 15, 25, 255))
draw = ImageDraw.Draw(banner)

# Draw subtle background radial gradient / ambient glows
glow_img = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
glow_draw = ImageDraw.Draw(glow_img)

# Cyan/Blue glow on left near logo
glow_draw.ellipse([80, 100, 520, 540], fill=(14, 165, 233, 40))
# Emerald glow bottom-right
glow_draw.ellipse([800, 300, 1200, 700], fill=(16, 185, 129, 25))
glow_img = glow_img.filter(ImageFilter.GaussianBlur(80))
banner.paste(Image.alpha_composite(banner, glow_img))

# Subtle grid pattern
grid_color = (255, 255, 255, 8)
grid_overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
grid_draw = ImageDraw.Draw(grid_overlay)
grid_spacing = 40
for x in range(0, WIDTH, grid_spacing):
    grid_draw.line([(x, 0), (x, HEIGHT)], fill=grid_color, width=1)
for y in range(0, HEIGHT, grid_spacing):
    grid_draw.line([(0, y), (WIDTH, y)], fill=grid_color, width=1)
banner = Image.alpha_composite(banner, grid_overlay)
draw = ImageDraw.Draw(banner)

# Outer card border
draw.rounded_rectangle([20, 20, WIDTH - 20, HEIGHT - 20], radius=24, outline=(51, 65, 85, 120), width=2)

# Load and place Project Logo
if os.path.exists(ICON_PATH):
    logo = Image.open(ICON_PATH).convert("RGBA")
    logo = logo.resize((240, 240), Image.Resampling.LANCZOS)
    
    # Add a soft drop shadow behind the logo
    shadow = Image.new("RGBA", (260, 260), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.ellipse([10, 10, 250, 250], fill=(0, 0, 0, 160))
    shadow = shadow.filter(ImageFilter.GaussianBlur(15))
    banner.paste(shadow, (80, 190), shadow)
    banner.paste(logo, (90, 200), logo)

# Load Fonts
FONT_BOLD = "C:/Windows/Fonts/segoeuib.ttf"
FONT_REGULAR = "C:/Windows/Fonts/segoeui.ttf"
FONT_SEMI = "C:/Windows/Fonts/seguisb.ttf"

title_font = ImageFont.truetype(FONT_BOLD, 42)
subtitle_font = ImageFont.truetype(FONT_SEMI, 24)
badge_font = ImageFont.truetype(FONT_BOLD, 15)
tagline_font = ImageFont.truetype(FONT_REGULAR, 18)
footer_font = ImageFont.truetype(FONT_SEMI, 16)

# Main Title and Subtitle placement
text_x = 370
draw.text((text_x, 150), "Ultimate WordPress & Website Auditor", font=title_font, fill=(248, 250, 252, 255))
draw.text((text_x, 215), "Privacy-First Desktop Platform for Deep Technical & Security Auditing", font=subtitle_font, fill=(56, 189, 248, 255))

# Descriptive tagline
desc = "Engineered for comprehensive local auditing: technical SEO, security posture,\nWCAG 2.2 AA accessibility, responsive rendering, and intelligent finding deduplication."
draw.text((text_x, 265), desc, font=tagline_font, fill=(148, 163, 184, 255), spacing=8)

# Feature Badges
badges = [
    ("100% LOCAL-FIRST", (16, 185, 129)),       # Emerald
    ("ZERO TELEMETRY", (6, 182, 212)),         # Cyan
    ("WCAG 2.2 AA", (168, 85, 247)),           # Purple
    ("TECHNICAL SEO", (245, 158, 11)),         # Amber
    ("SECURITY POSTURE", (239, 68, 68)),       # Red
    ("DESKTOP RUNTIME", (59, 130, 246)),       # Blue
]

badge_x = text_x
badge_y = 370
for text, color in badges:
    bbox = draw.textbbox((0, 0), text, font=badge_font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    pad_h = 14
    pad_v = 6
    bg_w = tw + pad_h * 2
    bg_h = th + pad_v * 2
    
    if badge_x + bg_w > WIDTH - 60:
        badge_x = text_x
        badge_y += bg_h + 12

    # Draw pill background
    r, g, b = color
    draw.rounded_rectangle([badge_x, badge_y, badge_x + bg_w, badge_y + bg_h], radius=6, fill=(r, g, b, 35), outline=(r, g, b, 120), width=1)
    draw.text((badge_x + pad_h, badge_y + pad_v - 1), text, font=badge_font, fill=(r, g, b, 255))
    badge_x += bg_w + 12

# Bottom Tech Stack Divider Line
draw.line([(60, 530), (WIDTH - 60, 530)], fill=(51, 65, 85, 140), width=1)

# Footer Stack info
footer_text = "Built with Electron · React · Vite · TypeScript · SQLite · Playwright · axe-core"
draw.text((60, 560), footer_text, font=footer_font, fill=(100, 116, 139, 255))

version_text = "v0.1.6  |  Open Source  |  MIT License"
v_bbox = draw.textbbox((0, 0), version_text, font=footer_font)
v_w = v_bbox[2] - v_bbox[0]
draw.text((WIDTH - 60 - v_w, 560), version_text, font=footer_font, fill=(148, 163, 184, 255))

# Save image
banner.convert("RGB").save(OUTPUT_PATH, "PNG", optimize=True)
print(f"Generated Social Preview at: {OUTPUT_PATH}")
