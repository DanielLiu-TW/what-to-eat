# 今天吃什麼：設計方案 v4

> 範圍：`what-to-eat/` 整個 PWA（commit `b05c631`）。這份文件描述**目標設計**：第 1–10 節是修正後應有的行為，第 11 節列出與目前程式不同、需要實作的修正。
> **審查狀態**：v1–v3 經過 3 輪小組審查（opus / sonnet / haiku），三輪結論都是 REVISE。v4 納入第 3 輪的所有採納項目，**v4 本身沒有經過小組審查**，詳見 `design-review-log.md`。
> 網址：https://danielliu-tw.github.io/what-to-eat/

## 1. 目標

幫使用者（台大附近的學生，主要一個人吃、有時跟朋友吃、有預算限制）快速決定「現在吃什麼」。

要解決的四個痛點（來自使用者訪談）：
1. 附近的店都吃膩了 → 優先推薦**沒去過**、**很久沒吃**的
2. 跟朋友吃大家都沒想法 → **直接丟出 3 個選項**，可以分享給朋友
3. 有預算限制 → 以**每人金額**篩選
4. 想不起來還有什麼選項 → 內建料理類型庫、口袋名單、從 Google 地圖與照片匯入

### 驗收條件（可觀察）

| # | 條件 |
|---|---|
| A1 | 手機瀏覽器打開網址可用，可「加入主畫面」以全螢幕開啟；離線時至少能開啟 App 本體（包含網址帶查詢字串時） |
| A2 | 「幫我選」在資料備妥後（不含定位與網路）立即給出最多 3 個選項，每個選項都可以「就吃這個」記錄、「換掉」、開地圖；附近的店卡片標題列顯示評分與營業中 / 休息中（有資料時） |
| A3 | 避開天數設為 N（2/3/5/7）時，最近 N 天吃過的不會被抽到；設為 0 時不排除。比對對象依來源：「料理類型」比對類型 id；「口袋名單」比對 placeId（即 `places[].id`）或店名；「附近的店」比對店名（同名分店共用紀錄，見 §8）。店名比對只看「店家紀錄」，不看類型卡產生的紀錄。沒吃過、很久沒吃的機率較高 |
| A4 | 預算滑軌（每人 NT$100–1000）：滑到 1000（顯示「不限」）時不做任何金額篩選；其他預算下，店家有 Google 實際價格區間時，**區間下限 < 預算**才納入；沒有實際區間時用價位等級下限（0 / 150 / 350）比較；不知道價位視為在預算內。所有價格以「約 150 元內」等明確金額顯示，滑軌刻度寫 NT$，不使用 `$ / $$ / $$$` |
| A5 | 有 Google key 時，台大附近 800m 內實際存在的小吃店、早餐店（例：豬ㄟ早午餐、師園鹹酥雞）能出現在「附近」清單或其類型篩選結果中 |
| A6 | 「附近有嗎」/ 類型標籤 / 其他類型 / 搜尋框按 Enter 會用 Google 關鍵字搜尋補足名字裡沒有關鍵字的店 |
| A7 | 餐廳情報的好評 / 負評 / 小提醒要具體（菜名、等待時間、價格、付款方式等，不得只有「好吃」「服務好」）；菜單價格每一筆都標來源與日期；沒有來源（含「未知」「來源不明」等占位詞）的品項不顯示；日期無法解析時顯示「日期不明」；「一人約多少」沒有依據時不顯示 |
| A8 | 所有使用者資料只存在本機 localStorage；API 金鑰只放在請求 header，不出現在匯出備份或任何網址裡 |
| A9 | 外部 API 失敗時有可理解的訊息與退路，訊息在「附近」與「幫我選」都看得到（Google 全部失敗 → OpenStreetMap 並說明原因；部分失敗 → 提示「部分查詢失敗」；關鍵字搜尋失敗 → 提示；Gemini 搜尋不可用 → 只用評論）；暫時性失敗與不完整的結果不寫入長期快取 |
| A10 | 支援淺色 / 深色模式，手機寬度（375px）無水平捲動 |
| A11 | 並行操作不會產生錯誤資料：定位中改範圍或精細設定，最後結果以新設定為準；設定改了但重新定位失敗時，「幫我選」不會用舊設定的資料；「幫我選」與「附近」共用同一次定位；只有最新一次定位能寫入附近資料；新定位開始後，舊定位發出的關鍵字搜尋結果一律丟棄；匯入對話框重開不會混到上一次的資料 |
| A12 | 所有放進 `href` 的網址只接受 `http:` / `https:`；外部腳本有 SRI；損壞或格式錯誤的備份檔、評價快取不會讓 App 打不開 |

## 2. 架構

純靜態 PWA，無後端、無建置步驟，部署在 GitHub Pages（`main` 分支根目錄）。

| 檔案 | 職責 |
|---|---|
| `index.html` | 四個分頁（幫我選 / 附近 / 口袋名單 / 紀錄）、編輯與匯入對話框 |
| `styles.css` | 設計系統（色彩 token、淺深色）、所有元件樣式 |
| `data.js` | 內建 50 個料理類型（emoji、名稱、價位等級、中文關鍵字 `kw`、OSM cuisine `osm`）；`PRICE_LABEL`、`priceTag()` |
| `app.js` | 狀態與儲存（含正規化）、抽選演算法、附近搜尋與篩選、口袋名單、紀錄、分頁切換、`safeUrl()`、`samePlace()` |
| `reviews.js` | 金鑰設定、Google Places（附近、關鍵字、詳細資料）、Gemini 餐廳情報、評價卡片渲染、評價快取。位置一律讀 app.js 的 `nearbyCtx`（不再有獨立的 `lastPosition`） |
| `import.js` | Google Takeout 匯入（CSV / JSON / ZIP，ZIP 用 JSZip）、照片 EXIF 匯入（exifr） |
| `sw.js` | Service worker：安裝時以 `cache: "reload"` 抓 App 本體；執行時網路優先（`cache: "no-cache"`），只快取 `res.ok` 的同源回應；離線時用快取（`ignoreSearch`），導覽請求找不到時退回 `index.html`；跨網域請求不攔截 |

外部函式庫只在需要時從 CDN 載入，固定版本並加 SRI（見 §7）：JSZip 3.10.1（cdnjs）、exifr 7.1.3（jsdelivr）。

腳本載入順序：`data.js → app.js → reviews.js → import.js`。app.js 會在執行期呼叫 reviews.js 定義的 `hasGoogleKey`、`googleNearby`、`fillReview` 等（不在載入當下呼叫）。

## 3. 資料模型

### 3.1 名詞

| 名詞 | 意思 |
|---|---|
| `places[].id` | 口袋名單的內部 id（`uid()` 產生） |
| `logs[].placeId` | 指向 `places[].id`；沒有對應的口袋名單店就是 null |
| `gid` | Google Place ID（只用在附近項目與 Google API 呼叫） |
| 附近項目的 `id` | 顯示用的唯一鍵：Google 來源為 `"g:" + gid`，OSM 來源為 `type + osmId`（例如 `node123`） |

### 3.2 `localStorage["wte-v1"]`

```js
{
  catOverrides: { [builtinId]: { name?, emoji?, price?, hidden? } },
  customCategories: [{ id: "c-…", name, emoji, price }],
  places: [{ id, name, categoryId|null, price: 1|2|3, note, status: "want"|"been", url? }],
  logs:   [{ id, ts, name, emoji, categoryId|null, placeId|null, kind? }],
  settings: { source, budget, avoidDays, radius, hideVisited, onlyWant, nearbyFine }
}
```

- `logs[].kind`：`"category"`（類型卡）、`"place"`（口袋名單卡或照片匯入）、`"nearby"`（附近的店）。舊資料沒有 `kind` 時：有 `placeId` 視為 `place`，否則若名稱等於某個類型名稱視為 `category`，其餘視為 `nearby`。

**正規化**（載入與匯入備份都用同一個函式）：
- 頂層：`catOverrides` 必須是物件，否則 `{}`；`customCategories`、`places`、`logs` 必須是陣列，否則 `[]`。
- `catOverrides` 每個值：必須是物件；`name`、`emoji` 為字串才保留；`price ∈ {1,2,3}`；`hidden` 為布林。
- `customCategories` 每筆：`id` 為字串、`name` 為非空字串、`price ∈ {1,2,3}`，否則丟掉；`emoji` 非字串時用 🍽️。
- `places` 每筆：`id`、`name` 為非空字串；`price ∈ {1,2,3}`（否則 2）；`status ∈ {want, been}`（否則 been）；`categoryId` 為字串或 null；`note` 為字串；`url` 經 `safeUrl`，不合格就刪掉。
- `logs` 每筆：`id` 為字串、`ts` 為有限數字、`name` 為非空字串，否則丟掉；`kind` 不在集合內時依上述規則推定。
- `settings` 每個欄位限定離散集合，不在集合內用預設值：`source ∈ {nearby, category, place}`、`budget` 為 100–1000 的 50 倍數、`avoidDays ∈ {0,2,3,5,7}`、`radius ∈ {400,800,1500,3000}`、`hideVisited` / `onlyWant` / `nearbyFine` 為布林。
- JSON 損毀時先把原字串存到 `wte-v1-corrupt-<時間>`，再用預設值。
- 匯入備份後：清掉 `pickShown`、`pickRejected`、`nearbyRandom`、`visitedCache`，並重繪所有分頁（附近資料不受備份影響，保留）。

### 3.3 其他儲存

- `localStorage["wte-keys"]`：`{ google, gemini }`，不進匯出備份。
- `localStorage["wte-review-cache"]`：餐廳情報長期快取，key 為 `"v3:" + 附近項目 id`；每筆 `{ ts, ttl, data }`。啟動時刪掉所有 `v2:` 項目與格式不符的項目；整個值不是合法 JSON 時清空。超過 200 筆時依 `ts` 刪最舊的。
- **只在記憶體**（不寫 localStorage）：`nearbyCtx`、原始結果快取 `nearbyRawCache`、評價的短期記憶體快取、`nbSearched`。

### 3.4 附近項目（記憶體）

```js
{ id, gid?, name, lat, lon, dist, cuisine, amenity, addr,
  rating?, count?, tier?, priceMin?, priceText?, openNow?, mapsUrl?,
  cat, matchCats?, matchQ?, rnd }
```

`priceMin` 是 Google `priceRange.startPrice.units` 的數值，供 A4 使用；`priceText` 是顯示用文字。

`nearbyCtx = { seq, lat, lon, radius, fine, ts, places }`：`lat` / `lon` 是這份資料查詢時的位置，`ts` 是這份資料的建立時間（命中原始快取時沿用快取的 `ts`，不是現在時間）。

## 4. 主要流程

### 4.1 幫我選（`doPick` / `pickPool` / `weightedSample`）

- 來源三選一：
  - **附近的店**（預設）：用 4.2 的附近資料，價位依 A4
  - **料理類型**：內建 + 自訂類型（排除隱藏）
  - **口袋名單**：可勾選「只抽還沒吃過的」
- 排除：超出預算（A4）、本輪已拒絕、`avoidDays` 天內吃過（比對方式見 A3）。
- 權重：`(1 + min(天數,30)/10) × (想吃清單 ? 2 : 1) × (附近且沒去過 ? 3 : 1)`，沒吃過視為 30 天。
- 加權抽樣不放回，抽 3 個；「✕」替換單一張，「換一批」把目前 3 個加入拒絕清單；全部拒絕過一輪後自動重置。抽樣用的亂數來源可替換（測試時注入），預設 `Math.random`。
- **附近資料的新鮮度**（選「附近的店」時）：
  1. 先快速取得目前位置（`getPosition`，接受 60 秒內的系統快取，不呼叫付費 API）。
  2. 以下任一成立就呼叫 `locate()` 重新查詢：沒有 `nearbyCtx`；`nearbyCtx.radius ≠ settings.radius`；`nearbyCtx.fine ≠ settings.nearbyFine`；`nearbyCtx.ts` 超過 30 分鐘；目前位置與 `nearbyCtx` 位置相距 > 150m。
  3. 第 1 步取位置失敗時：若 `nearbyCtx` 存在且第 2 步的時間與設定條件都不成立，沿用舊資料並在結果區提示「位置未更新」；否則呼叫 `locate()`（它會回報定位失敗）。
  4. `locate()` 回傳 `{ ok: false }` 時在結果區顯示錯誤，**不抽選**（即使有舊資料）。
- 呼叫 `locate()` 時，進度訊息顯示在幫我選的結果區；`ok` 時若附近沒有店，顯示「附近沒有找到店家」。`nearbyNotice` 有內容時顯示在結果區上方。
- 附近的店卡片標題列：類型、距離、評分（有資料時）、營業中 / 休息中（有資料時），格式與附近清單卡片相同。
- 記錄「就吃這個」：
  - 口袋名單卡：寫 `kind: "place"`、`placeId`，把該店改成「吃過」
  - 附近的店卡：寫 `kind: "nearby"`；以店名比對口袋名單，同名的店改成「吃過」並寫入其 `placeId`
  - 類型卡：寫 `kind: "category"`、`categoryId`；不改任何店的狀態
- 分享給朋友：附近的店用 `cat.emoji`，其他用類型 emoji。

### 4.2 附近（`locate` / `loadNearby`）

**`locate({ force = false } = {})` 是附近資料的唯一入口**：
- 回傳 `Promise<{ ok: boolean, error?: string }>`，永不 reject。任一來源成功（即使 0 家）為 `ok: true`；所有來源都失敗為 `ok: false`，`error` 包含 Google 的失敗原因（若有）。
- 每次呼叫時遞增 `latestRequestSeq`（全域）。單例：已有進行中的請求，且參數（radius、nearbyFine）相同、`force` 為 false 時，**不遞增**、回傳同一個 promise；參數不同或 `force` 為 true 時，遞增並發出新請求，舊請求的結果作廢。回傳的 promise 在**最新一次**請求結束時才 resolve。
- 進度訊息透過訂閱者通知：附近頁的狀態列一定訂閱；幫我選呼叫時另外訂閱結果區。
- UI：附近頁可見時才清空附近清單；**📍 按鈕在定位中保持可按**，只用樣式表示忙碌（再按一次就是 `force` 重查）。
- 狀態動作（不論呼叫端）：成功後清空 `nbSearched`，若附近頁目前篩選某個類型，重新做該類型的關鍵字搜尋。
- 呼叫端：進入附近頁且沒有 `nearbyCtx`（自動）、📍 按鈕（`force: true`）、範圍或精細設定改變（有 `nearbyCtx` 或正在定位時才呼叫）、幫我選（見 4.1）。
- **金鑰變動**（Google key 有變）：清空原始快取與 `nearbyCtx`；附近頁可見時立刻呼叫 `locate()`，否則等下次進入附近頁或幫我選時自然重查。

**`loadNearby(seq, { radius, fine, force })`**（參數是呼叫當下的快照，之後全程只用快照）：
1. 定位（高精度、15 秒逾時、接受 60 秒內的系統快取位置）。
2. **Google 部分**：原始快取（只存 Google 結果）在 30 分鐘內、位置差 150m 內、radius 與 fine 相同，且不是 `force` → 用快取，不查 Google。否則有 Google key 時查詢：
   - 範圍 ≥ 400m 時切成 7 個小圈：中心 1 + 外圍 6，**外圍圓心距 r·√3/2 ≈ 0.866r、小圈半徑 0.52r**（7 圓覆蓋的標準配置，理論值 0.5r 剛好蓋滿，多留 4% 餘裕），各做 `searchNearby`（DISTANCE，最多 20 家，含評分 / 價位 / 營業欄位）
   - 整個範圍 POPULARITY 一次；關鍵字「小吃」（最多 2 頁）、「早餐」（1 頁）的 `searchText`
   - **精細模式**（預設開）：抓滿 20 家的小圈再切成 4 塊，**子圓心在該小圈內 (±0.5r', ±0.5r')、半徑 0.72r'**（r' 為小圈半徑；理論值 0.707r'），最多 28 次，只抓基本欄位（較便宜的計費層級，沒有評分 / 價位 / 營業）
   - 店家類型：餐廳、外帶、外送、咖啡、烘焙、速食、美食街、早餐、早午餐、三明治、咖啡店、甜點、茶館。Google 回 400 時，**先看 `error.details` 裡 `fieldViolations[].field` 是否含 `included_types` / `includedTypes`**，其次才用訊息比對（`/included_?types|unsupported (place )?type/i`），符合才逐級退回較保守清單（多個請求同時失敗只降一級）；儲存金鑰時重設
   - `googleNearby` 回傳 `{ places, failed, firstError }`。**只有所有子查詢都成功時才寫原始快取**
3. **OSM 部分**：每次都查（免費，不快取），範圍以參數傳入，3 個備援伺服器各 20 秒逾時；**整體最多等 10 秒**（不論有沒有 Google key）。
4. `nearbyNotice`：Google 全部失敗時寫「Google 查詢失敗（原因），目前只用 OpenStreetMap 資料」；Google 部分失敗時寫「部分查詢失敗，結果可能不完整」；OSM 逾時或失敗且沒有 Google 結果時寫「OpenStreetMap 沒有回應」；否則清空。附近頁狀態列在「符合 N 家」後面附上它；幫我選結果區也顯示。
5. 整理：合併 Google 與 OSM（同店判斷）→ 丟掉沒有名稱或座標的結果 → 計算距離 → 排除超出範圍 5% 以上 → 依距離排序 → 去重 → 猜類型 → 每家給 `rnd`。
6. 寫入：只有 `seq === latestRequestSeq` 時，才寫入 `nearbyCtx = { seq, lat, lon, radius, fine, ts, places }`（`ts` 依 §3.4）。

**同店判斷**（`mergeSources`、整理階段、`mergeNearby` 共用 `samePlace(a, b)`）：
- 兩者都有 `gid`：`gid` 相同才是同一家。
- 否則：同名且相距 ≤ 50m，或名稱互相包含且相距 ≤ 40m。
- 同名但相距 > 50m 視為不同分店，都保留。
- 合併同一家時保留較完整的欄位：`rating`、`count`、`tier`、`priceMin`、`priceText`、`openNow`、`mapsUrl`、`gid` 有值者優先，Google 優先於 OSM。

### 4.3 附近的篩選與關鍵字搜尋

- 篩選：搜尋字、類型、排序（距離 / 評分 / 隨機）、價位上限、沒去過、營業中、★4 以上。
- **價位上限**（附近頁選單）是「至多到某個等級」：「一人 150 元內」= 等級 1；「一人 350 元內」= 等級 ≤ 2；有 `priceMin` 時換算成等級再比較；不知道價位視為符合。這與 A4 的預算滑軌（看區間下限是否低於預算）語意不同，是刻意的：選單是粗分類，滑軌是「有沒有可能在預算內吃到」。
- 資料來源沒有評分或營業資訊時：對應的標籤隱藏並**取消**；「評分最高」排序選項設為 `disabled`（iOS 不支援隱藏 option），若目前是評分排序則改回距離並更新選單值。
- 清單最多顯示 80 家，超過時在清單尾端顯示「還有 N 家，請用篩選縮小範圍」。
- 類型標籤由目前結果自動產生並顯示數量；最後有「其他類型」下拉，可選任何類型。`placeCats(p)` 只回傳仍存在的類型 id，所以自訂類型被刪掉後不會出現在標籤，也不會崩潰；若目前篩選的類型不存在，重設為全部。
- 關鍵字搜尋（選類型、按「附近有嗎」、選其他類型、搜尋框按 Enter）：
  - 以類型名稱（以「/」拆成最多 2 個詞）或搜尋字做 Google `searchText`（以 `nearbyCtx` 的位置與範圍為矩形；**第一個詞最多 3 頁，第二個詞 1 頁**）
  - 發出時快照 `latestRequestSeq`；結果回來時**若 `latestRequestSeq` 已不同（有新定位開始，不論是否完成或成功）就整批丟棄**
  - 失敗時只刪除自己的搜尋紀錄，並寫入 `nearbyNotice`「搜尋『X』失敗（原因）」
  - 合併用「同店判斷」，新加入的店給 `rnd`，並標記 `matchCats` / `matchQ`；沒有 `nearbyCtx` 時直接返回
  - 同一個 seq 與關鍵字只搜一次
- 搜尋框按 Enter 時，若正在用輸入法選字（`e.isComposing` 或 `keyCode === 229`）不觸發搜尋。
- 篩選某類型時，提供「在 Google 地圖看附近的 X」連結作為保底。

### 4.4 餐廳情報（`getPlaceInfo`）

1. Google：
   - 有 `gid`：Place Details（`reviewSummary` 欄位不支援時退回不帶它）
   - 沒有 `gid`、有座標（OSM 來源）：名稱 + 座標做 `searchText`，`maxResultCount: 5` 並帶 `places.location`，取相距 ≤ 150m 中最近的一筆；都不符合視為「查無結果」
   - 沒有 `gid`、沒有座標（例如日後口袋名單卡要顯示評價）：名稱做 `searchText`，有 `nearbyCtx` 時只把它當 `locationBias`（不做距離篩選），`maxResultCount: 5`，取名稱完全相同的第一筆，沒有就取第一筆並在卡片標示「可能不是同一家」；這種情況的「查無結果」只進記憶體快取，不寫 1 天
   - 取得評分、價位、最多 5 則評論（含日期）。營業中 / 休息中**不從這裡顯示**，一律用附近項目的即時 `openNow`（顯示在卡片標題列，見 4.1）
2. 有 Gemini key：`gemini-3.5-flash-lite` 的 `generateContent`。**每次開啟最多 2 次 Gemini 呼叫**：先帶 `google_search` 工具（需付費方案）；呼叫失敗、回傳空白、或 JSON 解析失敗時，改成只用評論並要求 JSON 呼叫第 2 次。第 2 次的解析失敗不再重試。
3. 系統指示：好評 / 負評 / 小提醒各最多 3/3/2 點、每點 30 字內且具體；菜單最多 6 項、價格只能來自來源、每筆附來源與日期、**不知道的日期留空字串**（不要寫「未知」）；一人花費與依據。
4. 解析與清理：寬鬆取第一個 `{` 到最後一個 `}`；`source` 為空、或屬於占位詞（未知、不明、來源不明、無、none、n/a、null、unknown，不分大小寫）的品項丟掉；沒有價格的品項丟掉；`date` 無法解析成 `YYYY-MM(-DD)` 時存成空字串，畫面顯示「日期不明」；`per_person` 沒有依據時不顯示。菜單日期取所有可解析日期中最新的。
5. 沒有 Gemini key、或 Gemini 兩次都失敗：顯示 Google 評論摘要，或節錄最高分與最低分評論（附日期）；Gemini 失敗時顯示錯誤訊息。
6. **快取規則**。一筆結果 = Google 部分 + Gemini 部分，整筆一起決定：

   | 情況 | 長期快取（localStorage） | 記憶體快取（5 分鐘） |
   |---|---|---|
   | Google 請求失敗（網路、429、5xx、403 等，不是查無結果） | 不存，顯示錯誤 | 存（避免重繪時重打） |
   | Google 查無結果（有 gid 或有座標的情況） | 1 天 | — |
   | Google 查無結果（沒有座標的情況） | 不存 | 存 |
   | 沒有 Gemini key，Google 成功 | 7 天 | — |
   | Gemini 帶搜尋成功 | **不存**（見第 7 點，條款核對後可改為 7 天） | 存 |
   | 搜尋版因 400 / 403（方案或權限，屬永久性）失敗、只看評論成功 | 7 天 | — |
   | 搜尋版因 429 / 5xx / 網路失敗、或回傳空白 / 解析失敗，只看評論成功 | 不存 | 存 |
   | Gemini 兩次都失敗（Google 成功） | 不存 | 存 |

   金鑰實際變動時清空長期與記憶體快取，並作廢進行中的查詢（查詢回來時發現金鑰已變，不寫任何快取）。
7. 搜尋建議與條款：Gemini API 的 Grounding with Google Search 規定使用搜尋結果時要顯示搜尋建議（`searchEntryPoint.renderedContent`），以 sandbox iframe 顯示。**預設不把搜尋版結果寫入長期快取**（P28：實作前核對條款；若允許儲存，改為 7 天並連同 `searchHtml` 一起存，顯示快取時也還原 iframe）。
8. 搜尋來源連結經 `safeUrl(uri, null)`（不合格就不顯示該連結）。

### 4.5 口袋名單與匯入

- 「想吃」/「吃過」兩區；記錄吃過的規則見 4.1。
- 編輯對話框：**「儲存」是唯一的 submit 按鈕**（在輸入欄按 Enter 等於儲存）；「取消」是 `type="button"`，點擊呼叫 `dlg.close("cancel")`；名稱 trim 後為空時 `preventDefault()`、不關閉對話框並提示。
- Google 地圖匯入：Takeout ZIP 內所有 `.csv`（清單）與名稱含 saved/已儲存/地點/places 的 `.json`；CSV 欄位用標題比對（Title/標題/名稱、Note/附註、URL/網址）；CSV 與 JSON 的網址一律經 `safeUrl`（不合格就不存）；預設全選，已存在的店不可選。
- 照片匯入：exifr 讀 GPS 與拍攝時間；同一天 60m 內視為同一餐；40m 內的拍攝點合併查詢 OSM（120m 內餐廳，最多 6 個候選，失敗重試 3 次）；使用者選店名後新增「吃過」與紀錄（`kind: "place"`，同店同日不重複）。
- 匯入以「session」物件傳遞：每次開對話框建立新 session，非同步迴圈只讀寫自己的 session，每一步前檢查自己是否仍是目前 session；確認時只處理與目前模式相符、且欄位齊全的列。

### 4.6 紀錄與設定

- 依日期分組，可刪除單筆；匯出 / 匯入 JSON（匯入覆蓋，會確認，經 §3 正規化）。
- 設定：Google Maps key、Gemini key、精細搜尋開關。設定頁說明文字與 §5 的數字一致，並說明 📍 會強制重查。

### 4.7 `safeUrl(url, fallback)`

用 `new URL(url)` 解析，協定是 `http:` 或 `https:` 才回傳原網址；否則回傳 `fallback`（地點連結用 `mapsSearchUrl(name)`，來源連結用 `null` 表示不顯示）。套用位置：口袋名單卡的地圖連結（`p.url`）、附近卡片的 `mapsUrl`、Takeout CSV / JSON 匯入、備份匯入、§3 正規化、Gemini 來源連結。

## 5. 外部服務與成本

| 服務 | 用途 | 金鑰 | 成本概估 |
|---|---|---|---|
| Google Places API (New) | 附近搜尋、關鍵字搜尋、詳細資料、評論 | 使用者自備，**必須**限制 HTTP referrer 為 `https://danielliu-tw.github.io/what-to-eat/*` 並限制只能用 Places API (New) | 每次重新查詢附近：一般約 11 次（7 小圈 + 1 熱門 + 小吃 2 頁 + 早餐 1 頁，含評分 / 營業欄位，屬較高計費層級）；精細模式最多再 28 次基本欄位查詢。30 分鐘內在 150m 內、設定相同時不重查。每張評價卡 1 次 Place Details（含評論）或 1 次名稱搜尋；快取規則見 §4.4-6（有 Gemini 搜尋版時預設不長期快取，每次開卡片會重查，5 分鐘內不重複）。類型 / 關鍵字搜尋第一個詞最多 3 頁、第二個詞 1 頁。每月有免費額度，實際以 Google 帳單為準 |
| Gemini API | 餐廳情報 | 使用者自備（AI Studio），建議同樣限制 referrer | 每次開卡片最多 2 次呼叫。免費方案只能看評論；Google 搜尋需付費方案，每月前 5,000 次搜尋免費 |
| OpenStreetMap Overpass | 附近搜尋（每次都查）、照片匯入 | 不需要 | 免費，但伺服器常慢或掛掉 |
| GitHub Pages | 主機 | — | 免費 |

## 6. UI 設計系統

- 色彩 token 定義在 `:root`，深色模式在 `prefers-color-scheme: dark` 覆寫：暖色奶油底 `--bg #fff7f0`、番茄橘漸層 `--accent #ff5a36 → --accent-2 #ff9a3d`、好 / 壞 / 小提醒各有語意色。
- 版面：最大寬 560px、左右 16px；卡片 20px 圓角與柔和陰影；頂部毛玻璃標題列（依時段問候）；底部懸浮膠囊分頁列（SVG 線條圖示）。
- 元件：分段選擇、漸層滑軌（刻度 NT$100 / NT$500 / 不限）、可左右滑的標籤列、分組清單、手機上的底部面板對話框、toast。
- 動效：卡片進場、骰子轉動、對話框滑上；沒有 `prefers-reduced-motion` 處理（見風險）。

## 7. 安全與隱私

- 所有使用者文字輸出前經 `esc()`；Gemini 與 Google 回來的文字同樣經 `esc()` 再插入 HTML。**唯一例外**：Google 搜尋建議 HTML（`searchEntryPoint.renderedContent`）刻意不跳脫，只放在 `sandbox="allow-popups allow-popups-to-escape-sandbox"`（不允許腳本）的 iframe `srcdoc` 裡。
- 所有放進 `href` 的網址經 `safeUrl()`（§4.7）。
- 外部腳本加 SRI 與 `crossorigin="anonymous"`（已從 CDN 下載實際檔案計算）：
  - JSZip 3.10.1：`sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG`
  - exifr 7.1.3：`sha384-KrOocIA+lZcNUz2MDavnT/FuX+CbTREJihUi0bp8QUSwhE2AkGTNpv2b7yMbBkx5`
- 金鑰存在 localStorage、從瀏覽器直接呼叫 Google API（放在 header，不放網址）；安全性依賴使用者設定的 referrer 與 API 限制。
- **共用 origin 風險**：GitHub Pages 的 origin `https://danielliu-tw.github.io` 與同帳號其他專案頁面共用，同源頁面都能讀這個 localStorage。目前帳號沒有其他會顯示使用者內容的頁面；若日後新增，應改用自訂網域。README 的 referrer 建議也要寫 `/what-to-eat/*`。
- 定位資料只送給 Google / OSM 做搜尋，只存在記憶體（§3.3），不寫入 localStorage。
- Gemini 搜尋結果的顯示與儲存依 §4.4-7。

## 8. 已知風險與限制

1. Google Places 單次最多 20 家；即使切細，極密集區域仍可能漏店；Google 上沒有的店找不到。
2. 類型推測依店名關鍵字，準確度有限；`guessCategory` 只回傳一個類型（關鍵字搜尋可補上額外類型）。
3. Gemini 可能產生錯誤價格；以「來源 + 日期 + 僅限有來源」降低風險，但無法完全避免（來源本身可能是模型編的名稱，使用者可點來源連結核對）。
4. OSM 伺服器不穩定；照片匯入完全依賴 OSM。
5. iPhone / Android 選照片時可能移除 GPS。
6. localStorage 可能被系統清除；iOS 主畫面 App 與 Safari 資料分開。
7. 無自動化測試；驗證依賴手動 / 瀏覽器內模擬。
8. 無 `prefers-reduced-motion`；`color-mix()`、`:has()` 在舊瀏覽器不支援（僅影響外觀）。
9. 多個分頁同時開啟時，最後儲存者覆蓋另一邊（手機 PWA 很少發生，不處理）。
10. 飲食紀錄、「沒去過」、「吃過」標記對附近的店以**店名**比對：吃過其中一家分店，同名的其他分店也會被視為吃過。
11. 30 分鐘、150m 以內的移動不會觸發重新查詢，距離顯示會有最多約 150m 的誤差。
12. 有 Gemini 搜尋版時，評價卡預設不長期快取（等條款核對），重複開同一家店會再付費查詢。

## 9. 非目標

後端與帳號、多人即時投票、跨裝置同步、自動爬社群平台（違反使用條款）、外送下單、多分頁即時同步。

## 10. 驗證方式

標示：**[自動]** 指令；**[模擬]** 在 `http://127.0.0.1:8765` 用瀏覽器主控台注入假的定位、亂數與 API 回應；**[手動]** 需要真實裝置或真實金鑰。

| # | 對應 | 步驟 | 預期結果 |
|---|---|---|---|
| V1 | 全部 | [自動] 逐檔 `node --check app.js reviews.js import.js data.js sw.js` | 全部無語法錯誤 |
| V2 | 全部 | [模擬] 開啟頁面，看主控台 | 無錯誤 |
| V3 | A1、P17 | [模擬] 載入一次後在開發者工具切離線，開 `/?x=1` | App 正常顯示 |
| V4 | P17 | [模擬] 讓同源某檔回 404 | 不寫入快取，原快取保留 |
| V5 | A2 | [模擬] 料理類型來源按幫我選；附近來源按幫我選（附近資料含 rating 與 openNow） | 立即出現 ≤ 3 張卡，各有「就吃這個」、✕、地圖；附近卡標題列有評分與營業狀態 |
| V6 | A3 | [模擬] 注入固定亂數序列；記錄類型「拉麵」今天吃過，avoidDays=3，類型來源抽 50 次並計數 | 拉麵出現 0 次；avoidDays=0 時同一序列下出現 ≥ 1 次 |
| V7 | A3、P22 | [模擬] 口袋名單有店「牛肉麵」，在類型卡記錄類型「牛肉麵」；之後口袋名單來源抽選 | 該店狀態不變，且不因這筆紀錄被排除 |
| V8 | A4 | [模擬] 等級 2 無實際區間的店：預算 150 排除、200 納入；`priceMin` 200 的店：預算 200 排除、250 納入；`priceMin` 1200 的店：預算 1000（不限）納入；精細模式抓到的店（沒有區間、類型價位 1）：預算 100 納入 | 符合 |
| V9 | A4 | [模擬] 檢查所有卡片、清單、選單、滑軌刻度文字 | 沒有 `$` 單獨出現的價位標記；刻度為 NT$100 / NT$500 / 不限 |
| V10 | A5、P7 | [自動] 公尺座標下，對每個母圓內部做格點取樣（徑向 1%、角度 1°）：7 小圈對範圍圓；每個小圈的 4 子圓對該小圈 | 每點都被**其所屬母圓**的某個子圓覆蓋 |
| V11 | A5 | [模擬] fixture：所有 ≥400m 的小圈回傳 20 家連鎖店，只有包含「豬ㄟ早午餐」(25.0194869, 121.5335257) 的子圓回傳它；定位台大 (25.0174, 121.5398) | 精細模式下豬ㄟ早午餐出現在附近資料；關閉精細模式時不出現 |
| V12 | A5 | [手動] 真實 Google key 在台大附近 800m | 能找到豬ㄟ早午餐、師園鹹酥雞（或其類型篩選結果） |
| V13 | A6 | [模擬] 附近資料沒有炸雞，選類型「炸雞」 | 發出「炸雞」「鹹酥雞」searchText，命中的店以炸雞類型顯示 |
| V14 | A6 | [模擬] 搜尋框輸入「水煎包」按 Enter（非輸入法狀態） | 發出 searchText「水煎包」，結果合併進清單 |
| V15 | A7、P1 | [模擬] Gemini 回傳 5 筆菜單：正常、source 空、source「未知」、date「未知」、price null | 只顯示正常與 date 未知兩筆；後者顯示「日期不明」 |
| V16 | A7 | [手動] 真實 Gemini key 抽 5 家店 | 每家的好評 / 負評每點都含具體名詞或數字，無「好吃」「服務好」這類單獨形容 |
| V17 | A8 | [模擬] 匯出備份；檢查所有 Google / Gemini 請求的 URL | 備份不含金鑰；URL 不含金鑰 |
| V18 | A9、P6 | [模擬] Google 全部 403、OSM 成功；從幫我選與附近各觸發一次 | 兩處都看到 Google 失敗原因；`locate` 回 `ok: true` |
| V19 | A9、P6 | [模擬] Google 與 OSM 都失敗 | `locate` 回 `ok: false`，錯誤含 Google 原因；幫我選不抽選 |
| V20 | A9、P6 | [模擬] 7 個小圈中 1 個回 500 | 顯示「部分查詢失敗」；再呼叫 `locate()` 會重新發 Google 請求（沒寫快取） |
| V21 | A9、P20 | [模擬] 關鍵字搜尋回 500 | `nearbyNotice` 顯示「搜尋『X』失敗」 |
| V22 | A9、P8 | [模擬] 搜尋版 Gemini 回 429、只看評論成功；開同一家，2 分鐘後再開，6 分鐘後再開 | 第 1 次：Google 1 次、Gemini 2 次；第 2 次：0 次；第 3 次：Google 1 次、Gemini 2 次；localStorage 沒有這筆 |
| V23 | P8 | [模擬] 搜尋版回 403、只看評論成功 | 寫入長期快取 7 天 |
| V24 | P8 | [模擬] 有 gid 的店 Google 查無結果；Place Details 回 429 | 前者快取 1 天；後者不寫長期快取並顯示錯誤 |
| V25 | P8 | [模擬] 查詢途中換金鑰 | 回來的結果不寫任何快取；換金鑰時清空快取；重新儲存相同金鑰不清 |
| V26 | P8、P28 | [模擬] Gemini 帶搜尋成功 | 顯示搜尋建議 iframe；localStorage 沒有這筆（條款核對前的預設） |
| V27 | A12、P19 | [模擬] `wte-review-cache` 分別設為：壞 JSON、含 `v2:` 項目、含 `{ts:"x"}` 項目；重新整理 | App 正常；這些項目被清掉 |
| V28 | A11、P2 | [模擬] 定位進行中（讓 Google 延遲 2 秒）把範圍從 800 改 1500 | 最後 `nearbyCtx.radius = 1500`，原始快取也是 1500 |
| V29 | A11、P2 | [模擬] 範圍從 800 改 1500 後定位被拒，按幫我選 | 結果區顯示定位錯誤，不使用 800 的舊資料抽選 |
| V30 | A11、P2 | [模擬] 幫我選與附近幾乎同時觸發 | 只有一組 Google 請求 |
| V31 | A11、P2 | [模擬] 沒有附近資料時拒絕定位權限按幫我選；有新鮮附近資料時拒絕定位按幫我選 | 前者顯示定位失敗、主控台無 TypeError；後者沿用舊資料並提示「位置未更新」 |
| V32 | A11、P2 | [模擬] 附近資料建立 31 分鐘後按幫我選、位置不變；10 分鐘、移動 200m；10 分鐘、移動 50m | 前兩者重新查詢；第三者不查，`nearbyCtx.ts` 不變 |
| V33 | A11、P2 | [模擬] 命中原始快取後檢查 `nearbyCtx.ts` | 等於快取的建立時間 |
| V34 | A11、P24 | [模擬] 類型搜尋進行中（延遲 2 秒）按 📍，讓新定位**失敗** | 舊搜尋結果被丟棄，清單沒有舊搜尋的 matchCats |
| V35 | A11、P10 | [模擬] 照片匯入進行中關閉對話框，改開 Google 地圖匯入並選檔 | 只出現 Google 地圖的列；確認後沒有名稱為空的店 |
| V36 | A12、P4 | [模擬] 匯入含 `javascript:` url 的備份與 Takeout JSON；Gemini 來源 uri 為 `javascript:` | 地點連結是 Google 地圖搜尋網址；該來源連結不顯示 |
| V37 | A12、P5 | [模擬] 觸發照片與 ZIP 匯入，檢查動態載入的 script | 有 `integrity` 與 `crossorigin="anonymous"`，且成功載入 |
| V38 | A12、P19 | [模擬] 匯入下列損壞備份各一次：customCategories 為物件、customCategories 有缺 name 的項目、catOverrides 為 null、catOverrides 的 name 為數字、logs.ts 為字串、avoidDays=4 | App 正常、附近頁正常、avoidDays 顯示預設 3 |
| V39 | P19 | [模擬] 把 `wte-v1` 改成壞 JSON 後重新整理 | 出現 `wte-v1-corrupt-*` 備份，App 用預設值開啟 |
| V40 | P3 | [模擬] 編輯對話框：名稱欄按 Enter；點取消；名稱只有空白按儲存 | 依序：儲存並關閉；關閉不儲存；不關閉並提示 |
| V41 | P9 | [模擬] 只有 OSM 資料時，先前已開啟「營業中」並選「評分最高」排序 | 「營業中」被取消、排序改回距離且該選項 disabled、清單不為空 |
| V42 | P11 | [模擬] OSM 來源的店名稱搜尋回傳 5 筆，第一筆在 300m 外、第三筆在 80m；全部 > 150m | 前者採用第三筆；後者視為查無結果並快取 1 天 |
| V43 | P11 | [模擬] 沒有座標的店（口袋名單）名稱搜尋，正確的店在 2km 外 | 找得到；不寫 1 天的查無結果快取 |
| V44 | P12 | [模擬] 搜尋版回傳空白文字 | 改用只看評論呼叫第 2 次；第 2 次也解析失敗時不再重試 |
| V45 | P13 | [模擬] 同名分店兩家相距 300m（一家來自附近、一家來自關鍵字搜尋）；同一家 gid 先出現精簡欄位版、後出現完整版 | 兩家分店都保留；同 gid 的合併後有評分 |
| V46 | P14 | [模擬] 隨機排序後按 📍 重新定位，再觸發關鍵字搜尋 | 每家都有數值 `rnd`，排序正常 |
| V47 | P15 | [模擬] 附近來源抽選後按分享 | 文字中的 emoji 與卡片一致 |
| V48 | P16 | [模擬] searchNearby 回 400，details 的 fieldViolations 含 included_types；另一次訊息只含 `type.googleapis.com` | 前者降一級重試；後者不降級 |
| V49 | P18 | [模擬] 搜尋框派發 `isComposing: true` 的 Enter | 不發出 searchText |
| V50 | P20 | [模擬] 搜過自訂類型後刪掉它，回附近頁 | 正常顯示，該類型標籤消失 |
| V51 | P21 | [模擬] 10 分鐘內按 📍；在定位進行中再按一次 📍 | 📍 可按；每次都發出新的 Google 請求；只採用最後一次 |
| V52 | P23 | [模擬] 設定頁文字、README | 查詢次數與 §5 一致；referrer 建議為 `/what-to-eat/*`；評價順序寫 Gemini 優先 |
| V53 | A3、P26 | [模擬] 附近的店「阿伯小吃」A 分店今天有 `kind: "nearby"` 紀錄，附近資料有同名 B 分店（相距 300m），avoidDays=3，附近來源抽選 | A、B 都不被抽到（同名共用紀錄） |
| V54 | P29 | [模擬] 先在沒有 Google key 下定位，再儲存 Google key，立即按幫我選 | 重新查 Google |
| V55 | 清單上限 | [模擬] 附近資料 120 家 | 顯示 80 家與「還有 40 家」 |
| V56 | A10 | [手動] 375×812 淺色 / 深色截圖四個分頁 | 無水平捲動、文字不重疊 |

## 11. 修正計畫（待實作）

### 實作前置

| # | 項目 |
|---|---|
| P28 | 核對 Gemini API「Grounding with Google Search」條款對顯示與儲存搜尋結果的規定，結論寫回 §4.4-7。在核對前，搜尋版結果不寫長期快取（已是預設） |

### 第 1 輪

| # | 修正 | 來源 | 嚴重度 |
|---|---|---|---|
| P1 | 菜單：沒有來源或來源為占位詞的品項丟掉；日期無法解析顯示「日期不明」；`per_person` 沒依據不顯示；系統指示改成不知道的日期留空（§4.4-3、4） | R1 sonnet:F1、opus:F4、haiku:F1；R2 sonnet:R2-7、haiku:F10 | 中 |
| P2 | `locate({force})` 契約（`{ok,error}`、ok 定義、`latestRequestSeq`、單例比對參數、訂閱者進度、📍 不停用、成功後的狀態動作）；`loadNearby` 參數快照；`nearbyCtx`（含 fine、資料建立時間）取代 `nearbyPlaces` + `lastPosition`，reviews.js 一併改讀；`doPick` 走 `locate()`，新鮮度比對時間 / 位置 / radius / fine，取位置失敗與定位失敗的處理（§4.1、4.2） | R1 sonnet:F2/F3/F4、opus:F3/F8、haiku:F7；R2 opus:R2-F1/F2/F5、sonnet:R2-1/R2-8/R2-15、haiku:F3/F4；R3 sonnet:R3-2/R3-3/R3-7、opus:R3-3/R3-4/R3-5、haiku:R3-01/R3-03/R3-12 | 中 |
| P3 | 編輯對話框：儲存是唯一 submit；取消 `type="button"` 並呼叫 `dlg.close("cancel")`；名稱空白不關閉並提示（§4.5） | R1 sonnet:F5；R2 opus:R2-F10、sonnet:R2-12、haiku:F1 | 中 |
| P4 | 新增 `safeUrl(url, fallback)` 並套用在 §4.7 列出的所有位置 | R1 sonnet:F14、opus:F6、haiku:F2；R2 sonnet:R2-14、haiku:F9 | 中 |
| P5 | 外部腳本 SRI 與 crossorigin；文件補共用 origin 風險（§7） | R1 sonnet:F6、opus:F10、haiku:F16 | 低 |
| P6 | `googleNearby` 回傳失敗資訊；`nearbyNotice` 在附近與幫我選都顯示；部分失敗不寫原始快取；原始快取只存 Google 結果，OSM 每次查並統一 10 秒上限（§4.2） | R1 sonnet:F7；R2 opus:R2-F4、sonnet:R2-2、haiku:F2；R3 sonnet:R3-5、haiku:R3-11 | 中 |
| P7 | 7 小圈：外圍圓心距 r·√3/2、半徑 0.52r；4 等分：子圓心 (±0.5r', ±0.5r')、半徑 0.72r' | R1 opus:F1/F2、haiku:F13 | 中 |
| P8 | 評價快取依 §4.4-6 的表（整筆決定、Google 暫時失敗不存、沒有座標的查無結果不寫 1 天、搜尋版預設不長期存）；每筆 ttl、`v3:` 升版並清 `v2:` 與壞項目、記憶體快取 5 分鐘、200 筆依 ts 淘汰、金鑰變動才清並作廢進行中查詢；營業狀態改讀附近項目 | R1 sonnet:F10、opus:F5、haiku:F3/F11；R2 opus:R2-F3、sonnet:R2-3、haiku:F6/F14；R3 sonnet:R3-4/R3-6、opus:R3-2、haiku:R3-07/R3-14/R3-15 | 中 |
| P9 | 篩選條件與「評分最高」排序在沒有資料時取消 / disable 並重設；清單 80 家上限與提示（§4.3） | R1 haiku:F4；R2 sonnet:R2-11、haiku:F17 | 中 |
| P10 | 匯入改用 session 物件（§4.5） | R1 haiku:F5 | 中 |
| P11 | 名稱搜尋：有座標時 `maxResultCount: 5` + `places.location` + 150m 內最近；沒有座標時只當 locationBias、名稱優先、標示可能不是同一家（§4.4-1） | R1 haiku:F6；R2 sonnet:R2-9；R3 sonnet:R3-1、opus:R3-5、haiku:R3-05 | 中 |
| P12 | Gemini：每次開啟最多 2 次呼叫；空回應或 JSON 解析失敗也退回只看評論 | R1 haiku:F10；R3 haiku:R3-08 | 低 |
| P13 | 統一的 `samePlace()`；先排序再去重；合併欄位保留較完整者（含 `priceMin`） | R1 sonnet:F9、opus:F7、haiku:F8/F9；R2 opus:R2-F6、sonnet:R2-4、haiku:F5/F11 | 中 |
| P14 | 隨機排序：建立店家時就給 `rnd`（含關鍵字搜尋新增的店） | R1 sonnet:F11、haiku:F12 | 低 |
| P15 | 分享文字對附近的店用 `cat.emoji` | R1 sonnet:F12、opus:F12 | 低 |
| P16 | 類型退回判斷先看 `error.details` 的 fieldViolations，再用精確訊息比對；儲存金鑰時重設（§4.2） | R1 sonnet:F13；R2 sonnet:R2-10 | 低 |
| P17 | Service worker：安裝用 `cache: "reload"`；只快取 `res.ok`；離線 `ignoreSearch` 並退回 `index.html`；修正註解；`CACHE` 版本升級（§2） | R1 sonnet:F8、opus:F9、haiku:F15；R2 haiku:F15 | 低 |
| P18 | 搜尋框 Enter 排除輸入法選字 | R1 sonnet:F16 | 低 |
| P19 | §3 的完整正規化（含 logs.kind 推定、評價快取讀取清理）；JSON 損毀先備份；匯入後清暫存狀態 | R1 sonnet:F15（部分）、opus:F11、haiku:F14；R2 opus:R2-F7、haiku:F16；R3 opus:R3-8 | 低 |
| P20 | `placeCats` 過濾不存在的類型；目前篩選的類型不存在時重設；關鍵字搜尋失敗寫入 `nearbyNotice`（§4.3） | R1 opus:F13；R2 haiku:F13；R3 haiku:R3-13 | 低 |
| P21 | 📍 監聽器明確呼叫 `locate({ force: true })`，定位中不停用 | R1 opus:F14；R2 opus:R2-F10、haiku:F3；R3 haiku:R3-01 | 低 |
| P22 | 「就吃這個」依 §4.1 規則寫 `kind` 並更新店家狀態；店名比對只看店家紀錄 | R1 haiku:F18；R3 opus:R3-6 | 低 |
| P23 | 文案同步：滑軌刻度 NT$、設定頁查詢次數與 📍 說明、README 的 referrer 與評價順序；A3、A4、§5、§7 文件修正 | R1 opus:F15、haiku:F17/F19、sonnet:F10；R2 opus:R2-F9、sonnet:R2-13、haiku:F12 | 低 |

### 第 2 輪新增

| # | 修正 | 來源 | 嚴重度 |
|---|---|---|---|
| P24 | 關鍵字搜尋比對 `latestRequestSeq`（新定位一開始就作廢舊搜尋，不論新定位成敗）；失敗只刪自己的紀錄；沒有 `nearbyCtx` 時直接返回（§4.3） | R2 opus:R2-F5、sonnet:R2-8、haiku:F4；R3 haiku:R3-02 | 中 |
| P25 | 預算：滑軌 1000 不篩選；有 `priceMin` 時用它，否則用等級下限；`mapGooglePlace` 保留 `priceMin`；附近頁價位上限的語意寫明（A4、§4.3） | R2 opus:R2-F11、sonnet:R2-6；R3 opus:R3-7、haiku:R3-09 | 中 |
| P26 | A3 改寫：附近的店以店名比對、0 天不排除，並列入 §8 限制 | R2 sonnet:R2-4、haiku:F7；R3 haiku:R3-15 | 中 |
| P27 | §10 驗證表補齊（V1–V56），標示自動 / 模擬 / 手動，幾何以所屬母圓為準、亂數可注入 | R2 opus:R2-F8、sonnet:R2-5、haiku:F8；R3 sonnet:R3-8、opus:R3-8、haiku:R3-10/R3-15 | 中 |

### 第 3 輪新增

| # | 修正 | 來源 | 嚴重度 |
|---|---|---|---|
| P29 | 金鑰變動時清空 `nearbyCtx` 與原始快取，附近頁可見時立即重查（§4.2） | R3 haiku:R3-04 | 中 |
| P30 | 幫我選的附近卡片標題列顯示評分與營業狀態（A2、§4.1） | R3 opus:R3-1 | 中 |
| P31 | 名詞統一（§3.1）與附近項目欄位定義（§3.4） | R3 haiku:R3-06 | 中 |

不採納：第 1 輪 sonnet:F15 的多分頁 `storage` 事件同步（手機 PWA 罕見，列為已知限制 §8-9 與非目標）。
