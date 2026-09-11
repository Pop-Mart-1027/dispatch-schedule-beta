# 手機前台派工第二輪效能優化（未部署）

## 量測範圍與可信度

對照正式版本 commit 096f8704efb1da559742418293d8fdbc812a7535 與本機修改。使用 Windows Edge headless、390×844 viewport、相同 React/Vite 測試環境，前後各跑 3 次取中位數。使用現有 9 月班表快照、750 人員主檔與 183 個 block 的隔離 fixture，測試員工 B0410；未讀寫正式派工資料。沒有修改 assignment、後台、Rules、Firebase config 或資料結構。

這是正式元件與前台入口鏈路的隔離重現，不是已登入正式站的手機硬體／行動網路 profiling。Auth 與 Firestore 邊界使用 stub；Firebase 後端、下載、冷快取與真實 RTT 尚未量測。React 使用測試開發環境，不應把以下毫秒當成正式手機 SLA。

「本人可見」以姓名 bounding rect 完整進入 viewport 為準，不只是 DOM 有元素；包含原版自動 smooth scroll 所需等待。「完整清單」獨立記錄卡片資料與 render 就緒，不等待捲動動畫結束。完整指目前班別卡片，另一班別仍依既有切換方式查看。各段 CPU 與 React 數值有重疊，不可相加。

## 前後比較

| 指標 | 原版 | 本機新版 |
|---|---:|---:|
| 模擬 Auth 完成至首頁就緒 | 67.6ms | 50.6ms |
| 點派工單至本人姓名進入手機 viewport | 1495.8ms | 102.2ms |
| 完整派工清單 render 就緒 | 175.4ms | 395.3ms |
| 同日返回至本人可見 | 180.1ms | 75.7ms |
| 登入首頁＋首次派工文件回傳模型 | 24969 | 1501 |
| 登入首頁＋首次派工讀取呼叫模型 | 12 | 25 |
| 返回派工讀取呼叫模型 | 6 | 0 |
| React commits（完整流程） | 10 | 11 |
| React actualDuration 合計 | 138.5ms | 106.7ms |
| 最大單次 React actualDuration | 74.5ms | 56.2ms |

完整頁面稍晚完成，因為先只 render 本人卡片，再延後約 100ms 補齊其餘卡片。Commit 次數沒有下降；此次收益是本人先可見、降低單次渲染負擔與省去無關讀取。補卡時使用同一幀定位，避免本人被新增在上方的卡片推出畫面；上一筆／下一筆保持原定位流程。

## 本次觀察到的前 5 個主要等待／計算段

這是隔離環境可觀察項目的排序；正式網路段沒有數值，不能宣稱是正式站最慢前五名。

| 段落 | 原版 | 新版 | 說明 |
|---|---:|---:|---|
| 完整清單後捲至本人所需額外等待 | 約 1320.4ms | 第一屏已可見，無須先等待整張清單 | 原版目標區域較後面，包含 smooth scroll 時間 |
| React 元件 render 合計 | 138.5ms | 106.7ms | 首屏縮成自己的卡片；CPU 包含 assignment 等嵌套工作 |
| 日／夜 assignment 計算 | 49.9ms | 51.7ms | 核心演算法不變，不把量測波動稱為改善 |
| 登入首頁無關的整月資料轉換 | 13.1ms | 0.0ms | 手機改成進入班表時才啟動原有載入 |
| 區域 projection／grouping／sorting | 1.1ms | 1.6ms | 本身不是主要瓶頸，排序規則不變 |

## 每一段載入鏈路

新版本第二次代表樣本（相對點派工單時間；不是網路延遲）：

| 時點 | 毫秒 | 文件／限制 |
|---|---:|---|
| login-profile-ready | -46.0 | getMyProfile 為 stub，未量測正式 callable／Auth 耗時 |
| enter | 29.4 | 本機 performance mark |
| blocks-ready | 32.5 | 183 blocks＋layout／configuration 模型 |
| schedules-ready | 32.8 | 750 筆當日班表 |
| profiles-ready | 37.7 | 534 個員工文件、18 個並行 in 查詢 |
| assignment-start | 38.6 | 本機 performance mark |
| assignment-end | 90.8 | 本機 performance mark |
| group-sort-start | 104.1 | 本機 performance mark |
| group-sort-end | 105.0 | 本機 performance mark |
| personal-painted | 107.3 | 本機 performance mark |
| located | 371.4 | 本機 performance mark |
| full-painted | 392.4 | 本機 performance mark |

personal-painted/full-painted 是 requestAnimationFrame 的 render 邊界標記，不能當作 compositor 實際 paint 完成時間。上表負值是登入 profile 比進派工頁更早完成。Firestore 真正耗時、計費 reads、Rules 額外讀取、快取命中、query RPC 次數以及 configuration versions 實際回傳量，皆須真機連線再量測；25 次是 fixture 邊界呼叫模型，並非 Firebase Console 帳單數字。

## 讀取下降的來源

- 手機一般員工停在首頁／派工頁時，不啟動全員整月 22,500 筆班表＋750 個員工 profile 預載。
- 首頁既有本人月份查詢 30 筆保留。
- 前台仍讀完整當日 750 筆 scheduleRecords 及當日 blocks／configuration。自動同區多車分配與人工抑制規則需要完整候選上下文，不能只算本人再假定結果相同。
- 本例 employee profiles 從前台 750 個縮成 534 個，30 個 ID 一批，共 18 個並行查詢。只排除既有解析與值班邏輯均不使用的明確整格休假；複合、空白與未知內容不擅自刪除。
- 因此不再無條件抓 750 人完整 profile；若某天全員都必須參與計算，仍可能讀滿 750 人。
- 首頁＋首次派工的文件回傳模型下降約 94.0%。此模型不等於實際 Firestore 計費 reads。
- 分批查詢增加 query 數，並須先等待當日 scheduleRecords；在高 RTT 下可能抵銷部分改善，尚需正式手機網路驗證。

## 顯示／快取行為

1. 手機一般員工先顯示「正在載入你的派工…」。
2. 已儲存且有人工作業標記的本人卡片，可在 profile 載入前先顯示。自動派工等必要的同日資料完成後，以原演算法算完才顯示本人，避免同區多車結果改變。
3. 先 render 本人的卡片，其餘卡片稍後補上；沒有本人派工時仍顯示完整清單。
4. 多筆派工保留數量、前後切換與姓名高亮，不以 employeeId 去掉第二筆。
5. 同員工／同日期的資料使用最多 3 筆、30 秒記憶體快取；登出清空。讀取快取不延長過期時間；跨員工、跨日期不混用。桌面與 duty 不使用此路徑。
6. 30 秒內返回可能看到管理員剛修改前的快照；過期後重新讀取。人工內容與 assignment 優先規則均不變，沒有本機或正式資料寫入。

## 驗證

- 回歸：62/62 通過。
- Rules／交易／讀取 emulator：11/11 通過，包含一般員工使用新的 documentId in 查詢；Rules 檔案未修改。
- 新增：30 天 × 日／夜兩班，完整 profile 與縮小 profile 的 assignment 結果逐項相同。
- 新增：延遲 profile 時本人人工卡片先可見、完整清單後續出現、不同班別多筆保留、同日回頁 0 次新資料查詢。
- 新增：手機首頁與派工頁不預載全員整月；開啟班表時原查詢仍會執行。
- 新增：快取員工／日期隔離、30 秒到期、容量限制與清空。
- TypeScript：通過。
- Production build：成功，output/mobile-dispatch-build。保留既有 CSS at-rule 與 bundle >500kB 警告；此輪沒有做拆包大重構。
- 差異檢查：無後台、assignment、Firebase config、Firestore Rules 或資料結構的程式變更。

## 修改檔案

- app/page.tsx：手機前台載入時機、本人卡片分階段 render、補齊清單時定位保護、local performance marks。
- lib/front-dispatch-data.ts：前台 profile 批次讀取與短期記憶體快取。
- tests/front-dispatch-preview.test.mjs：前台 React 整合驗證。
- tests/front-dispatch-data.test.mjs：完整月份 assignment 等價性與快取測試。
- tests/firestore.rules.test.mjs：新增既有權限下的 profile 批次讀取驗證；不是修改 Rules。
- tests/mobile-dispatch-profile.mjs：隔離手機 viewport 前後比較腳本。
- docs/mobile-dispatch-performance-2026-09-11.md：本報告。

## 尚未完成

未完成已登入正式站的真手機冷載入／行動網路量測，因此不能確認正式 RTT、計費 reads 與實機速度。需以同一測試員工、同一日期，在真機重新測量 profile、schedule、blocks/config 及首次本人可見時間，特別確認批次 query 的 RTT 取捨。Production build 已建立但未部署。未進行其他功能優化。
