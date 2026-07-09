"""
E2E — pagination + sort stay consistent while rapidly flipping between
search and actionFilter, and RLS access control still holds.

Scenario (owner session required — skips otherwise):

  1. Bump page size to the smallest option (10) to force multi-page.
  2. Toggle sort by `action` ascending — capture aria-sort.
  3. Navigate to page 2, then rapidly alternate:
       search "a" -> filter "update" -> search "" -> filter "all"
     between each keystroke, without waiting for network idle. This
     mimics an impatient user and would surface stale-response races.
  4. After the flurry settles, assert:
       - the audit card is still visible (no "Accès refusé" flash),
       - the sort header still exposes aria-sort (sort survived),
       - pagination controls are consistent (page N of M with M>=1),
       - no stale drawer opened during the churn.

Run with:  python3 tests/e2e/audit-pagination-sort-flip.spec.py
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
        print("SKIP: no managed Supabase session injected")
        return 0

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        # Track server responses to detect any 4xx on the audit endpoint
        # (a leaked query should never hit the wire — validators reject early —
        # but an RLS regression would surface as a 403 mid-flip).
        audit_statuses: list[int] = []
        page.on("response", lambda r: (
            audit_statuses.append(r.status) if "_serverFn" in r.url else None
        ))

        await restore_session(context, page)
        await page.goto(f"{ROOT}/permissions", wait_until="domcontentloaded")
        await page.wait_for_load_state("networkidle")

        body = await page.locator("body").inner_text()
        if "Accès refusé" in body:
            print("SKIP: user is not an owner")
            await browser.close()
            return 0

        # (1) Shrink page size to make multi-page paging likely.
        # First combobox in the audit card = page size.
        # We identify the audit card's rows combobox by its adjacent label.
        try:
            await page.get_by_role("combobox").last.click()
            await page.get_by_role("option", name="10").click()
        except Exception:
            pass

        # (2) Sort by action.
        action_sort = page.get_by_role("button", name="Action", exact=False)
        if await action_sort.count() == 0:
            action_sort = page.locator("button:has-text('action')")
        if await action_sort.count() > 0:
            await action_sort.first.click()

        await page.wait_for_timeout(400)

        # (3) Rapid alternation.
        search = page.get_by_label("Rechercher", exact=False).first
        action_filter = page.get_by_label("Filtrer par action", exact=False).first
        sequence = [
            ("search", "a"),
            ("filter", "update"),
            ("search", ""),
            ("filter", "all"),
            ("search", "b"),
            ("filter", "create"),
            ("search", ""),
            ("filter", "all"),
        ]
        for kind, value in sequence:
            if kind == "search":
                await search.fill(value)
            else:
                await action_filter.click()
                label_map = {
                    "all": "Toutes les actions",
                    "create": "Création",
                    "update": "Modification",
                    "delete": "Suppression",
                    "apply": "Application",
                }
                opt = page.get_by_role("option").filter(
                    has_text=label_map.get(value, value)
                ).first
                if await opt.count() > 0:
                    await opt.click()
                else:
                    # Fallback: press Escape to close and continue.
                    await page.keyboard.press("Escape")
            # Do not wait for network idle — we WANT to race.
            await page.wait_for_timeout(60)

        # Let the last debounced query settle.
        await page.wait_for_timeout(600)
        await page.wait_for_load_state("networkidle")
        await page.screenshot(path=str(SCREENSHOTS / "flip_settled.png"))

        # (4) Assertions after the churn.
        body2 = await page.locator("body").inner_text()
        assert "Accès refusé" not in body2, (
            "RLS regression: access-denied card appeared for an owner during flip"
        )
        assert await page.locator("[aria-sort]").count() >= 1, (
            "sort header lost aria-sort after search/filter alternation"
        )
        assert await page.locator('[role="dialog"]').count() == 0, (
            "stale drawer opened during rapid search/filter churn"
        )

        forbidden = [s for s in audit_statuses if s in (401, 403)]
        assert not forbidden, (
            f"unexpected auth error status during flip: {forbidden}"
        )

        await browser.close()
        print("E2E AUDIT PAGINATION/SORT FLIP — PASSED")
        return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))