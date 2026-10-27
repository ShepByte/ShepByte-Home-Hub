/* Run against the real, unchanged HTTP server. npm run test:dashboard */
'use strict';
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const {randomBytes}=require('node:crypto');
const playwright=require('playwright');
const engine=process.env.BROWSER||'chromium';
const folder=mkdtempSync(join(tmpdir(),'hub-dashboard-'));
const token=randomBytes(36).toString('hex');
const port=18765,base=`http://127.0.0.1:${port}`;
const server=spawn('python3',['-m','home_hub.server','--port',String(port),'--data',folder],{cwd:resolve(__dirname,'..'),env:{...process.env,HOME_HUB_ADMIN_TOKEN:token},stdio:'ignore'});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function api(path,body,auth=token,hub){
 const r=await fetch(base+'/api/v1/'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json',...(hub?{'X-Hub-ID':hub}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;
}
(async()=>{
 let browser;
 try{
  for(let i=0;i<60;i++){try{await fetch(base+'/');break;}catch(e){if(i===59)throw e;await delay(100);}}
  browser=await playwright[engine].launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote']}:{})});
  const failures=[];
  for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:568},{width:844,height:390}]){
   for(const path of ['/prototype/','/']){
    const context=await browser.newContext({viewport,hasTouch:viewport.width<900,isMobile:viewport.width<900,reducedMotion:'reduce'});
    const page=await context.newPage();
    page.on('pageerror',e=>failures.push(e.message));
    page.on('console',m=>{if(m.type()==='error')failures.push(m.text());});
    await page.goto(base+path);
    if(path==='/'){await page.locator('#token').fill(token);await page.locator('#connect').click();await page.locator('#workspace').waitFor({state:'visible'});}
    await page.locator('.world-camera').evaluate(el=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page overflow');
    assert.equal(await page.locator('.world-camera').evaluate(el=>el.offsetWidth),2400);
    assert.equal(await page.locator('.world-viewport').evaluate(el=>getComputedStyle(el).touchAction),'none');
    assert.equal(await page.locator('.floating-art').first().evaluate(el=>getComputedStyle(el).animationName),'none');
    assert.equal(await page.locator('.data-ball').first().evaluate(el=>getComputedStyle(el).display),'none');
    const visibleNodes=await page.locator('.node').evaluateAll(nodes=>nodes.filter(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}).length);
    assert(visibleNodes<7,'World must not fit all islands into the viewport');
    const camera=()=>page.locator('.world-camera').evaluate(el=>el.style.transform);
    const before=await camera();
    // Drag begins on the home button; it must pan without opening a panel.
    await page.mouse.move(viewport.width/2,viewport.height/2);await page.mouse.down();
    await page.mouse.move(viewport.width/2-90,viewport.height/2+30,{steps:8});await page.mouse.up();await delay(60);
    assert.notEqual(await camera(),before,'Dragging changes camera');
    assert(await page.locator('#panel').isHidden(),'Dragging must not activate nodes');
    await page.locator('[data-camera="home"]').click();await delay(60);
    await page.locator('[data-travel="devices"]').click();await delay(60);
    const node=page.locator('[data-node="devices"]');
    await node.click();
    await page.locator('#panel').waitFor({state:'visible'});
    assert.equal(await page.locator('#panel-title').textContent(),'Devices');
    const panelRect=await page.locator('#panel').boundingBox();
    assert(panelRect.x>=0&&panelRect.x+panelRect.width<=viewport.width,'Panel inside viewport');
    assert(panelRect.y>=0&&panelRect.y+panelRect.height<=viewport.height,'Panel vertically accessible');
    await page.locator('#close-panel').click();assert(await page.locator('#panel').isHidden());
    const zoom=await page.locator('#zoom-level').textContent();
    await page.locator('[data-camera="in"]').click();await delay(60);assert.notEqual(await page.locator('#zoom-level').textContent(),zoom);
    await page.locator('[data-camera="weather"]').click();assert.equal(await page.locator('[data-camera="weather"]').getAttribute('aria-pressed'),'true');
    await page.locator('.world-viewport').focus();const pos=await camera();await page.keyboard.press('ArrowRight');await delay(60);assert.notEqual(await camera(),pos);
    await page.keyboard.press('Home');await delay(60);
    await page.setViewportSize({width:viewport.height,height:viewport.width});await delay(60);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Rotation must not overflow');
    console.log(`PASS ${engine} ${path} ${viewport.width}x${viewport.height}: pan/tap, navigation, zoom, panels, keyboard, rotation, reduced motion`);
    await context.close();
   }
  }
  // Touch input, animation and pinch on a phone-sized Chromium viewport.
  if(engine==='chromium'){
   const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});const page=await context.newPage();
   page.on('pageerror',e=>failures.push(e.message));await page.goto(base+'/prototype/');
   const cdp=await context.newCDPSession(page);
   const before=await page.locator('.world-camera').evaluate(el=>el.style.transform);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:190,y:420}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:90,y:450}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(80);
   assert.notEqual(await page.locator('.world-camera').evaluate(el=>el.style.transform),before);
   assert(await page.locator('#panel').isHidden());
   const zoom=await page.locator('#zoom-level').textContent();
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:0,x:130,y:400},{id:1,x:230,y:400}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:0,x:90,y:400},{id:1,x:270,y:400}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(80);
   assert.notEqual(await page.locator('#zoom-level').textContent(),zoom,'Pinch changes zoom');
   const orb=page.locator('.data-ball').first();const a=await orb.boundingBox();await delay(150);const b=await orb.boundingBox();assert.notEqual(a.x,b.x,'Data balls travel along branches');
   await context.close();console.log('PASS touch swipe, pinch zoom and moving data balls');
  }
  // Secure pairing and device views still use the unmodified protocol.
  const invite=await api('admin/invites',{}),deviceToken=randomBytes(36).toString('hex');
  await api('pairings',{protocol_version:1,hub_id:invite.hub_id,invitation:invite.invitation,device_id:'browser-test',name:'Market Monitor',software_version:'test',dashboard_url:'http://localhost:8080',device_token:deviceToken});
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});page.on('pageerror',e=>failures.push(e.message));
  await page.goto(base);await page.locator('#token').fill(token);await page.locator('#connect').click();await page.locator('#workspace').waitFor({state:'visible'});
  await page.locator('[data-travel="devices"]').click();await page.locator('[data-node="devices"]').click();
  await page.getByRole('button',{name:'Approve',exact:true}).click();await page.getByRole('button',{name:/Market Monitor/}).waitFor();
  await api('devices/browser-test/heartbeat',{sequence:1,observed_at:new Date().toISOString(),hardware:{cpu_percent:12,cpu_temp_c:40,ram_used_bytes:2000000,ram_total_bytes:8000000,storage_used_bytes:20000000,storage_total_bytes:80000000,uptime_seconds:3600},research:{state:'completed',last_completed_at:null}},deviceToken,invite.hub_id);
  await api('devices/browser-test/events',{events:[{event_id:'browser-event',kind:'research.completed',occurred_at:new Date().toISOString()}]},deviceToken,invite.hub_id);
  await page.getByRole('button',{name:/Market Monitor/}).click();await page.locator('#detail').waitFor({state:'visible'});
  await delay(5200);assert(await page.locator('#detail').isVisible(),'Polling must not close detail');assert(await page.locator('#panel').isHidden());
  assert((await page.locator('#content').textContent()).includes('40 °C'));
  assert.equal(await page.getByRole('link',{name:/Open device dashboard/}).getAttribute('rel'),'noopener noreferrer');
  await page.getByRole('button',{name:'History',exact:true}).click();await page.getByText(/research.completed/).waitFor();
  await page.locator('[data-tab="settings"]').click();assert.equal(await page.locator('#content input[type=checkbox]').isChecked(),false);
  await page.locator('#detail-back').click();await page.locator('#panel').waitFor({state:'visible'});
  await page.locator('#lock').click();await page.locator('#login').waitFor({state:'visible'});
  assert.equal(await page.locator('#token').inputValue(),'');
  console.log('PASS real API: pairing approval, telemetry, detail polling, history, sharing default and lock');
  assert.deepEqual(failures,[],'No browser exceptions or CSP errors');
 }finally{if(browser)await browser.close();server.kill();await delay(200);rmSync(folder,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
