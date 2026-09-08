const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const url = process.env.TEST_URL || 'http://127.0.0.1:4174/'
  const employeeId = 'B5456'
  const newPassword = `Ui!${crypto.randomBytes(18).toString('base64url')}`
  const errors = []
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  await page.getByLabel('員工編號', { exact: true }).fill(employeeId)
  await page.getByLabel('密碼', { exact: true }).fill(employeeId)
  await page.getByRole('button', { name: /登入工作台/ }).click()
  await page.getByRole('heading', { name: '請先設定新密碼' }).waitFor()
  await page.getByLabel('新密碼', { exact: true }).fill(newPassword)
  await page.getByLabel('再次輸入新密碼', { exact: true }).fill(newPassword)
  await page.getByRole('button', { name: '更新密碼並重新登入' }).click()
  await page.getByRole('button', { name: /登入工作台/ }).waitFor()

  await page.getByLabel('員工編號', { exact: true }).fill(employeeId)
  await page.getByLabel('密碼', { exact: true }).fill(newPassword)
  await page.getByRole('button', { name: /登入工作台/ }).click()
  await page.getByRole('heading', { name: '工作總覽' }).waitFor()
  await page.reload()
  await page.getByRole('heading', { name: '工作總覽' }).waitFor()
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile page overflow')

  const secondContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const secondPage = await secondContext.newPage()
  await secondPage.goto(url)
  await secondPage.getByLabel('員工編號', { exact: true }).fill(employeeId)
  await secondPage.getByLabel('密碼', { exact: true }).fill(newPassword)
  await secondPage.getByRole('button', { name: /登入工作台/ }).click()
  await secondPage.getByRole('heading', { name: '工作總覽' }).waitFor()
  for (const name of ['公告', '我的班表', '派工單', '預排班', '假勤／特休', '個人資料']) {
    const navigation = secondPage.locator('nav').getByRole('button', { name, exact: true })
    await navigation.click()
    await secondPage.getByRole('heading', { name, exact: true }).first().waitFor()
  }
  await secondPage.getByRole('button', { name: '登出' }).click()
  await secondPage.getByRole('button', { name: /登入工作台/ }).waitFor()
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ui: 'PASS', firstLoginChange: true, refreshPersistence: true, secondBrowserContext: true, mobileAndDesktop: true, existingPages: 6, pageErrors: 0 }))
  await browser.close()
})().catch(error => { console.error(error); process.exit(1) })
