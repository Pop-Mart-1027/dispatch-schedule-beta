# 正式班表整列管理（本機待驗收）

## 儲存與權限

- `scheduleMonthLayouts/{YYYY-MM}`：`monthKey`、`rows[]`、`sections[]`、`excludedEmployeeIds[]`、`assignmentResetAt[date][employeeId]`、`revision`、`modifiedBy`、`modifiedAt`。
- 每列：`employeeId`、`group`（day/night）、原始 `section`、`areaCode`、`blankDays[]`、選用 `sectionKey`。陣列順序為當月顯示順序，前後台共用 `monthSections()`。
- `sections[]` 保存穩定 `key`、`group`、原始 `section`、`areaCode`、顯示用 `label`；改名只改 label。原有月份首次修改時從既有列建立區域清單，保留原順序，不批次改正式資料。自訂區域 key 使用伺服器產生的操作 ID，不依名稱或陣列位置重算。
- 未設定的月份沿用既有 `sourceOrder / scheduleDisplayOrder`。首次人工異動才由該月正式班表與 employees 建立月份顯示配置，沒有背景遷移。
- `manageScheduleMonthRow` callable 同時驗證 UID、claim、目前 employees 的 admin/active/密碼狀態，並以 revision 擋掉過時操作。
- 用戶端對月份配置只能讀取；包含 admin 在內都不能繞過 callable 直接寫入。
- 整列操作與 `scheduleAuditLogs` 同一 transaction 提交。audit 含員編、正式姓名、原／新列資料及順序、月份、操作者、時間。

## 操作邊界

- 換區沿用同一 transaction 更新月份 section/group/display order，以及該員工本月「原 areaCode」工作班碼的區域 token。夜／小夜／國上／時段保留，休假與其他區碼不動；顯示別名不參與班碼轉換。依本輪確認：原／新區域沒有區碼時只移位置、保留班碼，audit 註明「無區碼移動，班碼未轉換」，不清除人工派工。
- 拖曳從職稱前把手開始，以 employeeId + targetEmployeeId + before/after 指定落點。後端檢查同組同 sectionKey，只移動 rows 陣列中的該列；不寫班碼與派工。revision 防止並行覆蓋，順序 before/after 與 audit 同時儲存。舊 up/down 後端相容能力保留，但不再有 UI 入口。
- 新增區域可填標準區域名稱或無區碼特殊群組名稱。已存在的標準區碼不可重複新增。換入區域一律由後端 sections 解析，禁止指向已刪除的 key 或偽造其 areaCode。
- 刪除只接受沒有任何人員的區域，且必須二次確認；伺服器再次檢查完整 rows，不能因 UI 搜尋篩掉人員而誤刪。新增、改名、刪除均寫 scheduleAuditLogs，只影響指定月份。
- 後台保留空 section 以供加入／換入；一般員工班表繼續只顯示有人員的 section。
- 新增只可選正式 employees 已存在且當月配置未列入的人員。以空白列開始，不批次建立每日 scheduleRecords。
- 移出需二次確認，移除當月列並寫入 excludedEmployeeIds。共用 monthParticipation() 同時供正式班表讀取、派工讀取與原有後端產生派工入口使用。不刪員工、帳號、班碼或 audit，不影響其他月份。
- 已移出的人重新加入時解除月級排除，`blankDays` 使當月先顯示空白且不進派工，保留原始每日記錄。之後管理員填入該日班碼，才透過同一 callable 儲存 scheduleRecords、清除該日 blankDays、寫入完整 before/after audit，該日自然進入既有 assignment。
- 既有格子維持原本編輯／audit service。
- 正式派工讀取也會移除當月 excluded／blankDays 的人員，即使舊 block 是人工保存，也不會使已移出者重新出現。原始 dispatchBlocks 文件仍保留，不刪歷史。
- 使用者另確認：移區同時取消實際轉碼日期該人的舊人工派工。assignmentResetAt 保存伺服器時間；讀取時移除比該時間早的該人配置，保留其他人、車號與工作重點。共用 assignment 在原班码新區域中重新分配；即使新區域所有車輛已人工修改，也可加入該員工而不清除其他人。移區後新做的人工派工仍有最高優先權。
- 重新加入當月會對空白日期建立同樣的重設時間，防止填班碼後喚回之前已取消的舊人工派工。
- 移區 audit 除 before/after 列與排序，另外保存 fromSection、toSection、convertedDates（每個實際改動日期、recordId、班碼與顯示班碼 before/after）、操作者、時間。月級參與狀態前後也入 audit。改班碼、改位置、audit 任一失敗即全部不提交。

## 顯示

- 右上角三個同尺寸入口：新增人員、新增區域、刪除區域。各 section 只有編輯區域名稱；各人員彈窗「班表人員異動」只有換區、移出、儲存與右上角 X。未儲存內容關閉即丟棄。

- B機動標題僅顯示 B區PT，來源與人員順序不變。
- `formatWorkFocus()` 保留所有原始字元，只標記區域前綴供共用 WorkFocus 元件排版。
- 員工端完整展開，後台預設最多三行，超過時才提供展開／收合。
- 派工總表隱藏重複區碼小字，「查看紀錄」固定單行。

## 部署狀態

本輪未部署、未寫正式 Firebase。上線前需更新既有 manageScheduleMonthRow callable 與前端；scheduleMonthLayouts read-only Rules 本輪無變更。既有功能與歷史資料不需遷移。

## 修改檔案

- 畫面：`app/admin-console.tsx`、`app/page.tsx`、`app/month-row-manager.tsx`、`app/work-focus.tsx`、`app/work-focus.css`。
- 共用資料／顯示：`functions/month-schedule-layout.mjs`、`functions/schedule-display.mjs`、`functions/schedule-section-key.mjs`、`lib/month-schedule-layout.ts`、`lib/work-focus.ts`。
- 後端／權限：`functions/month-schedule-service.mjs`、`functions/index.js`、`firestore.rules`。
- 測試：`functions/month-schedule-layout.test.mjs`、`tests/month-schedule.emulator.test.mjs`、`tests/front-dispatch-preview.test.mjs`。
- 說明：本文件；Production build 另外更新 `gh-pages` 產物，但不發布。
