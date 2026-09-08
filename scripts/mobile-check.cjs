const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({channel:'msedge',headless:true});
 for (const width of [320,390,430]) {
  const page = await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-09-08T11:00:00+08:00'));
  const loaded=page.waitForResponse(r=>r.url().includes('september-schedules.json'));
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4174/dispatch-schedule-beta/');
  await loaded;
  await page.locator('.login-bike img').evaluate(i=>i.decode());
  if(width===390) await page.screenshot({path:'outputs/login-mobile.png',fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.getByRole('button',{name:'登入工作台'}).click();
  await page.getByRole('button',{name:'開啟選單'}).waitFor();
  async function go(name) {
   await page.getByRole('button',{name:'開啟選單'}).click();
   await page.locator('.sidebar.open').waitFor();
   await page.locator('nav').getByRole('button',{name,exact:true}).click();
   assert.equal(await page.locator('.sidebar.open').count(),0);
   await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=0);
  }
  async function fits(){ assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page overflow'); }
  await go('公告');
  await page.locator('.notice-image-card img').evaluate(i=>i.decode());
  await fits();
  assert(await page.locator('.notice-image-card img').evaluate(i=>i.clientWidth<=innerWidth));
  await go('我的班表');
  for(const name of ['早班','夜班']) {
   await page.getByRole('button',{name,exact:true}).click();
   await fits();
   await page.locator('.matrix-wrap').evaluate(e=>{e.scrollLeft=0;e.scrollTop=0;});
   const cell=page.locator('.schedule-matrix tbody tr:not(.area-heading) td').first();
   const before=await cell.boundingBox();
   const headerTop=await page.locator('.schedule-matrix thead th').first().evaluate(e=>e.getBoundingClientRect().top);
   await page.locator('.matrix-wrap').evaluate(e=>{e.scrollLeft=500;e.scrollTop=200;});
   const after=await cell.boundingBox();
   const nameCell=page.locator('.schedule-matrix tbody tr:not(.area-heading)').first().locator('td').nth(2);
   const nameX=(await nameCell.boundingBox()).x;
   const wrap=await page.locator('.matrix-wrap').boundingBox();
   assert(Math.abs(nameX-wrap.x-1)<3,'name pins to left edge');
   assert(wrap.y<135,'schedule starts near top');
   await page.locator('.matrix-wrap').evaluate(e=>e.scrollLeft=800);
   assert(Math.abs((await nameCell.boundingBox()).x-nameX)<2,'name stays pinned as dates scroll');
   const tops=await page.locator('.schedule-matrix thead th').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().top));
   assert(tops.every(y=>Math.abs(y-headerTop)<2),'all column headers must remain aligned on vertical scroll');
   assert(after.x<before.x-400,`frozen horizontal columns ${name}: ${before.x} -> ${after.x}`);
   await page.locator('.matrix-wrap').evaluate(e=>e.scrollLeft=e.scrollWidth);
   assert(await page.locator('.matrix-wrap').evaluate(e=>e.scrollLeft>500));
  }
  await go('派工單');
  assert.equal(await page.locator('input[type=date]').inputValue(),'2026-09-08');
  await page.locator('input[type=date]').fill('2026-10-01');
  await page.getByText('此月份尚未匯入班表').waitFor();
  assert.equal(await page.locator('.dispatch-card').count(),0);
  await go('預排班');
  await fits();
  assert.equal(await page.locator('.month-day').count(),31);
  assert.equal(await page.locator('.weekday').count(),7);
  await page.locator('.month-day').first().click();
  assert.equal(await page.locator('.month-day strong').first().innerText(),'上班');
  await page.getByRole('button',{name:'例',exact:true}).click();
  await page.locator('.month-day').nth(1).click();
  assert.equal(await page.locator('.month-day strong').nth(1).innerText(),'例');
  await page.getByRole('button',{name:'上班',exact:true}).click();
  for(let day=3;day<10;day++) await page.locator('.month-day').nth(day).click();
  assert(await page.getByRole('button',{name:'儲存預排班'}).isDisabled());
  for(const name of ['假勤／特休','個人資料','工作總覽']) {await go(name);await fits();}
  await page.locator('.welcome .bike-art img').evaluate(i=>i.decode());
  if(width===390) await page.screenshot({path:'outputs/home-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'開啟選單'}).click();
  await page.getByRole('button',{name:'關閉選單'}).last().click();
  assert.equal(await page.locator('.sidebar.open').count(),0);
  assert.deepEqual(errors,[]);
  console.log(`${width}px: menu, all pages, notice scaling, day/night scrolling PASS`);
  await page.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
