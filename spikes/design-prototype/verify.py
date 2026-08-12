import asyncio
from playwright.async_api import async_playwright

URL = "http://127.0.0.1:8791/index.html"


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 900})

        await page.goto(URL)
        await page.wait_for_load_state("networkidle")

        checks = {}

        checks["font_bricolage"] = await page.evaluate(
            'document.fonts.check(\'700 34px "Bricolage Grotesque"\')'
        )
        checks["font_martian"] = await page.evaluate(
            'document.fonts.check(\'16px "Martian Mono"\')'
        )
        checks["chassis_bg"] = await page.evaluate(
            'getComputedStyle(document.querySelector(".chassis")).backgroundColor'
        )
        checks["chassis_bg_image_noise"] = await page.evaluate(
            'getComputedStyle(document.querySelector(".chassis")).backgroundImage.includes("svg")'
        )
        checks["verdict_hidden_before"] = await page.evaluate(
            'getComputedStyle(document.querySelector("#verdict")).display !== "none" && '
            'getComputedStyle(document.querySelector("#verdict .rv-1")).opacity === "0"'
        )

        await page.click("#check-dns")
        await page.wait_for_selector(".verdict.run-complete", timeout=10000)
        await page.wait_for_timeout(1600)

        checks["verdict_revealed"] = await page.evaluate(
            'getComputedStyle(document.querySelector("#verdict .rv-1")).opacity === "1" && '
            'getComputedStyle(document.querySelector("#verdict .rv-1")).transform !== "translateY(6px)"'
        )
        checks["pulse_settled"] = await page.evaluate(
            'getComputedStyle(document.querySelector(".pulse-key")).color'
        )
        checks["status_complete"] = await page.evaluate(
            'document.querySelector("#status-strip").dataset.state'
        )
        checks["status_eta"] = await page.evaluate(
            'document.querySelector("#status-eta").textContent'
        )
        checks["chamfer_clip"] = await page.evaluate(
            'getComputedStyle(document.querySelector(".btn-chamfer")).clipPath !== "none"'
        )
        checks["numbers_tabular"] = await page.evaluate(
            'getComputedStyle(document.querySelector(".num-value")).fontVariantNumeric'
        )

        # Lab mode
        await page.click('[data-mode="lab"]')
        await page.wait_for_timeout(200)
        checks["lab_visible"] = await page.evaluate(
            '!document.querySelector("#lab").hidden && document.querySelector("#quick").hidden'
        )
        checks["chip_active_bg"] = await page.evaluate(
            'getComputedStyle(document.querySelector(".chip.is-active")).backgroundColor'
        )
        checks["tick_header"] = await page.evaluate(
            'getComputedStyle(document.querySelector("th.tick"), "::before").content.includes("\u2500")'
        )
        checks["empty_state"] = await page.evaluate(
            'document.querySelector(".empty-state") !== null'
        )

        # Reduced motion: static verdict immediately after run
        await page.emulate_media(reduced_motion="reduce")
        await page.reload()
        await page.wait_for_load_state("networkidle")
        checks["reduced_motion_match"] = await page.evaluate(
            'window.matchMedia("(prefers-reduced-motion: reduce)").matches'
        )
        await page.click("#check-dns")
        await page.wait_for_selector(".verdict.run-complete", timeout=10000)
        checks["reduced_static"] = await page.evaluate(
            'getComputedStyle(document.querySelector("#verdict .rv-1")).animationName === "none"'
        )
        checks["reduced_visible"] = await page.evaluate(
            'getComputedStyle(document.querySelector("#verdict .rv-1")).opacity === "1"'
        )

        for k, v in checks.items():
            print(f"{k}: {v}")

        bad = [k for k, v in checks.items() if v in (False, None, "", "0")]
        print("FAILED:", bad if bad else "none")
        await browser.close()


asyncio.run(main())
