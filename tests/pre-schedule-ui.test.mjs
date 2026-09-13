import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { toFormalRecords } from '../functions/pre-schedule-domain.mjs';
import { readFile } from 'node:fs/promises';
import {
  preScheduleRoster,
  preScheduleSource,
  scheduleSections,
} from '../functions/pre-schedule-order.mjs';

// All people and callable responses in this browser test are isolated fixtures.
// External requests are blocked; this test never reads/writes production Firebase.
const days = Array.from(
  { length: 31 },
  (_, i) =>
    ['例', '休', '上班', '上班', '上班', '上班', '上班'][
      new Date(
        `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      ).getUTCDay()
    ],
);
const people = Array.from({ length: 750 }, (_, i) => ({
  employeeId: `P${String(i + 1).padStart(4, '0')}`,
  name: `測試員${i + 1}`,
  title: i >= 500 ? 'PT-夜' : '調度專員',
  group: i >= 500 ? 'night' : 'day',
}));
const entries = people.map((p, i) => ({
  employeeId: p.employeeId,
  employeeName: p.name,
  jobTitle: p.title,
  group: p.group,
  days: i % 3 ? days : Array(31).fill(''),
  submitted: i % 3 === 1,
  submittedAt: null,
  updatedAt: null,
  revision: 0,
  note: '',
}));
const virtual = {
  'pre:test-api': `export * from '/lib/pre-schedule.ts';
    import {publicationSummary} from '/functions/pre-schedule-domain.mjs';
    import {monthlyRoster,monthlyEntry,placeMonthlyPerson} from '/functions/pre-schedule-roster.mjs';
    const catalog={day:['早A1'],night:['夜O4','小夜O1','夜監']};
    export async function preCall(action,monthKey,values={}) {
      window.calls.push({action,monthKey,...values});
      const state=window.state;
      if(action==='context')return {month:state.month,ownerId:state.own.employeeId,entry:state.own};
      if(action==='group'){const people=monthlyRoster(state.people);return {month:state.month,formalCodes:catalog[values.group],roster:people.filter(p=>p.group===values.group),entries:state.entries.map(e=>monthlyEntry(e,people)).filter(p=>p.group===values.group)}};
      if(action==='people')return {people:monthlyRoster(state.people),revision:state.rosterRevision||0};
      if(action==='findPerson')return {person:values.employeeId==='N9001'?{employeeId:'N9001',name:'測試新進員工',title:'調度專員',group:'day'}:null};
      if(action==='savePerson'){
        if(values.rosterRevision!==(state.rosterRevision||0))throw Error('名單版本衝突');
        const old=state.people.find(p=>p.employeeId===values.employeeId);
        const person={...(old||{employeeId:'N9001',name:'測試新進員工',title:'調度專員'}),group:values.group,rosterGroup:values.group,rosterSection:values.section};
        state.people=placeMonthlyPerson(monthlyRoster(state.people),person,values.beforeId);state.rosterRevision=(state.rosterRevision||0)+1;
        return {person,revision:state.rosterRevision};
      }
      if(action==='save') {
        await new Promise(r=>setTimeout(r,window.saveDelay||0));
        if(values.revision!==(state.own?.revision||0))throw Error('revision conflict');
        state.own={...state.own,...values,revision:values.revision+1,submitted:state.own.submitted||!!values.submit};
        return {entry:state.own};
      }
      if(action==='review') {
        const old=state.entries.find(e=>e.employeeId===values.employeeId);
        const entry={...old,...values,revision:values.revision+1};
        state.entries=state.entries.map(e=>e.employeeId===entry.employeeId?entry:e);return {entry};
      }
      if(action==='summary')return {...publicationSummary(monthKey,state.people,state.entries,23250,catalog),fingerprint:'fixture'};
      if(action==='publish')return {jobId:'test-job',next:0,total:1,records:23250};
      if(action==='continue'){state.month.status='published';return {jobId:'test-job',next:1,total:1,records:23250,done:true}};
      throw Error('Unexpected action '+action);
    }`,
  'pre:test-entry': `import React from 'react';import {createRoot} from 'react-dom/client';
    import {EmployeePreSchedule} from '/app/pre-schedule-employee.tsx';
    import {PreScheduleAdmin} from '/app/pre-schedule-admin.tsx';
    import '/app/globals.css';import '/app/matrix.css';import '/app/area-fix.css';import '/app/dispatch.css';
    import '/app/youbike-theme.css';import '/app/mobile-nav.css';import '/app/mobile-layout.css';import '/app/admin-console.css';
    const root=createRoot(document.getElementById('root'));let key=0;
    window.employee=()=>root.render(React.createElement(EmployeePreSchedule,{key:key++,cellStyle:()=>''}));
    window.manager=admin=>root.render(React.createElement('div',{className:'admin-console'},
      React.createElement('aside',{className:'admin-sidebar'}),React.createElement('main',{className:'admin-main'},
        React.createElement('header',{className:'admin-topbar'}),React.createElement('section',{className:'admin-content'},React.createElement(PreScheduleAdmin,{key:key++,admin,onOpenEmployees:admin?()=>{window.employeeManagerOpened=true;window.leave()}:undefined})))));
    window.leave=()=>root.render(React.createElement('p',null,'其他頁面'));
    window.employee();`,
};
const server = await createServer({
  resolve: {alias:{'@':process.cwd()}},
  configFile: false,
  logLevel: 'error',
  esbuild: { jsx: 'automatic' },
  plugins: [
    {
      name: 'monthly-preschedule-fixture',
      enforce: 'pre',
      resolveId(id) {
        if (id in virtual) return '\0' + id + '.tsx';
      },
      load(id) {
        if (id.startsWith('\0pre:')) return virtual[id.slice(1, -4)];
      },
      transform(code, id) {
        if (
          /\/app\/pre-schedule-(admin|employee|people)\.tsx$/.test(
            id.replaceAll('\\', '/'),
          )
        )
          return code.replace(
            "from '../lib/pre-schedule'",
            "from 'pre:test-api'",
          );
      },
      configureServer(s) {
        s.middlewares.use('/pre-test', async (_req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end(
            await s.transformIndexHtml(
              '/pre-test',
              '<div id="root"></div><script type="module" src="/@id/__x00__pre:test-entry.tsx"></script>',
            ),
          );
        });
      },
    },
    react({ fastRefresh: false }),
  ],
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
after(async () => {
  await browser.close();
  await server.close();
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } }),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(
  ({ days, people, entries }) => {
    window.clock = Date.parse('2026-09-10T04:00:00Z');
    const NativeDate = Date;
    window.Date = class extends NativeDate {
      constructor(...args) {
        super(...(args.length ? args : [window.clock]));
      }
      static now() {
        return window.clock;
      }
    };
    window.calls = [];
    window.state = {
      people,
      entries,
      month: {
        monthKey: '2026-10',
        status: 'open',
        openAt: window.clock - 1000,
        closeAt: window.clock + 10000,
        publishJob: null,
      },
      own: { ...entries[0], days },
    };
  },
  { days, people, entries },
);
await page.route('**/*', (r) =>
  new URL(r.request().url()).hostname === '127.0.0.1'
    ? r.continue()
    : r.abort(),
);
await page.goto(
  `http://127.0.0.1:${server.httpServer.address().port}/pre-test`,
);

test('employee keeps existing calendar, one own-context load, autosaves and can edit after submission', async () => {
  await page.waitForFunction(
    () => !document.querySelector('.month-day')?.disabled,
  );
  assert.equal(await page.locator('.month-day').count(), 31);
  assert.deepEqual(
    await page.evaluate(() => window.calls.map((c) => c.action)),
    ['context'],
  );
  await page.getByRole('button', { name: '送出預排', exact: true }).click();
  await page.waitForFunction(() => window.state.own.submitted);
  await page.locator('textarea').fill('送出後更新');
  await page.waitForFunction(() => window.state.own.note === '送出後更新');
  assert.equal(await page.evaluate(() => window.state.own.submitted), true);
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((c) => c.action === 'save').length,
    ),
    2,
  );
});

test('navigation flushes the debounce and drains edits made during an in-flight save', async () => {
  await page.locator('textarea').fill('離開前草稿');
  await page.evaluate(() => window.leave());
  await page.waitForFunction(() => window.state.own.note === '離開前草稿');
  await page.evaluate(() => {
    window.saveDelay = 600;
    window.employee();
  });
  await page.waitForSelector('textarea:not(:disabled)');
  await page.locator('textarea').fill('儲存進行中');
  await page.waitForFunction(() =>
    window.calls.some((c) => c.note === '儲存進行中'),
  );
  await page.locator('textarea').fill('最新草稿不可遺失');
  await page.evaluate(() => window.leave());
  await page.waitForFunction(
    () => window.state.own.note === '最新草稿不可遺失',
  );
  assert.deepEqual(errors, []);
});

test('employee automatically becomes read-only exactly at cutoff', async () => {
  await page.evaluate(() => {
    window.saveDelay = 0;
    window.employee();
  });
  await page.waitForSelector('textarea:not(:disabled)');
  await page.evaluate(() => {
    window.clock = window.state.month.closeAt;
  });
  await page.waitForSelector('textarea:disabled');
  assert.equal(await page.locator('.month-day:disabled').count(), 31);
  assert.equal(
    await page
      .getByRole('button', { name: '送出預排', exact: true })
      .isDisabled(),
    true,
  );
});

test('750-person desktop management uses two monthly matrices, shared sorting and filters', async () => {
  await page.evaluate(() => window.manager(false));
  await page.waitForFunction(
    () => document.querySelectorAll('.pre-month-table tbody tr').length === 500,
  );
  assert.equal(
    await page
      .getByRole('button', { name: '轉為正式班表', exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page.getByRole('button', { name: '小夜班組', exact: true }).count(),
    0,
  );
  assert.equal(
    await page.locator('.pre-month-table thead th').nth(3).textContent(),
    '1（四）',
  );
  await page.getByRole('tab', { name: '大小夜班', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.pre-month-table tbody tr').length === 250,
  );
  assert.ok(
    (
      await page.locator('.pre-month-table tbody tr').first().textContent()
    ).includes('P0501'),
  );
  await page.getByLabel('搜尋預排員工').fill('P0501');
  assert.equal(await page.locator('.pre-month-table tbody tr').count(), 1);
  await page.getByLabel('搜尋預排員工').fill('');
  await page.getByLabel('預排狀態').selectOption('incomplete');
  assert.equal(await page.locator('.pre-month-table tbody tr').count(), 83);
  await page.getByLabel('預排狀態').selectOption('all');
  const geometry = await page.locator('.pre-month-scroll').evaluate((el) => {
    const before = el.querySelector('thead th').getBoundingClientRect();
    el.scrollTop = 500;
    el.scrollLeft = 400;
    return {
      viewport: el.getBoundingClientRect().bottom,
      height: el.clientHeight,
      overflow: el.scrollWidth > el.clientWidth,
      beforeX: before.x,
    };
  });
  console.log('1920×1080 monthly matrix', geometry);
  await page.screenshot({ path: 'output/pre-schedule-matrix-1920-test.png' });
  assert.ok(geometry.viewport <= 1080);
  assert.ok(geometry.overflow);
  assert.equal(
    await page
      .locator('.pre-month-table thead th')
      .first()
      .evaluate((el) => getComputedStyle(el).position),
    'sticky',
  );
});

test('monitor edits the selected monthly entry only; formal publication is admin-only', async () => {
  await page.getByLabel('搜尋預排員工').fill('P0501');
  await page.getByRole('button', { name: 'P0501 1日', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '整理預排' });
  await dialog.getByLabel('整理後正式班碼').fill('慰');
  await dialog.getByRole('button', { name: '儲存並留下修改紀錄' }).click();
  await page.waitForFunction(
    () =>
      window.state.entries.find((e) => e.employeeId === 'P0501')
        .arrangedDays[0] === '慰',
  );
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((c) => c.action === 'publish').length,
    ),
    0,
  );
  assert.equal(
    await page.evaluate(
      () => window.state.entries.find((e) => e.employeeId === 'P0501').days[0],
    ),
    '上班',
  );
});

test('admin cannot publish one remaining 上班; summary filters its exact cell and reviewer assigns 夜O4', async () => {
  await page.evaluate((days) => {
    window.state.entries = window.state.entries.map((e) => ({
      ...e,
      days,
      submitted: true,
      arrangedDays: days.map((code, index) =>
        code === '上班'
          ? e.employeeId === 'P0501' && index === 0
            ? null
            : e.group === 'night'
              ? '夜O4'
              : '早A1'
          : null,
      ),
    }));
    window.manager(true);
  }, days);
  await page.getByRole('button', { name: '轉為正式班表', exact: true }).click();
  const summary = page.getByRole('dialog', { name: '發布摘要' });
  await summary.waitFor();
  assert.ok((await summary.textContent()).includes('此月份已有正式班表'));
  assert.ok(
    (await summary.textContent()).includes(
      '尚有 1 個出勤班次未完成班別／區域安排',
    ),
  );
  assert.equal(
    await summary
      .getByRole('button', { name: '確認轉為正式班表' })
      .isDisabled(),
    true,
  );
  await summary.getByRole('checkbox').check();
  assert.equal(
    await summary
      .getByRole('button', { name: '確認轉為正式班表' })
      .isDisabled(),
    true,
  );
  await summary.getByRole('button', { name: '查看未安排格子' }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.pre-month-table tbody tr').length === 1,
  );
  assert.equal(await page.getByLabel('預排狀態').inputValue(), 'unarranged');
  assert.equal(await page.locator('td.pre-unarranged').count(), 1);
  assert.ok(
    (await page.locator('.pre-month-table tbody tr').textContent()).includes(
      'P0501',
    ),
  );
  await page.getByRole('button', { name: 'P0501 1日', exact: true }).click();
  await page.getByLabel('整理後正式班碼').fill('夜O4');
  await page.getByRole('button', { name: '儲存並留下修改紀錄' }).click();
  await page.waitForFunction(
    () =>
      window.state.entries.find((e) => e.employeeId === 'P0501')
        .arrangedDays[0] === '夜O4',
  );
  assert.equal(
    await page.evaluate(
      () => window.state.entries.find((e) => e.employeeId === 'P0501').days[0],
    ),
    '上班',
  );
  await page.getByRole('button', { name: '轉為正式班表', exact: true }).click();
  await summary.waitFor();
  assert.ok(!(await summary.textContent()).includes('尚有 1 個出勤班次'));
  await summary.getByRole('checkbox').check();
  await summary.getByRole('button', { name: '確認轉為正式班表' }).click();
  await page.waitForFunction(() => window.state.month.status === 'published');
  assert.equal(
    await page.evaluate(
      () => window.calls.find((c) => c.action === 'publish').overwriteMonth,
    ),
    '2026-10',
  );
  assert.deepEqual(errors, []);
});

test('reviewed 夜O4 is published and feeds the unchanged dispatch helper into O4 station', async () => {
  const { assignSchedulesToDispatchBlocks } = await server.ssrLoadModule(
    '/lib/dispatch-schedule-assignment.ts',
  );
  const p = {
    employeeId: 'fixture-only',
    name: '測試',
    title: 'PT-夜',
    group: 'night',
  };
  const records = toFormalRecords(
    '2026-10',
    [p],
    [
      {
        employeeId: p.employeeId,
        days,
        arrangedDays: days.map((v) => (v === '上班' ? '夜O4' : null)),
        note: '',
      },
    ],
    'fixture-admin',
    { day: ['早A1'], night: ['夜O4'] },
  );
  const result = assignSchedulesToDispatchBlocks({
    blocks: [
      {
        id: 'test',
        blockId: 'test',
        date: '2026-10-01',
        shiftType: 'night',
        areaCode: 'O4',
        areaName: 'O4',
        variantCode: 'standard',
        vehicleNo: 'TEST-1',
        vehicleType: '',
        drivers: [],
        stations: [],
        assistants: [],
        workFocus: '',
        balanceArea: '',
        note: '',
        sourceSheet: 'fixture',
        sourceRow: 1,
        status: 'active',
        modifiedBy: '',
      },
    ],
    schedules: records.filter((r) => r.date === '2026-10-01'),
    employees: [p],
    shift: 'night',
  });
  assert.equal(records[0].scheduleCode, '夜O4');
  assert.equal(result.blocks[0].stations[0].employeeId, p.employeeId);
  assert.equal(result.unmatched.length, 0);
});

test('September matrix exposes day/night tabs, leadership heading and exact O1 team order, preserving entries on switching', async () => {
  const master = JSON.parse(
    await readFile(
      new URL('../output/employee-master.json', import.meta.url),
      'utf8',
    ),
  );
  const ordered = preScheduleRoster(master);
  await page.evaluate(
    ({ people, days }) => {
      window.state.people = people.slice().reverse();
      window.state.entries = people.map((p) => ({
        employeeId: p.employeeId,
        employeeName: p.name,
        jobTitle: p.title,
        group: p.group,
        days,
        submitted: true,
        revision: 7,
        note: '保留預排',
      }));
      window.state.month.status = 'reviewing';
      window.calls = [];
      window.manager(false);
    },
    { people: ordered, days },
  );
  const personRows = page.locator('.pre-month-table tr[data-employee-id]');
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.pre-month-table tr[data-employee-id]')
        .length === 592,
  );
  await page
    .getByRole('tab', { name: '日班', exact: true })
    .waitFor({ state: 'visible' });
  assert.equal(
    await page
      .getByRole('tablist', { name: '預排組別' })
      .getByRole('tab')
      .count(),
    2,
  );
  assert.deepEqual(
    await personRows.evaluateAll((rows) =>
      rows.slice(0, 3).map((r) => r.getAttribute('data-employee-id')),
    ),
    ['93900', '93339', '95011'],
  );
  assert.equal(
    await page.locator('.pre-source-heading').first().textContent(),
    '單位主官',
  );
  assert.deepEqual(await personRows.evaluateAll(rows => rows.map(row => row.dataset.employeeId)),
    scheduleSections(master, 'day').flatMap(section => section.people.map(person => person.employeeId)));
  const headings=await page.locator('.pre-source-heading').allTextContents();
  assert.equal(headings.filter(label=>label==='W1區').length,1);
  assert.ok(headings.includes('W3區') && headings.includes('I2區'));
  assert.deepEqual(headings,scheduleSections(master,'day').map(section=>section.label));
  assert.ok(headings.includes('工兵小隊') && headings.includes('府前PT'));
  assert.ok(!headings.some(label=>/晚PT數字|BBK-0278|J2區/.test(label)));
  const dayAreas = await page.locator('.pre-source-heading[data-area-code]').evaluateAll(rows => rows.map(row => row.dataset.areaCode));
  assert.equal(dayAreas.length, new Set(dayAreas).size);
  assert.equal(dayAreas.filter(code => code === 'O1').length, 1);
  await page.getByRole('tab', { name: '大小夜班', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.pre-month-table tr[data-employee-id]')
        .length === 158,
  );
  const ids = await personRows.evaluateAll((rows) =>
    rows.map((r) => r.getAttribute('data-employee-id')),
  );
  assert.deepEqual(ids, scheduleSections(master, 'night').flatMap(section => section.people.map(person => person.employeeId)));
  const nightAreas = await page.locator('.pre-source-heading[data-area-code]').evaluateAll(rows => rows.map(row => row.dataset.areaCode));
  assert.equal(nightAreas.length, new Set(nightAreas).size);
  assert.equal(ids.indexOf('96504') + 1, 127);
  assert.deepEqual(ids.slice(126, 131), [
    '96504',
    'B3175',
    'B5784',
    'B0410',
    'B5167',
  ]);
  assert.ok(ids.every((id) => preScheduleSource(id).sourceSheet === '9月夜班'));
  const sourceHeading = await page
    .locator('tr[data-employee-id="96504"]')
    .evaluate((el) => el.previousElementSibling.textContent);
  assert.equal(sourceHeading, 'O1區');
  await page.getByLabel('搜尋預排員工').fill('96504');
  assert.equal(await personRows.count(), 1);
  await page.getByRole('tab', { name: '日班', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.pre-month-table tr[data-employee-id]')
        .length === 592,
  );
  assert.equal(await page.getByLabel('搜尋預排員工').inputValue(), '');
  assert.equal(
    await page.evaluate(
      () =>
        window.calls.filter((c) => !['group', 'context'].includes(c.action))
          .length,
    ),
    0,
  );
  assert.ok(
    await page.evaluate(() =>
      window.state.entries.every(
        (e) => e.submitted && e.revision === 7 && e.note === '保留預排',
      ),
    ),
  );
});

test('personnel-first layout keeps the matrix visible and settings accessible', async () => {
  await page.evaluate(() => window.manager(true));
  await page.waitForFunction(() => document.querySelectorAll('.pre-month-table tr[data-employee-id]').length > 100);
  await mkdir('E:/Codex/BACKUP_pre_schedule_layout_20260913/previews', { recursive: true });
  for (const [width, height] of [[1920, 1080], [1600, 900], [1500, 768]]) {
    await page.setViewportSize({ width, height });
    await page.locator('.pre-month-scroll').evaluate(el => { el.scrollTop = 0; el.scrollLeft = 0; });
    const layout = await page.evaluate(() => {
      const box = document.querySelector('.pre-month-scroll').getBoundingClientRect();
      const rows = [...document.querySelectorAll('.pre-month-table tr[data-employee-id]')];
      const visible = rows.filter(row => {
        const r = row.getBoundingClientRect();
        return r.top >= box.top && r.bottom <= box.bottom;
      }).length;
      return { top: box.top, bottom: box.bottom, height: box.height, visible };
    });
    console.log('personnel-first layout', { width, height, ...layout });
    assert.ok(layout.top < 330, 'controls must not consume most of the page');
    assert.ok(layout.bottom <= height, 'matrix stays inside the viewport');
    assert.ok(layout.height > height * 0.55, 'most viewport height belongs to the staff matrix');
    assert.ok(layout.visible >= 8, 'at least eight complete personnel rows remain visible');
    await page.screenshot({ path: `E:/Codex/BACKUP_pre_schedule_layout_20260913/previews/admin-${width}.png` });
  }
  const before = await page.locator('.pre-month-scroll').boundingBox();
  await page.locator('.pre-month-settings summary').click();
  assert.ok(await page.getByLabel('開放時間（台北）', { exact: true }).isVisible());
  assert.ok(await page.getByLabel('截止時間（台北）', { exact: true }).isVisible());
  const after = await page.locator('.pre-month-scroll').boundingBox();
  assert.equal(after.height, before.height, 'opening settings does not squeeze staff rows');
  await page.locator('.pre-month-settings summary').click();
  await page.getByLabel('搜尋預排員工').fill('93900');
  assert.ok(await page.locator('.pre-month-table tr[data-employee-id="93900"]').count() === 1);
  await page.getByLabel('搜尋預排員工').fill('');
  assert.equal(await page.evaluate(() => window.calls.filter(c => !['group', 'context'].includes(c.action)).length), 0);
});

test('edit dialog has visible save/cancel/close and keyword input only saves real codes', async () => {
  await page.getByRole('tab', { name: '大小夜班', exact: true }).click();
  await page.waitForSelector('tr[data-employee-id="96504"]');
  const before = await page.evaluate(() => window.calls.filter(c => c.action === 'review').length);
  await page.getByRole('button', { name: '96504 1日', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '整理預排', exact: true });
  await dialog.getByLabel('整理後正式班碼').fill('O');
  assert.ok(await dialog.getByRole('button', { name: '儲存並留下修改紀錄' }).isDisabled());
  assert.ok((await dialog.locator('datalist option').evaluateAll(options => options.map(o => o.value))).includes('夜O4'));
  await dialog.getByLabel('整理後正式班碼').fill('夜O4');
  assert.equal(await dialog.getByRole('button', { name: '儲存並留下修改紀錄' }).isDisabled(), false);
  for (const [width,height] of [[1500,768],[844,390],[390,844]]) {
    await page.setViewportSize({width,height});
    for (const name of ['儲存並留下修改紀錄','取消','關閉整理預排']) {
      const rect=await dialog.getByRole('button',{name,exact:true}).boundingBox();
      assert.ok(rect && rect.x>=0 && rect.y>=0 && rect.x+rect.width<=width && rect.y+rect.height<=height, `${name} stays on-screen at ${width}`);
    }
  }
  await dialog.getByRole('button',{name:'關閉整理預排'}).click();
  assert.equal(await dialog.count(),0);
  assert.equal(await page.evaluate(() => window.calls.filter(c => c.action === 'review').length),before);
  await page.setViewportSize({width:1500,height:768});
  assert.ok(!(await page.locator('.pre-month-table').textContent()).includes('異常'));
  assert.ok(!(await page.locator('.pre-month-stats').textContent()).includes('異常'));
  assert.equal(await page.getByLabel('預排狀態').locator('option[value="abnormal"]').count(),0);
});

test('missing ID opens employee management without saving a fake employee', async () => {
  const saves=await page.evaluate(()=>window.calls.filter(c=>c.action==='savePerson').length);
  await page.getByRole('button',{name:'加入人員',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'加入人員',exact:true});
  await dialog.getByLabel('加入員工編號').fill('UNKNOWN');
  await dialog.getByRole('button',{name:'查詢員工'}).click();
  await page.waitForSelector('.pre-person-navigation');
  assert.ok((await dialog.textContent()).includes('查無資料，請先新增員工編號。'));
  assert.ok(await dialog.getByRole('button',{name:'確認加入'}).isDisabled());
  await dialog.getByRole('button',{name:'前往員工管理'}).click();
  assert.equal(await page.evaluate(()=>window.employeeManagerOpened),true);
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.action==='savePerson').length),saves);
});

test('admin adds numbered employee and edits monthly group, section and persisted position', async () => {
  await page.evaluate(()=>window.manager(true));
  await page.waitForSelector('tr[data-employee-id="93900"]');
  await page.getByRole('button',{name:'加入人員',exact:true}).click();
  let dialog=page.getByRole('dialog',{name:'加入人員',exact:true});
  await dialog.getByLabel('加入員工編號').fill('N9001');
  await dialog.getByRole('button',{name:'查詢員工'}).click();
  await dialog.getByLabel('人員當月區域').fill('O1區');
  await dialog.getByRole('button',{name:'確認加入'}).click();
  await page.waitForSelector('tr[data-employee-id="N9001"]');
  assert.equal(await page.locator('tr[data-employee-id="N9001"]').count(),1);
  await page.getByRole('button',{name:'編輯資料／移動位置 N9001'}).click();
  dialog=page.getByRole('dialog',{name:'編輯資料／移動位置',exact:true});
  await dialog.getByLabel('人員當月班別').selectOption('night');
  await dialog.getByLabel('人員當月區域').fill('O1區');
  await dialog.getByLabel('人員移動位置').selectOption('96504');
  await dialog.getByRole('button',{name:'儲存人員設定'}).click();
  await page.waitForSelector('[role="tab"][aria-selected="true"]');
  await page.waitForFunction(()=>document.querySelector('[role="tab"][aria-selected="true"]')?.textContent==='大小夜班' && document.querySelector('tr[data-employee-id="N9001"]'));
  const ids=await page.locator('tr[data-employee-id]').evaluateAll(rows=>rows.map(r=>r.dataset.employeeId));
  assert.equal(ids.indexOf('96504'),ids.indexOf('N9001')+1);
  await page.getByRole('button',{name:'重新載入',exact:true}).click();
  await page.waitForSelector('tr[data-employee-id="N9001"]');
  assert.equal(await page.locator('tr[data-employee-id="N9001"]').count(),1);
  const saved=await page.evaluate(()=>window.state.people.find(p=>p.employeeId==='N9001'));
  assert.equal(saved.group,'night');assert.equal(saved.rosterSection,'O1區');
  assert.deepEqual(errors,[]);
});

test('monitor cannot add/move staff and open period remains read-only',async()=>{
  await page.evaluate(()=>window.manager(false));
  await page.waitForSelector('tr[data-employee-id="93900"]');
  assert.equal(await page.getByRole('button',{name:'加入人員',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'編輯資料／移動位置 93900'}).count(),0);
  await page.evaluate(()=>{window.state.month.status='open';window.state.month.closeAt=window.clock+60000;window.manager(true)});
  await page.waitForSelector('tr[data-employee-id="93900"]');
  assert.ok(await page.getByRole('button',{name:'加入人員',exact:true}).isDisabled());
  assert.ok(await page.getByRole('button',{name:'編輯資料／移動位置 93900'}).isDisabled());
  assert.ok(await page.getByRole('button',{name:'93900 1日',exact:true}).isDisabled());
});
