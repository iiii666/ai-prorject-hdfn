import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
base=os.environ.get('DW_BROWSER_URL','http://127.0.0.1:3001')
work=Path('work');work.mkdir(exist_ok=True)
checks=[{'name':n,'status':'passed'} for n in ['unit','postgres','build','e2e']]
fixture={'repository':'iiii666/ai-prorject-hdfn','source':'github','fetchedAt':'2026-11-13T00:00:00Z','cached':False,'limited':False,'automationPRs':1,'counts':{'ready':0,'running':0,'review':1,'blocked':0,'done':0},'tasks':[{'number':12,'title':'점포별 비중 표시 검증','stage':'review','url':'https://github.com/iiii666/ai-prorject-hdfn/issues/12','updatedAt':'','branch':'agent/issue-12-99-1','automated':True,'pr':{'number':24,'url':'https://github.com/iiii666/ai-prorject-hdfn/pull/24','draft':False,'merged':False},'report':{'passed':True,'checks':checks,'runUrl':'https://github.com/iiii666/ai-prorject-hdfn/actions/runs/99'},'leadMinutes':8}]}
with sync_playwright() as p:
    options={'headless':True,'args':['--no-sandbox']}
    if os.environ.get('CHROME_BINARY'):options['executable_path']=os.environ['CHROME_BINARY']
    browser=p.chromium.launch(**options)
    page=browser.new_page(viewport={'width':1600,'height':1000});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/api/development-workflow',lambda route:route.fulfill(json=fixture))
    page.goto(base+'/#workflow')
    expect(page.get_by_role('heading',name='개발 워크플로우',exact=True)).to_be_visible(timeout=30000)
    expect(page.get_by_text('GitHub 실제 조회 · 공개 Issue/PR 상태',exact=True)).to_be_visible()
    expect(page.get_by_role('link',name='점포별 비중 표시 검증',exact=True)).to_be_visible()
    expect(page.locator('.workflow-card .passed')).to_have_count(4)
    page.screenshot(path=str(work/'workflow-board.png'),full_page=True)
    page.get_by_role('button',name='발표용 시연 보기',exact=True).click()
    expect(page.get_by_text('시연 데이터 · 실제 실행 기록이 아닙니다',exact=True)).to_be_visible()
    expect(page.locator('.workflow-card')).to_have_count(5)
    page.set_viewport_size({'width':390,'height':844})
    page.screenshot(path=str(work/'workflow-mobile.png'),full_page=True)
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),'mobile overflow'
    page.get_by_role('button',name='실제 데이터 보기',exact=True).click()
    expect(page.get_by_role('link',name='점포별 비중 표시 검증',exact=True)).to_be_visible()
    assert not errors,errors
    browser.close()
    print(json.dumps({'result':'PASS','source':'controlled GitHub response fixture; no real Codex execution','flows':['live source label','task/PR/check links','explicit demo mode','mobile','return to live']},ensure_ascii=False))
