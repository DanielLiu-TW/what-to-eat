# 設計審查紀錄（panel review）

- 審查對象：`docs/design.md`（描述 commit `b05c631` 的 PWA）
- 小組：opus、sonnet、haiku（fable 在此方案下會退回 opus，故不列入）
- 最多 3 輪；最少 2 份有效審查才給結論
- 模式：審查既有設計（review），不含實作；修程式需使用者另外同意
- 小組成員皆為 Claude 模型，可能有共同盲點：小組通過代表多幾雙眼睛，不是保證

## 第 1 輪：design.md v1

- SHA256：`f3df302fe3f19ace57764a65aa90d6fbebf43693f5e13a0af90cf0cf2e407c72`
- 審查前後 git 狀態相同（只有 `docs/` 未追蹤），審查員沒有改檔

| 審查員 | 結果 | 有效性 | 發現數 |
|---|---|---|---|
| opus | REVISE | 有效（JSON 完整、coverage 非空、有 finding） | 15（中 6、低 9） |
| sonnet | REVISE | 有效 | 16（中 7、低 9） |
| haiku | REVISE | 有效 | 19（高 1、中 5、低 13） |

**合併結論：REVISE**

### 仲裁（依證據決定，不是投票）

| 群組 | 提出者 | 決定 | 理由 | 對應修正 |
|---|---|---|---|---|
| 沒有來源的菜單價格仍顯示 | sonnet:F1、opus:F4、haiku:F1（haiku 評高） | 採納，嚴重度定為中 | `cleanMenu` 補「來源不明」後照樣顯示，違反 A7；屬顯示內容錯誤，不影響資料安全，故不評高 | P1 |
| 定位中改範圍被吞掉、快取標錯範圍、兩組定位並行 | sonnet:F2/F3、opus:F3/F8、haiku:F7 | 採納 | 程式確實在 await 後才讀 `state.settings.radius`，`doPick` 繞過 `locating` | P2 |
| 「幫我選」用過期的附近資料 | sonnet:F4 | 採納 | `nearbyPlaces` 沒有時間戳 | P2 |
| 編輯對話框 Enter 變取消 | sonnet:F5 | 採納 | 已核對 HTML：第一個 submit 按鈕是 value="cancel" | P3 |
| `javascript:` 網址 | sonnet:F14、opus:F6、haiku:F2 | 採納 | Takeout JSON 與備份匯入沒檢查協定，`esc()` 不擋協定 | P4 |
| CDN 無 SRI、共用 origin | sonnet:F6、opus:F10、haiku:F16 | 採納 | 已實際下載兩個檔案算出 sha384 寫入 §7 | P5 |
| Google 失敗時無提示 | sonnet:F7 | 採納 | 只有 console.warn，違反 A9 | P6 |
| 7 小圈與 4 等分幾何有缺口 | opus:F1/F2、haiku:F13 | 採納 | 已用程式驗算：原配置 30° 方向距離 0.566r > 0.5r；新配置最差 0.5 / 0.707，另加餘裕 0.52 / 0.72 | P7 |
| 評價快取把失敗結果存 7 天、存 openNow 與 searchHtml | sonnet:F10、opus:F5、haiku:F3/F11 | 採納 | 程式確實無條件 `cacheSet` | P8 |
| 被隱藏的篩選條件仍生效 | haiku:F4 | 採納 | `renderNearbyChips` 只加 hidden 不改 `nbFilter` | P9 |
| 匯入對話框重開混資料 | haiku:F5 | 採納 | 非同步迴圈讀寫全域 `imp` | P10 |
| 名稱搜尋可能拿到別家分店 | haiku:F6 | 採納 | `maxResultCount: 1` 且不比對位置 | P11 |
| Gemini 空回應 / 解析失敗不重試 | haiku:F10 | 採納 | 只有 fetch 例外才退回 | P12 |
| 名稱去重在排序前、同名分店被丟、`g.name` 未定義 | sonnet:F9、opus:F7、haiku:F8/F9 | 採納 | 程式順序確如所述 | P13 |
| 隨機排序 `rnd` 遺失 | sonnet:F11、haiku:F12 | 採納 | | P14 |
| 分享文字 emoji | sonnet:F12、opus:F12 | 採納 | | P15 |
| `/type/i` 判斷過寬 | sonnet:F13 | 採納 | 錯誤訊息常含 type.googleapis.com | P16 |
| Service worker 快取 404、導覽退路、註解 | sonnet:F8、opus:F9、haiku:F15 | 採納 | | P17 |
| 輸入法 Enter | sonnet:F16 | 採納 | 使用者用注音，影響實際使用 | P18 |
| 備份匯入與載入沒做型別檢查、JSON 損毀直接覆蓋 | sonnet:F15（部分）、opus:F11、haiku:F14 | 採納 | | P19 |
| 自訂類型刪除後附近頁崩潰 | opus:F13 | 採納 | `categoryById` 回傳 undefined 後直接取屬性 | P20 |
| `force` 參數沒人用 | opus:F14 | 採納：📍 強制重查 | | P21 |
| 類型卡片以名稱誤標店家吃過 | haiku:F18 | 採納 | | P22 |
| A3 語意、A4 與實作不一致、刻度沒 NT$、§7 例外沒寫、成本漏評價查詢 | opus:F15、haiku:F17/F19、sonnet:F10 | 採納（文件修正 + 刻度） | A4 保留「下限低於預算」的設計並改寫文字：改用上限比較會讓預算 200 時排除所有 150–350 元的店，不實用 | P23 |
| 多分頁 storage 事件同步 | sonnet:F15 | **不採納** | 手機 PWA 罕見，成本高；列為已知限制與非目標 | — |

- 修訂後：design.md v2，SHA256 `0b7052a7a47a92b377e46bc6ebc294aec99c23d65933c6d647a3402e32116cdf`

## 第 2 輪：design.md v2

- SHA256：`0b7052a7a47a92b377e46bc6ebc294aec99c23d65933c6d647a3402e32116cdf`
- 審查前後 git 狀態相同（只有 `docs/` 未追蹤），審查員沒有改檔
- 簡報中說明：v2 是目標設計，§11 未實作是預期的；附上第 1 輪處置，要求不重提已解決項目

| 審查員 | 結果 | 有效性 | 發現數 |
|---|---|---|---|
| opus | REVISE | 有效 | 11（中 5、低 6） |
| sonnet | REVISE | 有效 | 15（中 4、低 11） |
| haiku | REVISE | 有效 | 17（中 8、低 9） |

**合併結論：REVISE**。三位都沒有重提已處置的第 1 輪項目；新發現集中在「v2 的修正寫得不夠能實作」。

### 仲裁

| 群組 | 提出者 | 決定 | 理由 / 修正 |
|---|---|---|---|
| `locate()` 吞錯、無 force、範圍 handler 在首次定位時不觸發、從幫我選呼叫有 UI 副作用 | opus:R2-F1、sonnet:R2-1、haiku:F3 | 採納 | 已核對 app.js：catch 只寫狀態列、`if (nearbyPlaces) locate()`。定義 `locate({force})` 契約 → P2、P21 |
| 「附近資料 15 分鐘」與「原始快取 15 分鐘」互相抵銷，每次都重查 | opus:R2-F2 | 採納 | 改成先取位置、30 分鐘 / 150m 一致判斷 → P2 |
| 15 分鐘內移動 > 150m 仍用舊資料 | sonnet:R2-15 | 採納 | 同上，並列入 §8-11 |
| 搜尋版結果快取但不顯示搜尋建議 | opus:R2-F3 | 採納 | searchHtml ≤ 8KB 一起快取，否則不快取；實作前核對條款 → P8 |
| 部分失敗寫入 15 分鐘快取；警告被 renderNearby 蓋掉、幫我選看不到 | opus:R2-F4、sonnet:R2-2、haiku:F2 | 採納 | `nearbyNotice` + 部分失敗不寫快取 → P6 |
| lastPosition 與關鍵字搜尋沒有序號保護 | opus:R2-F5、sonnet:R2-8、haiku:F4 | 採納 | `nearbyCtx` + 關鍵字搜尋快照 seq → P2、P24 |
| 去重規則 §4.2-4 與 -6 矛盾；mergeNearby 名稱 fallback；精簡欄位先出現會丟資料 | opus:R2-F6、sonnet:R2-4、haiku:F5/F11 | 採納 | 統一 `samePlace()` 並合併欄位 → P13 |
| A3 的 placeId 對附近的店無法實作 | sonnet:R2-4、haiku:F7 | 採納（改文件） | 附近以店名比對，列入 §8-10 → P26。不新增 gid 欄位：改動資料模型成本高，效益只在同名分店 |
| 正規化沒涵蓋 catOverrides / customCategories 內容、settings 離散值、評價快取 | opus:R2-F7、haiku:F16 | 採納 | §3 完整列出 → P19 |
| §10 驗證表不完整、幾何只取邊緣 | opus:R2-F8、sonnet:R2-5、haiku:F8 | 採納 | 重寫成 V1–V45 → P27。說明：host 的實際驗算已是整個圓盤格點，文件寫法有誤，已更正 |
| 設定頁文案、README、刻度、sw 版本未列入 | opus:R2-F9、sonnet:R2-13、haiku:F12 | 採納 | → P23、P17 |
| P3 取消按鈕改 type=button 會失效；名稱空白靜默關閉 | opus:R2-F10、sonnet:R2-12、haiku:F1 | 採納 | → P3 |
| A4 文字與等級下限不一致 | opus:R2-F11、sonnet:R2-6 | 採納 | 有 Google 實際區間時用區間下限 → P25 |
| 降級成功的 Gemini 結果與空回應被快取 7 天；重繪會重打 API；舊 v2 快取 | sonnet:R2-3、haiku:F6 | 採納 | §4.4-6 快取表、記憶體負快取、v3 升版 → P8 |
| 菜單占位詞與「未知」日期 | sonnet:R2-7、haiku:F10 | 採納 | → P1 |
| 名稱搜尋只取 1 筆 | sonnet:R2-9 | 採納 | → P11 |
| 類型退回判斷方式未定義 | sonnet:R2-10 | 採納 | → P16 |
| 排序選項 hidden 在 iOS 無效；80 筆上限未說明 | sonnet:R2-11、haiku:F17 | 採納 | → P9 |
| safeUrl 對來源連結的退路不合理；P4 沒寫要新增 | sonnet:R2-14、haiku:F9 | 採納 | `safeUrl(url, fallback)` §4.7 → P4 |
| 刪除自訂類型後殘留參照 | haiku:F13 | 採納 | → P20 |
| 清快取規則兩處矛盾；營業狀態改讀哪裡；notFound TTL 需要每筆 ttl | haiku:F14 | 採納 | → P8 |
| sw 安裝階段拿到 HTTP 快取舊檔 | haiku:F15 | 採納 | → P17 |
| §5 頁數寫法與程式不一致 | haiku:F12 | 採納 | §5 改寫 |

- 修訂後：design.md v3，SHA256 `a76a867b5640b7e7f094ca8e47382822bd02ff9d31bae2f20ce3b8163a3e244f`

## 第 3 輪：design.md v3（最後一輪）

- SHA256：`a76a867b5640b7e7f094ca8e47382822bd02ff9d31bae2f20ce3b8163a3e244f`
- 審查前後 git 狀態相同（只有 `docs/` 未追蹤），審查員沒有改檔

| 審查員 | 結果 | 有效性 | 發現數 |
|---|---|---|---|
| opus | REVISE | 有效 | 8（中 1、低 7） |
| sonnet | REVISE | 有效 | 8（高 1、中 3、低 4） |
| haiku | REVISE | 有效 | 15（中 10、低 5） |

**合併結論：REVISE**。三位都確認第 1、2 輪處置已落實，沒有重提；新發現是更細的邊界與文件內部一致性。

### 仲裁

| 群組 | 提出者 | 決定 | 修正 |
|---|---|---|---|
| 口袋名單沒有座標，150m 篩選會把遠處的店判為找不到並快取 1 天 | sonnet:R3-1（高）、opus:R3-5、haiku:R3-05 | 採納，嚴重度定為中（口袋名單卡目前不顯示評價，影響是未來路徑與 OSM 以外的情況） | 有座標才做 150m 篩選；沒座標只當 locationBias、名稱優先、不寫 1 天 → P11 |
| 幫我選附近卡片標題列沒有營業狀態，v3 的前提不成立 | opus:R3-1 | 採納 | → P30 |
| 新鮮度不比對 radius / fine；設定改了但定位失敗時用舊資料 | sonnet:R3-2、haiku:R3-03 | 採納 | `nearbyCtx` 加 fine；不符就重查；定位失敗不抽選 → P2 |
| `nearbyCtx.ts` 語意未定；原始快取存哪裡 | sonnet:R3-3、opus:R3-4 | 採納 | ts = 資料建立時間；只存記憶體 → P2、§3.3 |
| 快取表沒有 Google 暫時失敗；Google 成功 + Gemini 失敗如何存；與 §5 矛盾 | sonnet:R3-4、haiku:R3-07 | 採納 | 快取表整筆決定，新增列 → P8 |
| OSM 逾時被寫入快取；無 key 路徑的 OSM 逾時 | sonnet:R3-5、haiku:R3-11 | 採納 | 原始快取只存 Google；OSM 每次查、統一 10 秒 → P6 |
| 搜尋建議儲存的條款分支未決 | sonnet:R3-6、haiku:R3-14 | 採納 | 預設不長期存搜尋版結果；新增前置項 P28 |
| 取位置失敗時的行為；成功後的類型重搜在哪個呼叫端執行 | sonnet:R3-7、opus:R3-3 | 採納 | §4.1 第 3 點、§4.2 狀態動作 → P2 |
| 驗證表缺 Enter 正向、精細模式價位、附近店名比對、快取清理、換金鑰作廢、亂數不確定、幾何所屬母圓 | sonnet:R3-8、opus:R3-8、haiku:R3-10/R3-15 | 採納 | V1–V56 → P27 |
| 搜尋版解析失敗的快取行為 | opus:R3-2 | 採納 | 快取表 → P8 |
| 類型卡紀錄以名稱誤排除同名店 | opus:R3-6 | 採納 | `logs.kind` → P22、P19 |
| A4 需要數值 priceMin；附近頁價位篩選語意 | opus:R3-7 | 採納 | → P25 |
| 📍 停用與 V42 衝突 | haiku:R3-01 | 採納 | 定位中不停用 → P21 |
| 關鍵字搜尋在新定位完成前的空窗 | haiku:R3-02 | 採納 | 改比對 `latestRequestSeq` → P24 |
| 換金鑰後舊 OSM 資料仍被使用 | haiku:R3-04 | 採納 | → P29 |
| place id / placeId / gid 名詞混用 | haiku:R3-06 | 採納 | §3.1 → P31 |
| Gemini 呼叫次數與 V19 矛盾 | haiku:R3-08 | 採納 | 每次最多 2 次，V22 可計數 → P12 |
| 預算 1000「不限」與下限規則衝突 | haiku:R3-09 | 採納（文件；程式已是 `b >= 1000` 不篩選） | → P25 |
| ok / error 條件 | haiku:R3-12 | 採納 | → P2 |
| 關鍵字搜尋失敗只有 toast | haiku:R3-13 | 採納 | → P20 |
| A3 的 0 天、200 筆淘汰順序、「負快取」用詞 | haiku:R3-15 | 採納 | → P26、P8 |

- 修訂後：design.md v4，SHA256 `9d87edaab177c8a00c57d4ff511135deb590773f30c4c75990f99606841d5388`

## 結論

- **3 輪都沒有通過（皆為 REVISE）**，已達設定的輪數上限，依規則停止，不宣稱通過。
- v4 納入第 3 輪全部採納項目，但 **v4 沒有經過小組審查**。第 3 輪發現的性質已從「功能缺陷」收斂到「邊界情況與文件一致性」，主持者判斷 v4 可以作為實作依據，但這是主持者的判斷，不是小組結論。
- 尚未解決（需要外部資訊，無法靠審查解決）：
  1. P28：Gemini Grounding 條款對儲存搜尋結果的規定（預設保守：不長期存）
  2. Google Places 的 `includedTypes` 清單、錯誤格式、計費層級，以及 `gemini-3.5-flash-lite` 與 `google_search` 工具的實際行為，三位審查員都無法驗證，需要以真實金鑰測試（V12、V16）
- 全程沒有修改任何程式碼；實作需要使用者另外同意。
- 小組成員皆為 Claude 模型，可能有共同盲點。
