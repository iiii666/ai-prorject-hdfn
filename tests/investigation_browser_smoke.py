import json, os, uuid
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
base=os.environ.get('DW_BROWSER_URL','http://127.0.0.1:3001')
work=Path('work');work.mkdir(exist_ok=True)
token=uuid.uuid4().hex[:8]
name='조사 검증 '+token
with sync_playwright() as p:
    options={'headless':True,'args':['--no-sandbox']}
    if os.environ.get('CHROME_BINARY'):options['executable_path']=os.environ['CHROME_BINARY']
    browser=p.chromium.launch(**options)
    page=browser.new_page(viewport={'width':1600,'height':1000})
    errors=[];held=[];first=[True]
    page.on('pageerror',lambda e:errors.append(str(e)))
    def hold_step(route):
        if first[0]:
            first[0]=False;held.append(route)
            page.evaluate('window.__investigationStepHeld = true')
        else:route.continue_()
    page.route('**/api/investigations/*/step',hold_step)
    page.goto(base+'/#investigator')
    expect(page.get_by_role('heading',name='AI 조사 에이전트',exact=True)).to_be_visible(timeout=30000)
    expect(page.get_by_role('button',name='내 분석 앱',exact=True)).to_have_count(0)
    page.get_by_role('combobox',name='조사 모드',exact=True).select_option('demo')
    page.get_by_role('textbox',name='조사 요청',exact=True).fill('지난주 매출이 감소한 점포를 조사해줘 '+token)
    page.get_by_role('button',name='조사 시작',exact=True).click()
    expect(page.locator('.invest-working')).to_be_visible(timeout=15000)
    page.wait_for_function('window.__investigationStepHeld === true')
    assert held,'expected first step to be pending'
    page.get_by_role('textbox',name='조사 요청',exact=True).fill('오프라인 말고 모바일 쪽만 더 봐줘')
    page.get_by_role('button',name='후속 요청 보내기',exact=True).click()
    expect(page.locator('.invest-message.user').last).to_contain_text('모바일')
    held[0].continue_()
    expect(page.locator('.invest-progress > .invest-section-heading')).to_contain_text('조사 완료',timeout=20000)
    expect(page.locator('.invest-step').last).to_contain_text('고객 등급 비교')
    expect(page.locator('.invest-evidence')).to_contain_text('모바일 앱')
    expect(page.locator('.invest-round').first).to_contain_text('후속 요청으로 전환')
    page.evaluate('window.scrollTo(0,0);document.activeElement.blur()')
    page.screenshot(path=str(work/'investigation-conversation.png'),full_page=True)
    page.reload()
    page.locator('.invest-history > summary').click()
    page.locator('.invest-history > button').filter(has_text=token).click()
    expect(page.locator('.invest-progress > .invest-section-heading')).to_contain_text('조사 완료')
    page.get_by_role('textbox',name='조사 요청',exact=True).fill('이 결과를 분석 화면으로 저장하고 매주 확인해줘')
    page.get_by_role('button',name='후속 요청 보내기',exact=True).click()
    page.get_by_role('button',name='저장·감시 초안 검토',exact=True).click(timeout=20000)
    page.get_by_role('textbox',name='분석 이름',exact=True).fill(name)
    expect(page.get_by_label('정기 감시 활성화',exact=True)).not_to_be_checked()
    apps=page.request.get(base+'/api/my-apps').json()
    assert not any(a['title']==name for a in apps),'must not save before approval'
    page.get_by_role('button',name='확인하고 분석·감시 저장',exact=True).click()
    page.get_by_role('button',name='저장한 분석 열기',exact=True).click(timeout=15000)
    expect(page.get_by_role('heading',name='저장한 분석',exact=True)).to_be_visible()
    page.locator('.invest-output-grid > button').filter(has_text=name).click()
    expect(page.locator('.app-preview')).to_contain_text(name)
    page.get_by_role('tab',name='정기 감시',exact=True).click()
    page.locator('.invest-output-grid > button').filter(has_text=name).click()
    expect(page.get_by_role('heading',name='감시 설정',exact=True)).to_be_visible()
    expect(page.get_by_label('정기 감시 활성화',exact=True)).not_to_be_checked()
    page.get_by_role('button',name='지금 시험 실행',exact=True).click()
    expect(page.locator('.invest-monitor .app-run')).to_be_visible(timeout=15000)
    page.get_by_role('tab',name='조사 대화',exact=True).click()
    page.set_viewport_size({'width':390,'height':844})
    page.evaluate('window.scrollTo(0,0);document.activeElement.blur()')
    page.screenshot(path=str(work/'investigation-mobile.png'),full_page=True)
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),'mobile overflow'
    assert not errors,errors
    saved=next(a for a in page.request.get(base+'/api/my-apps').json() if a['title']==name)
    page.request.delete(base+'/api/my-apps/'+saved['id'])
    print(json.dumps({'result':'PASS','mode':'explicit rule-based demo; no model mocks','flows':['new navigation','intervention during pending step','mobile grades','resume after reload','proposal before approval','atomic save','saved output','monitor test','mobile'],'browser_errors':errors},ensure_ascii=False))
    browser.close()
