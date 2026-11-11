import asyncio
import os

from playwright.async_api import async_playwright


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path=os.getenv("CHROMIUM_PATH") or None,
            headless=True,
            args=["--no-sandbox"],
        )
        page = await browser.new_page(
            base_url=os.getenv("APP_URL", "http://127.0.0.1:3001"),
            viewport={"width": 1440, "height": 1000},
        )
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        async with page.expect_response(
            lambda r: "/api/analytics" in r.url and r.status == 200, timeout=60000
        ):
            await page.goto(os.getenv("APP_URL", "http://127.0.0.1:3001"))
        await page.get_by_text("DB에서 조회하고 있습니다…", exact=True).wait_for(
            state="hidden"
        )
        await page.screenshot(path="/tmp/python-dashboard.png", full_page=True)
        await page.get_by_label("점포", exact=True).select_option("1")
        await page.get_by_label("채널", exact=True).select_option("모바일 앱")
        async with page.expect_response(
            lambda r: "/api/analytics" in r.url and r.status == 200, timeout=60000
        ) as filtered:
            await page.get_by_role("button", name="조회", exact=True).click()
        result = await (await filtered.value).json()
        assert result["range"]["store"] == "1"
        assert result["range"]["channel"] == "모바일 앱"
        print("PASS filters")
        for label in [
            "고객 분석",
            "매출 분석",
            "캠페인 성과",
            "앱 이용 현황",
            "예산·실적",
            "데이터 카탈로그",
            "데이터 리니지",
            "관리자 설정",
            "커스텀 분석",
        ]:
            await page.get_by_role("button", name=label, exact=True).click()
            await page.wait_for_timeout(250)
            assert not await page.get_by_text(
                "데이터 조회에 실패했습니다. 서버 로그를 확인하세요.", exact=True
            ).count(), label
            print("PASS", label)
        await page.get_by_role("button", name="LLM 분석 실행", exact=True).wait_for()
        original = (await (await page.request.get("/api/bootstrap")).json())["settings"]
        try:
            await page.get_by_role("button", name="관리자 설정", exact=True).click()
            await page.get_by_label("워크스페이스 이름", exact=True).fill(
                "Python 브라우저 검증"
            )
            async with page.expect_response(
                lambda r: "/api/settings" in r.url and r.status == 200
            ):
                await page.get_by_role(
                    "button", name="DB에 설정 저장", exact=True
                ).click()
            stored = (await (await page.request.get("/api/bootstrap")).json())[
                "settings"
            ]
            assert stored["workspaceName"] == "Python 브라우저 검증"
            print("PASS settings save")
        finally:
            response = await page.request.patch(
                "/api/settings",
                data={k: original[k] for k in ["workspaceName", "alertsEnabled"]},
            )
            assert response.ok

        await page.get_by_role("button", name="통합 현황", exact=True).click()
        async with page.expect_download() as dl:
            await page.get_by_role("button", name="요약 다운로드", exact=True).click()
        assert (await dl.value).suggested_filename == "hyundai-dw-summary.csv"
        assert not errors, errors
        print("PASS CSV; no browser exceptions")
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
