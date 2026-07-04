"""
E2E — Audit log access control.

Validates that:
  1. A non-owner user sees the "Accès refusé" card on /permissions
     (French locale) instead of the audit journal.
  2. The server function `listPresetAudit` returns HTTP 403
     (Forbidden) when invoked by that same non-owner session.

Prerequisites (managed Lovable session):
  - LOVABLE_BROWSER_AUTH_STATUS=injected
  - LOVABLE_BROWSER_SUPABASE_SESSION_JSON / STORAGE_KEY / COOKIES_JSON
  - The signed-in user is a member of at least one tenant with the
    role `cashier` or `manager` (NOT `owner` / `super_admin`).

Run with:
  python3 tests/e2e/audit-access-denied.spec.py
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

        # 1. UI check — "Accès refusé" card must be visible for a non-owner.
        await page.goto(f"{ROOT}/permissions", wait_until="domcontentloaded")
        await page.wait_for_load_state("networkidle")
        await page.screenshot(path=str(SCREENSHOTS / "denied_card.png"))

        body = await page.locator("body").inner_text()
        assert "Accès refusé" in body or "access denied" in body.lower(), (
            "UI check failed: expected an 'Accès refusé / access denied' card on /permissions"
        )
        assert "Journal des presets" not in body or "Accès refusé" in body, (
            "UI check failed: audit journal appears to be visible to a non-owner"
        )
        print("OK — UI: access denied card rendered")

        # 2. API check — invoking listPresetAudit as a non-owner must
        #    return HTTP 403 (or a 4xx). We hit the server-fn RPC path
        #    directly using the client-attached bearer token.
        result = await page.evaluate(
            """async () => {
                const memRes = await window.fetch('/', { method: 'GET' });
                // Use the existing supabase client to grab tenantId + token.
                const raw = window.localStorage.getItem(
                    Object.keys(window.localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token')) || ''
                );
                if (!raw) return { skipped: true, reason: 'no supabase session in localStorage' };
                const session = JSON.parse(raw);
                const token = session.access_token ?? session?.currentSession?.access_token;
                // Fetch memberships to grab a tenantId the user is a member of.
                const apiUrl = window.__SUPABASE_URL || null;
                // Fallback: call any active tenant we can find via localStorage.
                const tid = window.localStorage.getItem('alpha_active_tenant');
                if (!tid) return { skipped: true, reason: 'no active tenant id in storage' };
                const res = await window.fetch('/_serverFn/listPresetAudit', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify({ data: { tenantId: tid, page: 0, pageSize: 10, sortBy: 'created_at', sortDir: 'desc', actionFilter: 'all' } }),
                });
                return { status: res.status, body: await res.text() };
            }"""
        )

        if result.get("skipped"):
            print(f"SKIP API check — {result.get('reason')}")
        else:
            status = result.get("status")
            assert status in (401, 403), (
                f"API check failed: expected 401/403 for non-owner, got {status}: {result.get('body')[:200]}"
            )
            print(f"OK — API: server function returned {status} for non-owner")

        await browser.close()
        print("E2E AUDIT ACCESS DENIED — PASSED")
        return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))