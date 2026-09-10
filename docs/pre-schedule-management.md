# 整月預排管理（本機實作，尚未部署）

## 資料與入口

- 員工沿用「預排班」月曆；監控／管理員後台新增「預排管理」。
- `preScheduleMonths/{YYYY-MM}`：monthKey、status、openAt、closeAt、createdAt、updatedAt、publishedAt、publishedBy，另含 publishJob／publishProgress。
- `entries/{employeeId}`：employeeId、employeeName、jobTitle、group、days（員工原始預排需求）、arrangedDays（監控整理結果）、submitted、submittedAt、updatedAt、note、revision；監控修改另記 modifiedBy／modifiedAt。
- `auditLogs/{id}`：監控修改的 employeeId、modifiedBy、modifiedAt、before、after。
- `internal/roster`：開放當月時的應預排名單與分組快照，前端無法直接存取。
- `internal/{publishJob}/chunks/{index}`：後端發布清單、舊資料版本與重試進度；前端不能讀寫。
- 發布結果進入既有 `scheduleRecords`，每筆另寫 `scheduleAuditLogs`。不寫派工、不改員工主檔或 Auth。

## 分組與期限

優先使用既有正式班表 `shiftType`；沒有正式班別時才採員工已明確提供的 shiftType／shiftGroup。只轉成 day／night；小夜屬 night。無法確認的員工不猜分組，阻止開放並提示確認資料。

管理員第一次開放月份時建立應預排名單快照。設定期間沿用 `scheduleSettings/{month}` 的 startAt／endAt／status；新介面也更新同一設定，日期未寫死在元件。

員工自己的 entry 採延遲自動儲存、revision 衝突保護，內部切頁會送出尚未儲存草稿。截止前已送出者仍可修改；submittedAt 保留首次送出時間。截止由後端時間強制驗證，不依賴瀏覽器時鐘。

`closePreScheduleMonths` 每五分鐘更新到期月份為 reviewing；讀取月份時也會同步到期狀態。即使排程尚未更新 status，員工在 closeAt 起已不能寫入。此排程只處理預排狀態，與 Google 派工同步無關。

## 權限

所有變更走 `preSchedule` callable，驗證 UID、employeeId claim、正式員工 active／mustChangePassword、claim 與主檔權限一致。

- 員工只能取得／儲存自己一個月份 entry；不可批次讀取別人。
- 監控可按月份＋day／night 載入整組；截止後整理 entries 並同步寫 audit，不允許代替員工標記送出。
- 管理員可設定／鎖定月份及發布正式班表。
- Firestore Rules 禁止所有 client 直接寫入預排文件、audit、發布內部資料，避免繞過驗證或漏記 audit。新讀取規則也檢查 UID 與 employeeId claim 一致。

## 發布與中斷處理

先取得月份、人數、未送出、未完成、異常與既有正式資料摘要；管理員確認後才發布。已有正式資料時顯示「此月份已有正式班表」，要求再次確認對應月份。未完成／識別不一致阻止發布；已填完整但未送出或違反既有週檢查的內容，需管理員確認警告。

摘要使用文件完整 updateTime 指紋，期間有人更動需重新確認。正式員工姓名／職稱／啟用狀態與月份快照不一致也阻止發布，不自行改名。

發布準備文件依筆數與位元組大小拆分，每批正式寫入最多 100 筆，並在同一 transaction 寫對應 audit 與進度。既有員編＋日期文件保留原 doc id 與 createdAt；不刪除名單外的既有資料。

整月不是單一原子交易：發布期間正式集合可能已有部分新資料，因此須讓作業完成後再使用新月班表。中斷後管理員可按「繼續發布」；已完成批次不重複寫 audit。尚未寫入正式資料的準備作業可以取消；已寫入者不可直接取消。若正式文件被別人修改，停止該批，不靜默覆蓋。

## 已確認的班碼整理流程

員工選項仍為 `上班、休、休上、例、慰、病、事、特`，員工不填區碼。監控在截止後透過整月矩陣將「上班」改成如「夜O4」的正式班碼。原始 `days` 不被覆寫；`arrangedDays` 中 null 表示沿用原需求，空字串表示未完成，正式班碼或假別表示監控明確整理結果。

監控可選班碼讀自所選月份及最近前一個正式月份的 `scheduleRecords`，依既有 shiftType 分為早／夜組，不使用 JSON fallback，也不新增區碼 mapping。後端短暫快取選項；發布摘要及實際發布重新讀取驗證。未在既有正式班碼選項中的值拒絕儲存。休／例／假別等原有選項不需要區碼。

矩陣與摘要顯示「尚有 XX 個出勤班次未完成班別／區域安排」，可點擊篩選並標示未完成格子。只要有效內容仍有「上班」，即使管理員確認其他警告也不能發布。發布使用 `arrangedDays` 優先的有效內容，例如 `夜O4`，而非原始 `上班`；不改既有 assignment。已整理出勤碼在原有週檢查中視為出勤，不會因「上班」字樣已轉為區碼而誤報沒有上班。

若月份重新開放、員工修改某一天需求，只清除該天先前整理結果，其他已整理天數保留；員工無權提交 arrangedDays。監控仍不可直接寫 scheduleRecords 或發布。舊版未完成發布計畫禁止直接續傳，避免帶入未安排的「上班」。

## 本機驗證

```powershell
npx tsc --noEmit
npm --prefix functions test
node --test tests/pre-schedule-ui.test.mjs tests/admin-backend.test.mjs tests/front-dispatch-preview.test.mjs
firebase emulators:exec --only firestore --project demo-pre-month "node --test tests/pre-schedule.emulator.test.mjs tests/firestore.rules.test.mjs"
$env:GITHUB_ACTIONS='true'
npm run build:pages
```

UI 測試使用隔離的 750 人 fixture 並封鎖外部網路；Rules／服務測試強制使用 demo emulator，沒有正式 Firebase 寫入。750 人完整發布容量以 23,250 筆純資料測試驗證，真實 transaction／重試以 emulator 小型名單驗證，未宣稱生產環境壓測完成。

目前不部署。之後取得授權才部署新增 callable、預排截止排程、Rules 與前端；勿重新啟用 Google 自動排程。
