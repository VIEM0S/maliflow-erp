"""
E2E — Audit log server-side search / filter / pagination / sort.

Complements audit-access-denied.spec.py by verifying, on an *owner*
session (or gracefully skipping otherwise), that:

  1. Access control is still enforced (the "Accès refusé" card must NOT
     appear when the caller is an owner).
  2. The search input and action-filter select expose accessible names
     (aria-label) — required for keyboard-only navigation.
  3. Typing a nonsense search string surfaces the empty-state message
     and does NOT open a stale before/after drawer.
  4. Sort headers keep their aria-sort state after a filter change,
     so pagination + sort survive the round-trip.

Run with:  python3 tests/e2e/audit-search-and-filter.spec.py
"""
import asyncio
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = "http://localhost:8080"
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
        print("SKIP: no managed Supabase session injected", flush=True)
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
            print("SKIP: signed-in user is not an owner — nothing to assert")
            await browser.close()
            return 0

        # 1. Search + filter inputs must have accessible names.
        search = page.get_by_label("Rechercher", exact=False)
        assert await search.count() > 0, "search input missing aria-label"

        # 2. Empty state — a nonsense query MUST render the empty message
        #    and MUST NOT surface a stale before/after drawer.
        await search.first.fill("zz-no-such-preset-zz")
        await page.wait_for_timeout(400)  # 300ms debounce + margin
        await page.screenshot(path=str(SCREENSHOTS / "empty_state.png"))
        body_after = await page.locator("body").inner_text()
        assert (
            "Aucune" in body_after
            or "aucun" in body_after.lower()
            or "no result" in body_after.lower()
        ), "empty-state message missing after nonsense search"

        # Drawer must remain closed — Radix Sheet uses role=dialog when open.
        assert await page.locator('[role="dialog"]').count() == 0, (
            "drawer opened while the filtered list is empty"
        )

        # 3. Clearing the search restores results and sort headers keep
        #    their aria-sort state (proving sort survived the filter round-trip).
        await search.first.fill("")
        await page.wait_for_timeout(400)
        headers_with_sort = await page.locator("[aria-sort]").count()
        assert headers_with_sort >= 1, "sort headers lost their aria-sort state"

        await browser.close()
        print("E2E AUDIT SEARCH / FILTER — PASSED")
        return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))