# 今天吃什麼

幫你決定要吃什麼的手機網頁 App（PWA），可以加到手機主畫面當 App 用。

## 功能

- **幫我選**：從「料理類型」或「口袋名單」中，依預算抽 3 個選項；會避開最近吃過的，越久沒吃的越容易被抽到
- **附近**：定位後列出附近餐廳（資料來自 OpenStreetMap，不需要 API key），可篩選類型、隱藏吃過的、隨機抽 3 家
- **口袋名單**：存自己的餐廳；也可以修改或隱藏內建的料理類型
- **紀錄**：每次「就吃這個」都會記下來，可匯出 / 匯入備份

資料只存在瀏覽器的 localStorage，不會上傳到任何地方。

## 本機執行

```bash
python -m http.server 8765 --directory what-to-eat
```

打開 http://localhost:8765 。

> 手機上要用定位功能必須走 HTTPS（localhost 例外），所以手機實際使用時需要部署到 HTTPS 網址，例如 GitHub Pages。

## 檔案

| 檔案 | 說明 |
|---|---|
| `index.html` | 頁面結構 |
| `styles.css` | 樣式（支援深色模式） |
| `app.js` | 主要邏輯 |
| `data.js` | 內建料理類型庫 |
| `sw.js` | Service worker（離線快取） |
| `manifest.json` | PWA 設定 |
