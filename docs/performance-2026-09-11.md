# 微笑Bike 效能量測與低風險優化 — 2026-09-11

尚未部署。正式基準 commit：0abf71e150ee50541debdad55784b7ed0f9e5fb2。

**量測邊界**

- 使用者回報環境：Windows／Chrome 或 Edge；本次使用 Windows Edge、1920×1080 的隔離測試。
- 正式站只做匿名唯讀載入：1440×900 三次 HTTP 均為 200；loadEventEnd 約 1094／698／692ms，中位數 698ms，未觀察到超過 50ms 的 Long Task。這是登入頁，不代表登入後操作。
- 登入後的 14 個情境使用原有 React 元件及服務流程，在測試 Firestore 邊界重現：750 人、22,500 筆月份班表、183 個單日 block。這不是目前正式站資料的即時快照。
- 下列操作時間為同一機器、相同資料、前後各三次中位數，包含 Playwright 操作及等待兩個 animation frame；React 使用 development profiling build。未加入假網路延遲，不能当作正式網路 P95 或實際使用者 INP。
- React 時間是頁面主要元件子樹的 commit actualDuration 累計；不是每個子元件的獨立 self time。render 次數是 Profiler commit 次數。
- assignment 與分組時間來自測試包裝的函式計時；分組包含區域投影、排序比較器、monthSections，不涵蓋全部原生 DOM layout/paint 或所有散落的 filter。
- Firestore 表列為服務呼叫鏈的文件／query 推算與 fixture 邊界計數，不是正式 Firestore 計費量測。Rules 相依讀取、SDK cache、空查詢最低計费、網路重試及 callable 內部交易重試未納入。不能將「呼叫數」直接當作網路 RPC 數或計費 read。
- 曾測到約 9 秒的班別切換，CPU sample 指出約 6.4 秒在 Playwright getTextAlternativeInternal 遍歷頁面；已改用限縮到切換列的 selector，捨棄那批數字並重新量測。未以此測試工具開銷冒充正式站瓶頸。

**最慢前五項（按優化前隔離測試總延遲排序）**

| 操作 | 優化前 ms | 優化後 ms | 說明 |
|---|---:|---:|---|
| 後台正式班表載入 | 936 | 809 | 22,500 筆全月資料及大型表格首次建立仍在；已共用月份配置讀取、改善名冊索引。 |
| 換區 | 517 | 431 | 由刷新全月改成目標員工當月資料與月份配置；其餘列保留。 |
| 班表拖曳排序 | 457 | 246 | 由刷新全月改為僅取得最新月份配置。 |
| 日班／大小夜班切換 | 403 | 419 | 無新查詢；切換表格仍需建立大量儲存格，本輪未見改善。 |
| 派工管理載入 | 269 | 268 | 首次載入仍需 blocks、當日班表、員工；主要避免日後編輯重算，首次耗時近似。 |

**全部操作前後對照**

時間皆為 ms；箭頭為優化前 → 後。個別小差異可能是測試波動，尤其班別切換沒有改善，不宣稱每一項均加速。

| 操作 | 操作總延遲 | assignment | 分組／排序 | React 累計 | React 次數 | 單次最大 React |
|---|---:|---:|---:|---:|---:|---:|
| 派工管理載入 | 269 → 268 | 57.6 → 57.7 | 1.4 → 0.7 | 97 → 95 | 3 → 4 | 92 → 90 |
| 開啟派工修改 | 222 → 197 | 0.0 → 0.0 | 1.0 → 0.0 | 39 → 28 | 2 → 2 | 38 → 28 |
| 輸入派工欄位 | 65 → 54 | 0.0 → 0.0 | 1.1 → 0.0 | 38 → 30 | 1 → 1 | 38 → 30 |
| 儲存本日 | 223 → 172 | 57.2 → 60.7 | 4.1 → 0.6 | 150 → 108 | 3 → 2 | 83 → 82 |
| 套用為新版配置 | 169 → 117 | 60.7 → 57.2 | 2.8 → 0.6 | 101 → 68 | 3 → 2 | 74 → 62 |
| 派工切換日期 | 155 → 123 | 47.0 → 45.8 | 3.7 → 0.6 | 79 → 67 | 4 → 4 | 65 → 64 |
| 派工切換班別 | 81 → 55 | 0.0 → 0.0 | 3.2 → 0.6 | 18 → 11 | 2 → 2 | 18 → 11 |
| 前台派工載入 | 124 → 102 | 57.2 → 59.1 | 0.4 → 1.8 | 81 → 71 | 3 → 3 | 80 → 70 |
| 後台正式班表載入 | 936 → 809 | 0.0 → 0.0 | 2.8 → 2.6 | 393 → 289 | 2 → 2 | 386 → 282 |
| 日班／大小夜班切換 | 403 → 419 | 0.0 → 0.0 | 0.5 → 0.6 | 175 → 191 | 1 → 1 | 175 → 191 |
| 開啟班表單格編輯 | 165 → 116 | 0.0 → 0.0 | 0.0 → 0.0 | 42 → 10 | 6 → 6 | 37 → 6 |
| 班表單格儲存 | 267 → 175 | 0.0 → 0.0 | 0.5 → 0.5 | 94 → 36 | 4 → 3 | 40 → 35 |
| 班表拖曳排序 | 457 → 246 | 0.0 → 0.0 | 1.0 → 0.5 | 192 → 82 | 3 → 3 | 133 → 31 |
| 換區 | 517 → 431 | 0.0 → 0.0 | 0.4 → 0.6 | 251 → 201 | 4 → 3 | 187 → 199 |

**Firestore 讀寫拆解（程式鏈推算，不是帳單）**

令 B 為單日正式 blocks 文件數，S 為當日 scheduleRecords 數、E 為 employees 數、M 為全月 scheduleRecords 數、V 為該日生效配置版本查詢回傳數。以 B=183、S=E=750、M=22500 作示例。以下普通 getDoc 算文件讀取，但不算 collection query；transaction get 個別列入。已有配置 base 且日期在生效範圍的分支才有 V query。

| 操作 | 讀取前 → 後 | collection query 前 → 後 | 寫入 |
|---|---|---|---|
| 派工管理／前台派工首次載入 | B+S+E+3+V → B+S+E+2+V；1686+V → 1685+V | 4 → 4（无 base 時 3） | 0 |
| 開啟／輸入派工編輯欄位 | 0 → 0 | 0 → 0 | 0 |
| 儲存本日 | B+S+E+5+V → 4；1688+V → 4 | 4 → 0 | 原樣：block+audit=2；首次建立 base 另加 1 |
| 套用新版配置 | B+S+E+5+V → 4 | 4 → 0 | 原樣：block+version+audit=3；首次建立 base 另加 1 |
| 切換日期 | 仍完整讀取新日期；月份配置的兩筆重複讀取併為一筆 | 依正式資料／preview 分支約 3～5；未快取日期資料 | 0 |
| 派工／班表切換班別 | 0 → 0 | 0 → 0 | 0 |
| 後台正式班表首次載入 | M+E+2 → M+E+1；23252 → 23251 | 2 → 2 | 0 |
| 開啟班表單格編輯 | 0 → 0 | 0 → 0 | 0 |
| 一般正式單格儲存 | 2+M+E+2 → 3；23254 → 3 | 2 → 0 | 原交易不變：record+audit=2 |
| 拖曳排序完成後刷新（不含 callable） | M+E+2 → 1；23252 → 1 | 2 → 0 | 前端直接寫入 0；callable 仍寫 layout+audit=2 |
| 換區完成後刷新（不含 callable） | M+E+2 → 員工當月資料+1；23252 → 約31 | 2 → 1 | callable 原樣：K 筆實際改碼 record + layout + audit，K+2 |

- callable 排序／換區：已有 layout 時後端原本讀 actor、employee、layout 三個文件；換區有變更區碼時另 query 此員工當月記錄。首次初始化 layout 仍可能讀全月名冊與 employees。本輪未修改這些後端流程，未將 fixture 的 callable 模擬當成正式後端讀寫實測。
- 新增人員的空白格／月份結構變更、移出／重新加入等仍走原有完整刷新，未任意擴大優化。
- profile JSON 的 fixture 不實作新的底層 concurrent-read 合併，因此首次載入／換區仍保守記到兩次 layout；上表少一筆由真實 getMonthLayout 的共用 Promise 單元測試驗證。
- 讀取合併僅限同一 database、同一月份、尚在進行的 request；完成或失敗即移除，不採跨日期／操作的 TTL cache。
- template 已取得 base 時直接傳入 configuredDispatchBlocks，避免再讀一次同份 base。
- 員工當月 query 加上月份上下界，不再取該員工所有歷史月份。已以 Firebase CLI 唯讀確認正式 meimei-breakfast-order 存在 employeeId+date composite index；沒有建立或修改 index。

**根因、修改與不變條件**

1. DispatchManager.save 原本 await load()，重新讀整日三套資料；現在原交易成功後 getDispatchBlock，取得伺服器回傳時間戳及相同月份資格投影，僅替換該 block。失敗會顯示需重新載入的訊息，不偽造成功或繞過衝突檢查。
2. ScheduleManager 一般單格儲存原本全月 load()；現在交易成功後 getScheduleRecord，只替換該筆。仍使用原 updateFormalScheduleCell 的原值衝突檢查及 audit。
3. 拖曳排序只需新的 layout；換區只需該員工月份記錄與 layout。MonthRowManager 只新增 onSaved 的已完成操作資訊，callable 寫入內容未變。
4. 派工區域 display projection 原本在排序 comparator 內反覆做正規化；改成依 blocks/assignedBlocks 建立一次 displayById，areas、visible、pickerPeople 使用 useMemo。前台有效區碼 Set 也只建一次。
5. ScheduleManager 開啟／操作 modal 時原本重新建立全表 JSX；現在 memoized tableBody 在資料／班別／拖曳狀態等必要依賴變更時才重建。profiles 與名冊存在性改用 memoized Map／Set；相同 dragover 位置不重複 setDrop。
6. DispatchManager 新增請求世代保護，舊日期查詢不能覆蓋新日期；沒有新增日期快取。

原有人工派工優先、assignment、班碼 parser、Auth、Firebase project/config、Rules、資料結構和寫入交易內容未修改。沒有採用先顯示成功再補寫的 optimistic UI。

**風險與尚未完成**

- 局部刷新不再順便帶入其他管理員同時修改的無關 block／row；切換日期／重新開頁才會完整重新讀取。目標記錄的交易衝突保護維持原樣。
- 全月首次讀取及班別切換仍有大量 DOM；本輪未採用虛擬列表、分頁或大型拆分。不能承諾所有卡頓已消除。
- 正式登入後的網路 RTT、各操作真實 SDK RPC、帳單 reads/writes、Rules 額外讀取、Firestore cache hit、正式 production React profile 及真人 Windows 操作仍待驗收。不能由本機 fixture 精確推算正式站節省金額或保證相同延遲。
- 索引存在已確認；真正 UI 使用該查詢仍須部署測試版後驗收。沒有修改或部署 Rules、Functions、索引、正式資料或正式前端。

**驗證**

- 回歸：58/58，含查詢共用與失敗重試測試。
- Firestore emulator Rules／交易／單筆讀回／月份 query：10/10；Rules 檔案未變。
- profiling：前後各三次，14 個情境；包含對儲存與拖曳不得重查全量資料的 assertions。
- TypeScript --noEmit 通過；Production build 成功。保留既有 @theme／@tailwind 和大型 bundle 警告，未為縮包做大重構。

**修改檔案**

- app/admin-console.tsx
- app/month-row-manager.tsx
- app/page.tsx
- lib/dispatch-blocks-firestore.ts
- lib/dispatch-configuration.ts
- lib/month-schedule-layout.ts
- lib/schedule-firestore.ts
- tests/front-dispatch-preview.test.mjs
- tests/firestore.rules.test.mjs
- tests/performance-reads.test.mjs（新增）
- tests/performance-profile.mjs（新增；可用 PROFILE_BASELINE=1 對照既有部署 commit）
- 本報告

量測原始檔保存在 output/performance-before-1..3.json、performance-after-1..3.json、performance-comparison.json、performance-production-desktop.json。CPU sampling 記錄 performance-month-cpu.json 僅用於辨識並排除測試工具開銷。
