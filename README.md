# 今天吃什麼

幫你決定要吃什麼的手機網頁 App（PWA），可以加到手機主畫面當 App 用。

網址：https://danielliu-tw.github.io/what-to-eat/

## 功能

- **幫我選**：用滑軌設定每人預算，從「附近的店」、「料理類型」或「口袋名單」抽 3 個選項
  - 附近的店會優先推薦沒去過的；避開最近幾天吃過的；口袋名單裡「想吃」的店機率加倍
  - 設定 Google key 後，每個選項會顯示評分、價位、營業狀態與好評 / 負評摘要
- **附近**：定位後列出附近餐廳。上方是可左右滑的篩選標籤（範圍、排序、價位、沒去過、營業中、★4 以上），下方是依附近店家自動產生的料理類型標籤
- **餐廳情報**（需要 Gemini key）：具體的好評 / 負評 / 實用資訊、一人大約花費，以及餐點參考價。每個價格都標示來源與日期，因為餐廳會漲價
- **口袋名單**：分成「想吃」和「吃過」；吃過一次就會自動移到「吃過」
  - 📥 從 Google 地圖匯入（Google Takeout 的「已儲存」清單）→ 想吃
  - 📷 從照片匯入（讀取照片的 GPS 位置與拍攝時間，找出那裡的餐廳）→ 吃過，並補上飲食紀錄
- **紀錄**：每次「就吃這個」都會記下來，可匯出 / 匯入備份

## 資料來源與 API key（選填）

| 功能 | 沒有 key | 有 key |
|---|---|---|
| 附近的店 | OpenStreetMap（免費，但伺服器偶爾很慢或掛掉） | Google Places（較穩定，含評分與價位） |
| 評價摘要 | 不顯示 | Google 評論摘要；沒有時用 Gemini 整理，再不行就節錄評論 |

- **Google Maps API key**：在 Google Cloud Console 建立專案、啟用「Places API (New)」並建立 API key。建議把 key 限制為只允許 `https://danielliu-tw.github.io/*` 這個網址使用
- **Gemini API key**（選填）：在 Google AI Studio 建立。用 `gemini-3.5-flash-lite` 整理評論
  - 免費方案：只能根據 Google 評論整理（內容會被 Google 用於改進產品）
  - 付費方案：可以用 Google 搜尋找菜單和價格，每月前 5,000 次搜尋免費，之後每 1,000 次 14 美元

金鑰只存在瀏覽器的 localStorage，不會被「匯出備份」帶出去。所有資料都只存在你的裝置上。

## 本機執行

```bash
python -m http.server 8765
```

打開 http://localhost:8765 。手機上要用定位功能必須走 HTTPS（localhost 例外）。

## 檔案

| 檔案 | 說明 |
|---|---|
| `index.html` | 頁面結構 |
| `styles.css` | 樣式（支援深色模式） |
| `app.js` | 主要邏輯：抽選、附近、口袋名單、紀錄 |
| `reviews.js` | Google Places 查詢、評價摘要（Gemini） |
| `import.js` | Google 地圖與照片匯入 |
| `data.js` | 內建料理類型庫 |
| `sw.js` | Service worker（離線快取） |
| `manifest.json` | PWA 設定 |
