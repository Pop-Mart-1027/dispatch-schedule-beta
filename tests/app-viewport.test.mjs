import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { transformWithEsbuild } from 'vite'

// Local DOM fixtures only: no login, Firebase requests or production mutations.
const directory = process.env.SCHEDULE_PAGES_DIR || 'gh-pages'
const html = readFileSync(path.join(directory, 'index.html'), 'utf8')
const css = readFileSync(path.join(directory, 'assets', path.basename(html.match(/href="([^"]+\.css)"/)[1])), 'utf8')
const { code } = await transformWithEsbuild(readFileSync('lib/app-viewport.ts', 'utf8'), 'app-viewport.ts', { loader: 'ts' })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
after(() => browser.close())
const rows = Array.from({ length: 30 }, (_, i) => `<tr data-employee-id="T${i}"><td>Driver</td><td>T${i}</td><td>Person ${i}</td><td>Day</td></tr>`).join('')

async function open({ width = 390, height = 844, touch = true, view = 'home' } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: touch, isMobile: touch })
  await page.route('**/*', route => route.abort())
  const content = view === 'schedule'
    ? `<div class="tabs"><button class="tab">My schedule</button><button class="tab">Day</button></div><details class="area-jump-dropdown"><summary>Area</summary></details><div class="matrix-wrap"><table class="schedule-matrix"><thead><tr><th>Role</th><th>ID</th><th>Name</th><th>Day</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<div style="height:1800px"><input aria-label="Input"><button id="action">Action</button></div>`
  let body = `<div class="app-shell" data-page="${view}"><aside class="sidebar"><nav style="min-height:1500px">Menu</nav></aside><main class="workspace"><header class="topbar"><button class="menu-button">Menu</button></header><section class="content">${content}</section></main></div>`
  if (view === 'login') body = `<main class="login-page"><section class="login-card" style="min-height:600px"><input aria-label="Input"><button style="margin-top:450px" id="action">Sign in</button></section></main>`
  if (view === 'admin') body = `<div class="admin-console"><aside class="admin-sidebar">Menu</aside><main class="admin-main"><header class="admin-topbar">Header</header><section class="admin-content">${content}</section></main></div>`
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>${css}</style><div id="root">${body}</div>`)
  await page.addScriptTag({ type: 'module', content: `${code}\nwindow.disposeViewport = installAppViewport();` })
  await page.waitForFunction(() => Boolean(window.disposeViewport))
  return page
}

test('phone body is locked while content scrolls and topbar stays fixed', async () => {
  const page = await open()
  try {
    const before = await page.locator('.topbar').boundingBox()
    await page.locator('.content').evaluate(node => { node.scrollTop = 500 })
    await page.evaluate(() => window.scrollTo(0, 500))
    assert.equal(await page.evaluate(() => scrollY), 0)
    assert.equal(await page.locator('.content').evaluate(node => node.scrollTop), 500)
    assert.deepEqual(await page.locator('.topbar').boundingBox(), before)
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).overscrollBehavior), 'none')
    await page.locator('#action').click()
  } finally { await page.close() }
})

for (const [width, height] of [[390, 844], [844, 390]]) {
  test(`schedule ${width}x${height}: independent table scroll, controls stationary`, async () => {
    const page = await open({ width, height, view: 'schedule' })
    try {
      const controls = await page.locator('.tabs').boundingBox()
      const matrix = await page.locator('.matrix-wrap').boundingBox()
      await page.locator('.matrix-wrap').evaluate(node => { node.scrollTop = 200; node.scrollLeft = 200 })
      assert.deepEqual(await page.locator('.tabs').boundingBox(), controls)
      assert.equal(await page.evaluate(() => scrollY), 0)
      assert.ok(await page.locator('.matrix-wrap').evaluate(node => node.scrollTop > 0 && node.scrollLeft > 0))
      assert.ok(matrix.y + matrix.height <= height + 1)
      if (width > height) {
        assert.equal(matrix.y, 40)
        assert.ok(matrix.height >= 340)
      }
    } finally { await page.close() }
  })
}

test('desktop browser retains document scrolling and zoom gestures', async () => {
  const page = await open({ width: 1280, height: 844, touch: false })
  try {
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-app-viewport')), false)
    assert.equal(await page.evaluate(() => {
      const event = new Event('gesturestart', { cancelable: true }); document.dispatchEvent(event); return event.defaultPrevented
    }), false)
    await page.evaluate(() => scrollTo(0, 400))
    assert.ok(await page.evaluate(() => scrollY > 0))
  } finally { await page.close() }
})

test('phone cancels pinch/Safari gestures without cancelling one-finger content movement', async () => {
  const page = await open()
  try {
    const results = await page.evaluate(() => {
      const send = (name, count) => {
        const event = new Event(name, { cancelable: true })
        if (count !== undefined) Object.defineProperty(event, 'touches', { value: Array(count).fill({}) })
        document.dispatchEvent(event); return event.defaultPrevented
      }
      return [send('gesturestart'), send('gesturechange'), send('touchstart', 2), send('touchmove', 2), send('touchmove', 1), getComputedStyle(document.body).touchAction]
    })
    assert.deepEqual(results, [true, true, true, true, false, 'pan-x pan-y'])
  } finally { await page.close() }
})

test('short viewport keeps login input and submit reachable without body scrolling', async () => {
  const page = await open({ view: 'login' })
  try {
    await page.getByLabel('Input').fill('test')
    await page.setViewportSize({ width: 390, height: 320 })
    await page.waitForFunction(() => parseFloat(document.documentElement.style.getPropertyValue('--app-viewport-height')) === 320)
    await page.locator('#action').click()
    assert.ok(await page.locator('.login-page').evaluate(node => node.scrollTop > 0))
    assert.equal(await page.evaluate(() => scrollY), 0)
    assert.equal(await page.getByLabel('Input').evaluate(node => getComputedStyle(node).fontSize), '16px')
  } finally { await page.close() }
})

test('admin remains horizontally reachable and only admin content scrolls vertically', async () => {
  const page = await open({ view: 'admin' })
  try {
    const topbar = await page.locator('.admin-topbar').boundingBox()
    await page.locator('.admin-content').evaluate(node => { node.scrollTop = 300 })
    assert.deepEqual(await page.locator('.admin-topbar').boundingBox(), topbar)
    await page.locator('.admin-console').evaluate(node => { node.scrollLeft = 700 })
    assert.equal(await page.locator('.admin-console').evaluate(node => node.scrollLeft), 700)
    assert.equal(await page.locator('.admin-content').evaluate(node => node.scrollTop), 300)
    assert.equal(await page.evaluate(() => scrollY), 0)
  } finally { await page.close() }
})

test('dialog and sidebar have their own reachable scrolling areas', async () => {
  const page = await open()
  try {
    await page.evaluate(() => {
      document.querySelector('.sidebar').classList.add('open')
      document.querySelector('.sidebar').scrollTop = 100
    })
    assert.ok(await page.locator('.sidebar').evaluate(node => node.scrollTop > 0))
    assert.equal(await page.locator('.content').evaluate(node => getComputedStyle(node).overflow), 'hidden')
    await page.evaluate(() => {
      document.querySelector('.sidebar').classList.remove('open')
      const backdrop = document.createElement('div'); backdrop.className = 'broadcast-modal-backdrop'
      backdrop.innerHTML = '<section class="broadcast-modal"><div style="height:1500px">Content</div><button id="close-modal">Close</button></section>'
      document.body.appendChild(backdrop)
    })
    await page.locator('#close-modal').click()
    assert.ok(await page.locator('.broadcast-modal').evaluate(node => node.scrollTop > 0))
    assert.equal(await page.evaluate(() => scrollY), 0)
  } finally { await page.close() }
})

test('viewport lifecycle restores browser defaults and removes gesture listeners', async () => {
  const page = await open()
  try {
    await page.evaluate(() => window.disposeViewport())
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-app-viewport')), false)
    assert.equal(await page.evaluate(() => {
      const event = new Event('gesturestart', { cancelable: true }); document.dispatchEvent(event); return event.defaultPrevented
    }), false)
  } finally { await page.close() }
})
