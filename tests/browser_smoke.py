import json, os, uuid
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
root=Path(__file__).resolve().parent.parent/'work'
root.mkdir(exist_ok=True)
base=os.environ.get('DW_BROWSER_URL','http://127.0.0.1:3001')
token=uuid.uuid4().hex[:8]
app_name='브라우저 검증 · 점포 매출 '+token
edit_name='브라우저 검증 · 수정 '+token
agent_name='브라우저 검증 · 감시 '+token
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROME_BINARY','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000},device_scale_factor=1)
    errors=[]
    page.on('pageerror',lambda err:errors.append(str(err)))
    # Only the LLM planning responses are mocked; preview/storage/runs use the real API/MySQL.
    def meta_route(route):
        response=route.fetch()
        value=response.json()
        value['aiConfigured']=True
        route.fulfill(response=response,json=value)
    def app_plan(route):
        value=route.request.post_data_json
        current=value['current']
        current['title']=app_name
        current['chart']='line' if '선 차트' in value['prompt'] else 'bar'
        route.fulfill(json={'spec':current,'message':'검증용 AI 설정 응답'})
    page.route('**/api/my-apps/meta',meta_route)
    page.route('**/api/my-apps/plan',app_plan)
    page.route('**/api/metric-agents/plan',lambda route:route.fulfill(json={'config':{'name':agent_name,'frequency':'weekly','weekday':1,'time':'09:00','metric':'sales','condition':'drop','threshold':10,'period':'week'},'message':'검증용 감시 설정 응답'}))
    page.goto(base+'/#myapps')
    expect(page.get_by_role('heading',name='새 분석 앱 만들기')).to_be_visible(timeout=30000)
    page.get_by_role('button',name='대화로 구성',exact=True).click()
    expect(page.locator('.app-preview')).to_be_visible(timeout=15000)
    page.get_by_role('textbox',name='에이전트에게 요청',exact=True).fill('선 차트로 바꿔줘')
    page.get_by_role('button',name='대화로 구성',exact=True).click()
    expect(page.get_by_role('combobox',name='표현 방식',exact=True)).to_have_value('line',timeout=15000)
    page.get_by_label('앱 이름',exact=True).fill(app_name)
    page.get_by_role('button',name='미리보기',exact=True).click()
    expect(page.locator('.app-preview')).to_be_visible(timeout=15000)
    expect(page.locator('.app-preview').get_by_text(app_name,exact=True)).to_be_visible()
    page.get_by_role('button',name='앱 저장',exact=True).click()
    expect(page.locator('.app-success')).to_contain_text('저장했습니다',timeout=15000)
    page.reload()
    expect(page.get_by_role('heading',name='새 분석 앱 만들기')).to_be_visible(timeout=15000)
    page.locator('.app-library-item').filter(has_text=app_name).click()
    expect(page.locator('.app-preview')).to_be_visible(timeout=15000)
    page.evaluate('window.scrollTo(0,0); document.activeElement.blur()')
    page.screenshot(path=str(root/'analysis-apps.png'),full_page=True)
    page.get_by_role('button',name='버전 이력',exact=True).click()
    expect(page.get_by_role('button',name='초안으로 복원')).to_be_visible()
    page.get_by_text('직접 구성 · AI가 선택한 설정 확인',exact=True).click()
    page.get_by_label('앱 이름',exact=True).fill(edit_name)
    page.get_by_role('button',name='앱 저장',exact=True).click()
    expect(page.locator('.app-library-item').filter(has_text=edit_name)).to_be_visible(timeout=15000)
    page.get_by_role('button',name='버전 이력',exact=True).click()
    expect(page.get_by_role('button',name='초안으로 복원')).to_have_count(2)
    page.get_by_role('button',name='초안으로 복원').last.click()
    expect(page.get_by_label('앱 이름',exact=True)).to_have_value(app_name)
    page.get_by_role('button',name='앱 저장',exact=True).click()
    expect(page.locator('.app-success')).to_contain_text('저장했습니다',timeout=15000)
    page.get_by_role('button',name='감시 연결',exact=True).click()
    page.get_by_role('button',name='대화로 감시 설정',exact=True).click()
    expect(page.get_by_label('감시 이름',exact=True)).to_have_value(agent_name,timeout=15000)
    page.get_by_role('combobox',name='발견 조건',exact=True).select_option('below')
    page.get_by_label('임계값 (원)',exact=True).fill('1000000000000')
    page.get_by_role('button',name='감시 저장',exact=True).click()
    expect(page.get_by_role('button',name='지금 시험 실행',exact=True)).to_be_visible(timeout=15000)
    page.get_by_role('button',name='지금 시험 실행',exact=True).click()
    expect(page.locator('.app-run.alert')).to_be_visible(timeout=15000)
    expect(page.locator('.app-run').first).to_contain_text('추가 조회')
    page.evaluate('window.scrollTo(0,0); document.activeElement.blur()')
    page.screenshot(path=str(root/'metric-agents.png'),full_page=True)
    page.get_by_label('정기 감시 활성화',exact=True).check()
    page.get_by_role('button',name='감시 저장',exact=True).click()
    expect(page.locator('.app-success')).to_contain_text('활성화했습니다',timeout=15000)
    page.reload()
    page.get_by_role('tab',name='지표 감시 에이전트').click()
    page.locator('.app-library-item').filter(has_text=agent_name).click()
    expect(page.get_by_label('정기 감시 활성화',exact=True)).to_be_checked(timeout=15000)
    expect(page.locator('.app-run')).to_have_count(1)
    page.get_by_label('정기 감시 활성화',exact=True).uncheck()
    page.get_by_role('button',name='감시 저장',exact=True).click()
    expect(page.locator('.app-success')).to_contain_text('저장했습니다',timeout=15000)
    page.set_viewport_size({'width':390,'height':844})
    page.evaluate('window.scrollTo(0,0); document.activeElement.blur()')
    page.screenshot(path=str(root/'mobile-agents.png'),full_page=True)
    overflow=page.evaluate('document.documentElement.scrollWidth > innerWidth')
    assert not overflow, 'mobile horizontal page overflow'
    page.on('dialog',lambda dialog:dialog.accept())
    page.get_by_role('button',name='감시 삭제',exact=True).click()
    expect(page.locator('.app-library-item').filter(has_text=agent_name)).to_have_count(0,timeout=15000)
    page.get_by_role('tab',name='분석 앱',exact=False).first.click()
    page.locator('.app-library-item').filter(has_text=app_name).click()
    page.get_by_role('button',name='분석 앱 삭제',exact=True).click()
    expect(page.locator('.app-library-item').filter(has_text=app_name)).to_have_count(0,timeout=15000)
    assert not errors, errors
    print(json.dumps({'result':'PASS','flows':['sidebar navigation','AI creation/follow-up UI (LLM mock)','AI agent configuration UI (LLM mock)','preview','save/reload','edit/version restore','agent create','test run/drilldown','activate/pause/reload','mobile overflow','delete'],'browser_errors':errors},ensure_ascii=False))
    browser.close()
