import asyncio
import pathlib
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).parent
URL = "http://127.0.0.1:8791/index.html"


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 900})

        # Full page, default (Quick check, pre-run)
        await page.goto(URL)
        await page.wait_for_load_state("networkidle")
        await page.screenshot(path=str(ROOT / "shot-full-quick-idle.png"), full_page=True)

        # Run the check: measuring + verdict reveal. Wait for the reveal to settle.
        await page.click("#check-dns")
        await page.wait_for_selector(".verdict.run-complete", timeout=10000)
        await page.wait_for_timeout(1600)  # let stagger + pulse finish
        await page.screenshot(path=str(ROOT / "shot-full-verdict.png"), full_page=True)

        # Verdict card detail (clip to the verdict article)
        box = await page.locator("#verdict").bounding_box()
        await page.screenshot(
            path=str(ROOT / "shot-verdict-detail.png"),
            clip={"x": box["x"], "y": box["y"], "width": box["width"], "height": box["height"]},
        )

        # Lab mode: full page with sub-nav, table, empty state
        await page.click('[data-mode="lab"]')
        await page.wait_for_timeout(300)
        await page.screenshot(path=str(ROOT / "shot-full-lab.png"), full_page=True)

        # Reduced-motion state: emulate, reload, run check -> instant/static verdict
        await page.emulate_media(reduced_motion="reduce")
        await page.reload()
        await page.wait_for_load_state("networkidle")
        await page.click("#check-dns")
        await page.wait_for_selector(".verdict.run-complete", timeout=10000)
        await page.wait_for_timeout(400)
        await page.screenshot(path=str(ROOT / "shot-reduced-motion.png"), full_page=True)

        await browser.close()


asyncio.run(main())
print("screenshots done")
