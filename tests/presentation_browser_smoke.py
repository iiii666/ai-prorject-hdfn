import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
base = os.environ.get('DW_BROWSER_URL', 'http://127.0.0.1:5173')
work = Path('work'); work.mkdir(exist_ok=True)
with sync_playwright() as p:
    options = {'headless': True, 'args': ['--no-sandbox']}
    if os.environ.get('CHROME_BINARY'): options['executable_path'] = os.environ['CHROME_BINARY']
    browser = p.chromium.launch(**options)
    page = browser.new_page(viewport={'width': 1500, 'height': 1000})
    errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(base + '/#investigator')
    page.get_by_role('tab', name='맡긴 업무', exact=True).click()
    agents = page.request.get(base + '/api/metric-agents').json()
    agent = next(a for a in agents if a['config'].get('demoScenario', {}).get('id') == 'two-week-sales-v1')
    page.locator('.task-list > button').filter(has_text=agent['name']).click()
    expect(page.locator('.task-detail')).to_contain_text('발표용 합성 시나리오')
    history = page.request.get(base + '/api/metric-agents/' + agent['id'] + '/runs').json()
    replay = [r for r in history if r['kind'] == 'replay' and r['report'].get('demonstration')]
    assert len(replay) == 2
    assert sorted(r['report']['alertCount'] for r in replay) == [0, 1]
    assert next(f['group'] for r in replay for f in r['report'].get('findings', []) if f['state'] == 'new') == '판교점'
    expect(page.locator('.task-section > summary').filter(has_text='활동 기록 ·')).to_contain_text('활동 기록 · ' + str(len(history)) + '건', timeout=30000)
    page.locator('.task-section > summary').filter(has_text='활동 기록 ·').click()
    page.screenshot(path=str(work / 'presentation-history.png'), full_page=True)
    page.locator('.task-section > summary').filter(has_text='활동 기록 ·').click()
    with page.expect_response(lambda r: r.url.endswith('/api/metric-agents/' + agent['id'] + '/test'), timeout=90000) as response:
        page.get_by_role('button', name='지금 확인하기', exact=True).click()
    run = response.value.json()
    (work / 'presentation-check.json').write_text(json.dumps({'agentId': agent['id'], 'runId': run['id'], 'sessions': [f['investigation']['sessionId'] for f in run['report']['findings'] if f.get('investigation', {}).get('sessionId')]}))
    assert run['report']['alertCount'] == 1
    recent = page.locator('.task-detail > .panel').nth(1)
    expect(recent.locator('.task-findings > .task-finding')).to_have_count(1, timeout=30000)
    expect(recent.locator('.task-finding')).to_contain_text('더현대 서울')
    expect(recent.locator('.task-finding')).to_contain_text('-18%')
    expect(recent.locator('.task-finding')).to_contain_text('조사 완료')
    page.screenshot(path=str(work / 'presentation-now.png'), full_page=True)
    page.get_by_role('button', name='근거 확인·후속 질문', exact=True).click()
    expect(page.locator('.task-conversation-context')).to_contain_text('발표용 합성')
    expect(page.locator('.invest-evidence')).to_contain_text('발표용 합성')
    assert not errors, errors
    print(json.dumps({'result': 'PASS', 'history': '정상 1회 + 판교점 감소 1회', 'now': '더현대 서울 감소 1건', 'browser_errors': errors}, ensure_ascii=False), flush=True)
    browser.close()
