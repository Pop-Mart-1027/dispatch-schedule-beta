import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

const { code } = await transformWithEsbuild(readFileSync('lib/pre-schedule-window.ts', 'utf8'), 'pre-window.ts', { loader: 'ts' });
const { preWindowInput, parsePreWindowInput, preWindowConfiguration, preReopenDeadline } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const now = Date.parse('2026-09-13T00:21:16Z');
test('Taipei input remains unchanged across repeated save/load, without 8-hour drift', () => {
  let value = '2026-09-13T08:21';
  for (let i = 0; i < 10; i++) value = preWindowInput(parsePreWindowInput(value));
  assert.equal(value, '2026-09-13T08:21');
  assert.equal(new Date(parsePreWindowInput(value)).toISOString(), '2026-09-13T00:21:00.000Z');
});
test('immediate open starts now and uses the selected same-day cutoff', () => {
  const end = preReopenDeadline('22', '30', now);
  assert.equal(preWindowInput(end), '2026-09-13T22:30');
  assert.deepEqual(preWindowConfiguration('', preWindowInput(end), 'open', true, now), { status: 'open', openAt: now, closeAt: end });
});
test('past cutoff moves to tomorrow, including year rollover', () => {
  assert.equal(preWindowInput(preReopenDeadline('08', '00', now)), '2026-09-14T08:00');
  assert.equal(preWindowInput(preReopenDeadline('00', '00', Date.parse('2026-12-31T15:59:00Z'))), '2027-01-01T00:00');
});
test('scheduled window and explicit lock are preserved', () => {
  const scheduled = preWindowConfiguration('2026-09-14T08:00', '2026-09-15T22:30', 'save', false, now);
  assert.ok(scheduled.openAt > now);
  assert.equal(scheduled.status, 'open');
  assert.equal(preWindowConfiguration('2026-09-14T08:00', '2026-09-15T22:30', 'close', false, now).status, 'locked');
});
test('invalid, missing and expired input is rejected before configure', () => {
  for (const value of ['', '2026-02-30T10:00', '2026-09-13T25:00']) assert.throws(() => parsePreWindowInput(value));
  assert.throws(() => preReopenDeadline('24', '00', now));
  assert.throws(() => preReopenDeadline('22', '', now));
  assert.throws(() => preWindowConfiguration('', '2026-09-12T22:30', 'open', false, now));
});

const virtual = {
  'opening:api': `export * from '/lib/pre-schedule.ts';
    export async function preCall(action,monthKey,values={}) {
      window.calls.push({action,monthKey,...values});
      if(action==='configure') {
        if(window.rejectConfigure)throw Error('Fixture permission denied');
        window.state.month={monthKey,status:values.status,openAt:values.openAt,closeAt:values.closeAt,publishJob:null};
        window.state.settings=null;
      }
      if(action==='save')window.state.entry={...window.state.entry,...values,revision:values.revision+1,submitted:window.state.entry.submitted||!!values.submit};
      return structuredClone({...window.state,ownerId:'P1'});
    }`,
  'opening:entry': `import React from 'react';import {createRoot} from 'react-dom/client';
    import {PreScheduleSettings} from '/app/pre-schedule-settings.tsx';
    import {EmployeePreSchedule} from '/app/pre-schedule-employee.tsx';
    import '/app/globals.css';import '/app/admin-console.css';
    createRoot(document.getElementById('root')).render(<><PreScheduleSettings employeeId="A1"/><EmployeePreSchedule cellStyle={()=>''}/></>);`,
};
const server = await createServer({ configFile: false, logLevel: 'error', plugins: [react(), {
  name: 'opening-fixtures', enforce: 'pre',
  resolveId(id) { if (id in virtual) return '\0' + id; },
  async load(id) {
    if (!id.startsWith('\0opening:')) return;
    const code = virtual[id.slice(1)];
    return (await transformWithEsbuild(code, 'fixture.tsx', { loader: 'tsx', jsx: 'automatic' })).code;
  },
  transform(code, id) {
    if (/\/app\/pre-schedule-(settings|employee)\.tsx$/.test(id.replaceAll('\\', '/')))
      return code.replace("from '../lib/pre-schedule'", "from 'opening:api'");
  },
  configureServer(server) { server.middlewares.use('/opening-test', async (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(await server.transformIndexHtml('/opening-test', '<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module" src="/@id/__x00__opening:entry"></script>'));
  }); },
}], server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
after(async () => { await browser.close(); await server.close(); });
async function open(timezoneId = 'Asia/Taipei', requestedDays = Array(31).fill('')) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, timezoneId });
  page.setDefaultTimeout(8000);
  await page.addInitScript(({ now, requestedDays }) => {
    const NativeDate = Date;
    window.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
    window.calls = [];
    window.state = { month: null, settings: { startAt: now - 60000, endAt: now + 3600000, status: 'open' }, entry: { days: requestedDays, note: '', revision: 0, submitted: false } };
  }, { now, requestedDays });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/opening-test`);
  await page.getByText('尚未初始化', { exact: true }).waitFor();
  return page;
}

for (const timezone of ['Asia/Taipei', 'UTC']) {
  test(`admin cutoff picker and employee opening use one configure path (${timezone})`, async () => {
    const page = await open(timezone);
    try {
      assert.equal(await page.locator('.month-day:disabled').count(), 31);
      await page.getByRole('button', { name: '立即開放／重新開放', exact: true }).click();
      assert.equal(await page.getByLabel('截止小時').locator('option').count(), 25);
      assert.equal(await page.getByLabel('截止分鐘').locator('option').count(), 61);
      assert.ok(await page.getByRole('button', { name: '確認立即開放', exact: true }).isDisabled());
      await page.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(await page.evaluate(() => window.calls.filter(x => x.action === 'configure').length), 0);
      await page.getByRole('button', { name: '立即開放／重新開放', exact: true }).click();
      await page.getByLabel('截止小時').selectOption('22');
      await page.getByLabel('截止分鐘').selectOption('30');
      assert.ok((await page.getByRole('dialog').innerText()).includes('（今天）'));
      await page.getByRole('button', { name: '確認立即開放', exact: true }).click();
      await page.getByText('開放中', { exact: true }).waitFor();
      assert.equal(await page.getByRole('dialog').count(), 0);
      const call = await page.evaluate(() => window.calls.find(x => x.action === 'configure'));
      assert.equal(call.openAt, now);
      assert.equal(call.closeAt, Date.parse('2026-09-13T14:30:00Z'));
      for (let i = 0; i < 3; i++) {
        await page.getByRole('button', { name: '儲存時間', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('.settings-actions button').disabled);
        assert.equal(await page.getByLabel('開放時間', { exact: true }).inputValue(), '2026-09-13T08:21');
      }
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.waitForFunction(() => !document.querySelector('.month-day').disabled);
      await page.locator('.pre-card textarea').fill('Keep my draft');
      await page.getByRole('button', { name: '立即關閉', exact: true }).click();
      await page.getByText('已關閉', { exact: true }).waitFor();
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.waitForFunction(() => document.querySelector('.month-day').disabled);
      assert.equal(await page.locator('.pre-card textarea').inputValue(), 'Keep my draft');
    } finally { await page.close(); }
  });
}
test('employee may submit incomplete or consecutive-work schedules without content-rule messages', async () => {
  for (const days of [Array(31).fill(''), Array(31).fill('上班'), Array.from({ length: 31 }, (_, i) => i === 17 ? '慰' : i === 23 ? '例' : '上班')]) {
    const page = await open('Asia/Taipei', days);
    try {
      await page.getByRole('button', { name: '立即開放／重新開放', exact: true }).click();
      await page.getByLabel('截止小時').selectOption('22');
      await page.getByLabel('截止分鐘').selectOption('30');
      await page.getByRole('button', { name: '確認立即開放', exact: true }).click();
      await page.getByText('開放中', { exact: true }).waitFor();
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.getByRole('button', { name: '送出預排', exact: true }).click();
      await page.waitForFunction(() => window.state.entry.submitted);
      assert.deepEqual(await page.evaluate(() => window.state.entry.days), days);
      assert.equal(await page.getByText('预排檢查', { exact: false }).count(), 0);
      assert.ok(!(await page.locator('.pre-card').innerText()).includes('預排檢查：'));
      assert.ok(!(await page.locator('.pre-card').innerText()).includes('截止前仍可修改已送出的預排'));
    } finally { await page.close(); }
  }
});

test('tomorrow cutoff is explicit and configure errors leave the picker open', async () => {
  const page = await open();
  try {
    await page.getByRole('button', { name: '立即開放／重新開放', exact: true }).click();
    await page.getByLabel('截止小時').selectOption('07');
    await page.getByLabel('截止分鐘').selectOption('00');
    assert.ok((await page.getByRole('dialog').innerText()).includes('（明天）'));
    await page.evaluate(() => { window.rejectConfigure = true; });
    await page.getByRole('button', { name: '確認立即開放', exact: true }).click();
    await page.getByRole('dialog').getByRole('alert').waitFor();
    assert.equal(await page.evaluate(() => window.state.month), null);
    assert.equal(await page.locator('.month-day:disabled').count(), 31);
  } finally { await page.close(); }
});
