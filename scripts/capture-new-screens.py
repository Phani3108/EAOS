#!/usr/bin/env python3
"""Capture screenshots of the new EAOS screens for the README (headless Playwright).
Navigates by URL (the app syncs activeSection from the path). Gateway :3000 + web :3010 must be up."""
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3010"
SS = Path(__file__).resolve().parent.parent / "docs" / "screenshots"
SS.mkdir(parents=True, exist_ok=True)

# Dismiss onboarding/tour so screens are clean. add_init_script runs STATEMENTS
# (not a function), and storage values are JSON-encoded.
INIT = (
    "localStorage.setItem('eos_onboarding_completed', 'true');"
    "localStorage.setItem('eos_tour_completed', 'true');"
    "localStorage.setItem('eos_first_run_celebrated', 'true');"
)
INIT_DARK = INIT + "localStorage.setItem('eos_theme', '\"dark\"');"

SHOTS = [
    ("home",            "01-home-command-center.png", INIT),       # refreshed storytelling home
    ("platform-mcp",    "31-mcp-servers.png",         INIT),
    ("platform-review", "32-regiment-review.png",     INIT),
    ("platform-skills", "33-skill-library.png",       INIT),
    ("platform-swarms", "34-swarms.png",              INIT),
    ("platform-agents", "05-agents-panel.png",        INIT),       # refresh
    ("home",            "35-home-dark-mode.png",      INIT_DARK),  # dark mode showcase
]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for section, name, init in SHOTS:
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
        ctx.add_init_script(init)
        page = ctx.new_page()
        try:
            page.goto(f"{BASE}/{section}", wait_until="networkidle", timeout=30000)
        except Exception:
            page.goto(f"{BASE}/{section}", timeout=30000)
        time.sleep(2.2)  # let framer-motion settle + data load
        page.screenshot(path=str(SS / name))
        print(f"  captured {name}  <- /{section}")
        ctx.close()
    browser.close()
print("done")
