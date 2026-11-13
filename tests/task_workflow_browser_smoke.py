import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
base = os.environ.get('DW_BROWSER_URL', 'http://127.0.0.1:3101')
work = Path('work'); work.mkdir(exist_ok=True)
with sync_playwright() as p:
    options = {'headless': True, 'args': ['--no-sandbox']}
    if os.environ.get('CHROME_BINARY'): options['executable_path'] = os.environ['CHROME_BINARY']
    browser = p.chromium.launch(**options)
    page = browser.new_page(viewport={'width': 1500, 'height': 1000}, accept_downloads=True)
    errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
    try:
        page.goto(base + '/#investigator')
        page.get_by_role('tab', name='맡긴 업무', exact=True).click()
        page.locator('.task-list > button').first.click()
        flow = page.get_by_role('region', name='업무 검토와 보고서', exact=True)
        expect(flow).to_contain_text('더현대 서울의 변화를 확인했어요', timeout=30000)
        flow.get_by_role('button', name='확인했어요, 다음으로', exact=True).click()
        expect(flow).to_contain_text('최근 행사나 매장 운영에 변화가 있었나요?')
        flow.get_by_role('textbox', name='업무 상황', exact=True).fill('지난주 모바일 할인 행사가 끝났어요.')
        flow.get_by_role('button', name='상황을 저장하고 함께 조사하기', exact=True).click()
        flow.get_by_role('combobox', name='업무 대화 방식', exact=True).select_option('demo')
        flow.get_by_role('button', name='어느 채널에서 줄었나요?', exact=True).click()
        next_button = flow.get_by_role('button', name='조사 내용을 확인하고 다음 행동 정하기', exact=True)
        expect(next_button).to_be_enabled(timeout=30000)
        expect(flow.locator('.review-messages article.assistant')).to_contain_text('조회 결과')
        flow.locator('.review-evidence > summary').click()
        flow.locator('.review-evidence > details > summary').first.click()
        expect(flow.locator('.review-evidence')).to_contain_text('86,100,000')
        flow.get_by_role('textbox', name='업무 에이전트에게 답변', exact=True).fill('모바일 쪽만 더 봐줘')
        flow.get_by_role('button', name='보내기', exact=True).click()
        expect(flow.locator('.review-messages article.user').last).to_contain_text('모바일')
        expect(next_button).to_be_enabled(timeout=30000)
        next_button.click()
        flow.get_by_role('combobox', name='업무 판단', exact=True).select_option('expected')
        flow.get_by_label('담당자에게 확인할 내용을 정리할게요', exact=True).check()
        flow.get_by_role('textbox', name='다음 행동 메모', exact=True).fill('행사 종료일과 모바일 주문 감소 구간을 담당자에게 확인하기')
        flow.get_by_role('button', name='판단과 다음 행동 저장하기', exact=True).click()
        download = flow.get_by_role('button', name='보고서 PDF 다운로드', exact=True)
        expect(download).to_be_enabled(timeout=30000)
        expect(flow.locator('.review-report-preview')).to_contain_text('지난주 모바일 할인 행사가 끝났어요.')
        expect(flow.locator('.review-report-preview')).to_contain_text('예상된 변화')
        with page.expect_download(timeout=60000) as info:
            download.click()
        info.value.save_as(work / 'task-workflow-report.pdf')
        assert (work / 'task-workflow-report.pdf').read_bytes().startswith(b'%PDF-')
        expect(flow.get_by_role('status')).to_contain_text('보고서를 만들었습니다', timeout=15000)
        assert '시연' not in flow.inner_text()
        page.evaluate('document.activeElement.blur()')
        page.screenshot(path=str(work / 'task-workflow-report.png'), full_page=True)
        page.reload()
        page.get_by_role('tab', name='맡긴 업무', exact=True).click()
        flow = page.get_by_role('region', name='업무 검토와 보고서', exact=True)
        expect(flow.get_by_role('button', name='보고서 PDF 다운로드', exact=True)).to_be_enabled(timeout=30000)
        expect(flow).to_contain_text('행사 종료일과 모바일 주문 감소 구간')
        page.set_viewport_size({'width': 390, 'height': 844})
        page.wait_for_function("document.querySelector('.sidebar').getBoundingClientRect().right <= 0")
        page.evaluate('document.activeElement.blur()')
        page.screenshot(path=str(work / 'task-workflow-mobile.png'), full_page=True)
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth'), 'mobile overflow'
        assert not errors, errors
        print(json.dumps({'result': 'PASS', 'flows': ['briefing', 'business context', 'inline adaptive investigation', 'follow-up answer', 'evidence', 'human judgment', 'next action', 'Korean PDF download', 'restore after reload', 'mobile'], 'browser_errors': errors}, ensure_ascii=False), flush=True)
    except Exception:
        page.screenshot(path=str(work / 'task-workflow-failure.png'), full_page=True)
        raise
    finally:
        browser.close()
