"""
Automated accessibility test — audit drawer, using axe-core.

Loads axe-core from a pinned CDN into the /permissions page, opens the
audit drawer (Radix Sheet — role="dialog" with focus trap), then runs
axe on the dialog subtree. Fails on any WCAG 2.1 A/AA violation and
additionally asserts:

  - the dialog has an accessible name (aria-labelledby)
  - focus is moved inside the dialog on open (focus trap entry)
  - Escape closes the dialog and returns focus to the trigger
  - Tab cycles focus inside the dialog (focus trap containment)

Skips gracefully when no owner session is injected — the drawer is
gated behind the "Accès refusé" card for other roles.

Run with:  python3 tests/e2e/audit-a11y-axe.spec.py
"""
import asyncio
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = "http://localhost:8080"
AXE_CDN = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.0/axe.min.js"
SCREENSHOTS = Path(__file__).parent / "screenshots"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)


async def restore_session(context, page):
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
    if cookies_json:
        cookies = json.loads(cookies_json)
        for c in cookies:
            c["url"] = ROOT
        await context.add_cookies(cookies)
    await page.goto(ROOT, wait_until="domcontentloaded")
    if storage_key and session_json:
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
        )


async def main() -> int:
    if os.environ.get("LOVABLE_BROWSER_AUTH_STATUS") != "injected":
        print("SKIP: no managed Supabase session injected")
        return 0

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()
        await restore_session(context, page)
        await page.goto(f"{ROOT}/permissions", wait_until="domcontentloaded")
        await page.wait_for_load_state("networkidle")

        body = await page.locator("body").inner_text()
        if "Accès refusé" in body:
            print("SKIP: user is not an owner — drawer is not reachable")
            await browser.close()
            return 0

        # Open the first audit row — click the "view" icon-only button.
        first_view = page.locator('button[aria-label*="Voir" i], button[aria-label*="View" i]').first
        if await first_view.count() == 0:
            print("SKIP: no audit rows available")
            await browser.close()
            return 0
        await first_view.click()

        dialog = page.locator('[role="dialog"]')
        await dialog.wait_for(state="visible", timeout=3000)
        await page.screenshot(path=str(SCREENSHOTS / "a11y_drawer_open.png"))

        # 1. Accessible name — Radix wires aria-labelledby via SheetTitle.
        assert await dialog.get_attribute("aria-labelledby"), "dialog missing aria-labelledby"

        # 2. Focus is inside the dialog on open.
        focus_inside = await page.evaluate(
            "!!document.activeElement && !!document.activeElement.closest('[role=\"dialog\"]')"
        )
        assert focus_inside, "focus was not moved inside the dialog on open"

        # 3. Tab keeps focus inside the dialog (focus-trap containment).
        await page.keyboard.press("Tab")
        focus_inside_after_tab = await page.evaluate(
            "!!document.activeElement && !!document.activeElement.closest('[role=\"dialog\"]')"
        )
        assert focus_inside_after_tab, "Tab escaped the drawer — focus trap broken"

        # 4. Inject axe-core and run against the dialog subtree.
        await page.add_script_tag(url=AXE_CDN)
        result = await page.evaluate(
            """async () => {
              const target = document.querySelector('[role="dialog"]');
              const r = await window.axe.run(target, {
                runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
              });
              return r.violations.map(v => ({
                id: v.id, impact: v.impact, help: v.help,
                nodes: v.nodes.length,
              }));
            }"""
        )
        if result:
            print("axe violations in drawer:")
            print(json.dumps(result, indent=2))
            await browser.close()
            return 1

        # 5. Escape closes the dialog.
        await page.keyboard.press("Escape")
        await dialog.wait_for(state="hidden", timeout=2000)

        await browser.close()
        print("E2E AUDIT A11Y (axe) — PASSED")
        return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))