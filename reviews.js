"use strict";

// 評價摘要：Google Places API（評分、價位、評論）＋ Gemini（整理好評 / 負評）
// 金鑰另外存，不會被「匯出」帶出去
const KEYS_STORE = "wte-keys";
const REVIEW_CACHE_STORE = "wte-review-cache";
const REVIEW_CACHE_DAYS = 7;
const GEMINI_MODEL = "gemini-3.5-flash-lite";

function getKeys() {
  try { return JSON.parse(localStorage.getItem(KEYS_STORE)) || {}; } catch { return {}; }
}

function setKeys(keys) {
  try { localStorage.setItem(KEYS_STORE, JSON.stringify(keys)); } catch { toast("無法儲存設定"); }
}

const hasGoogleKey = () => !!getKeys().google;

// ---------- 快取 ----------
let reviewCache = (() => {
  try { return JSON.parse(localStorage.getItem(REVIEW_CACHE_STORE)) || {}; } catch { return {}; }
})();

function cacheGet(key) {
  const hit = reviewCache[key];
  return hit && Date.now() - hit.ts < REVIEW_CACHE_DAYS * DAY ? hit.data : null;
}

function cacheSet(key, data) {
  reviewCache[key] = { ts: Date.now(), data };
  // 只留最近 200 筆，避免塞爆 localStorage
  const keys = Object.keys(reviewCache).sort((a, b) => reviewCache[b].ts - reviewCache[a].ts);
  keys.slice(200).forEach((k) => delete reviewCache[k]);
  try { localStorage.setItem(REVIEW_CACHE_STORE, JSON.stringify(reviewCache)); } catch { /* 快取失敗不影響使用 */ }
}

// ---------- Google Places ----------
const GOOGLE_FIELDS = [
  "places.id", "places.displayName", "places.formattedAddress", "places.googleMapsUri",
  "places.rating", "places.userRatingCount", "places.priceLevel", "places.priceRange",
  "places.currentOpeningHours.openNow", "places.reviews",
];

async function googleSearch(body, fields) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": getKeys().google, "X-Goog-FieldMask": fields.join(",") },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error(err.error?.message || "HTTP " + res.status);
    e.status = res.status;
    throw e;
  }
  return (await res.json()).places?.[0] || null;
}

const PRICE_TIER = { PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 3 };

// 把 Google 的價位換成 App 的 $ / $$ / $$$
function googleTier(g) {
  const start = Number(g.priceRange?.startPrice?.units);
  if (start) return start < 150 ? 1 : start < 350 ? 2 : 3;
  return PRICE_TIER[g.priceLevel] || null;
}

// Google 的類型（例如 ramen_restaurant）轉成 guessCategory 能比對的 cuisine
function googleCuisine(type) {
  const t = (type || "").replace(/_restaurant$/, "");
  return { hamburger: "burger", sandwich_shop: "sandwich", fast_food: "burger", breakfast: "breakfast", brunch: "brunch" }[t] || t;
}

// Google 一次最多回 20 家，而且評論多的店會佔掉名額，巷子裡的小店常常排不進去。
// 所以把範圍切成 7 個小圈（中間 1 個、周圍 6 個），每圈各抓最近的 20 家，
// 再加上整個範圍最熱門的 20 家、以及關鍵字「小吃」的搜尋結果
async function googleNearby(lat, lon, radius) {
  const centers = [[lat, lon]];
  const sub = radius >= 400 ? Math.round(radius * 0.5) : radius;
  if (radius >= 400) {
    const d = radius * 0.6, kLon = 111320 * Math.cos((lat * Math.PI) / 180);
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      centers.push([lat + (d * Math.cos(a)) / 111320, lon + (d * Math.sin(a)) / kLon]);
    }
  }
  const jobs = [
    googleNearbyOnce(lat, lon, radius, "POPULARITY"),
    ...centers.map(([a, b]) => googleNearbyOnce(a, b, sub, "DISTANCE")),
    googleTextNearby("小吃", lat, lon, radius, 2),
  ];
  const results = await Promise.allSettled(jobs);
  const ok = results.filter((r) => r.status === "fulfilled").flatMap((r) => r.value);
  if (!ok.length && results.every((r) => r.status === "rejected")) throw results[0].reason;
  return ok;
}

const NEARBY_TYPES = ["restaurant", "meal_takeaway", "cafe", "fast_food_restaurant", "bakery", "food_court", "meal_delivery"];
const NEARBY_TYPES_BASIC = ["restaurant", "meal_takeaway", "cafe"];
let nearbyTypes = NEARBY_TYPES;

async function googleNearbyOnce(lat, lon, radius, rankPreference) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": getKeys().google,
      "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.primaryType,places.formattedAddress,places.googleMapsUri,places.rating,places.userRatingCount,places.priceLevel,places.priceRange,places.currentOpeningHours.openNow",
    },
    body: JSON.stringify({
      includedTypes: nearbyTypes,
      maxResultCount: 20,
      rankPreference,
      languageCode: "zh-TW",
      locationRestriction: { circle: { center: { latitude: lat, longitude: lon }, radius } },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // 萬一 Google 不認得某些類型，就退回基本的三種再試一次
    if (res.status === 400 && nearbyTypes !== NEARBY_TYPES_BASIC) {
      nearbyTypes = NEARBY_TYPES_BASIC;
      return googleNearbyOnce(lat, lon, radius, rankPreference);
    }
    throw new Error(err.error?.message || "HTTP " + res.status);
  }
  return ((await res.json()).places || []).map(mapGooglePlace);
}

function mapGooglePlace(g) {
  return {
    id: "g:" + g.id, gid: g.id,
    name: g.displayName?.text, lat: g.location?.latitude, lon: g.location?.longitude,
    cuisine: googleCuisine(g.primaryType), amenity: "restaurant", addr: g.formattedAddress || "",
    rating: g.rating, count: g.userRatingCount, tier: googleTier(g), mapsUrl: g.googleMapsUri,
    openNow: g.currentOpeningHours?.openNow,
  };
}

// 用關鍵字搜尋附近（像在 Google 地圖輸入「炸雞」），Google 會看菜單、評論和分類，不只看店名
async function googleTextNearby(term, lat, lon, radius, maxPages = 3) {
  const dLat = radius / 111320, dLon = radius / (111320 * Math.cos((lat * Math.PI) / 180));
  const out = [];
  let pageToken;
  for (let page = 0; page < maxPages; page++) {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": getKeys().google,
        "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.primaryType,places.formattedAddress,places.googleMapsUri,places.rating,places.userRatingCount,places.priceLevel,places.priceRange,places.currentOpeningHours.openNow,nextPageToken",
      },
      body: JSON.stringify({
        textQuery: term, languageCode: "zh-TW", regionCode: "TW", pageSize: 20,
        locationRestriction: { rectangle: { low: { latitude: lat - dLat, longitude: lon - dLon }, high: { latitude: lat + dLat, longitude: lon + dLon } } },
        ...(pageToken ? { pageToken } : {}),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || "HTTP " + res.status);
    }
    const data = await res.json();
    out.push(...(data.places || []).map(mapGooglePlace));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

// 已知 Google place id 時直接查詳細資料，不用再搜尋
async function googleDetails(gid, withSummary) {
  const fields = GOOGLE_FIELDS.map((f) => f.replace(/^places\./, ""));
  if (withSummary) fields.push("reviewSummary");
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(gid)}?languageCode=zh-TW`, {
    headers: { "X-Goog-Api-Key": getKeys().google, "X-Goog-FieldMask": fields.join(",") },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error(err.error?.message || "HTTP " + res.status);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

async function googleLookup(p) {
  if (p.gid) {
    try { return await googleDetails(p.gid, true); }
    catch (e) { if (e.status === 400) return googleDetails(p.gid, false); throw e; }
  }
  const body = { textQuery: p.name, languageCode: "zh-TW", regionCode: "TW", maxResultCount: 1 };
  const center = p.lat != null ? { latitude: p.lat, longitude: p.lon } : lastPosition;
  if (center) body.locationBias = { circle: { center, radius: 500 } };
  try {
    // 有些地區或專案還沒開放 Google 的評論摘要欄位，失敗就退回不帶它
    return await googleSearch(body, [...GOOGLE_FIELDS, "places.reviewSummary"]);
  } catch (e) {
    if (e.status === 400) return googleSearch(body, GOOGLE_FIELDS);
    throw e;
  }
}

// ---------- Gemini：餐廳情報（評價重點、實用資訊、菜單價格） ----------
const INTEL_RULES = `你幫使用者決定要不要去一家餐廳。只輸出一個 JSON 物件，不要有其他文字，格式：
{
  "good": ["好評重點，最多 3 點"],
  "bad": ["負評重點，最多 3 點，沒有就給空陣列"],
  "tips": ["實用資訊，最多 2 點，例如排隊時間、要不要訂位、付款方式、低消、停車"],
  "menu": [{"name": "品項或套餐名稱", "price": 220, "note": "內容或份量，可留空", "source": "來源名稱", "date": "YYYY-MM-DD 或 YYYY-MM"}],
  "per_person": 250,
  "per_person_basis": "這個人均花費是根據什麼估的"
}
規則：
1. 好評、負評、實用資訊都要具體，寫出實際的菜名、口味、份量、等待時間、價格或環境狀況，每點 30 字以內。
   好的例子：「牛肉麵湯頭偏甜、牛腱軟嫩」「週末晚上排隊約 40 分鐘」「小菜一盤 40 元偏貴」「只收現金」。
   不要寫「好吃」「服務好」「CP 值高」這種沒有細節的話。
2. menu 最多 6 項，招牌餐點和套餐組合優先。price 是新台幣數字。
3. 價格只能來自你找到的來源或提供的評論，絕對不能猜。找不到價格的品項不要列。
4. 每個價格都要寫 source（例如 Uber Eats、foodpanda、店家官網、部落格名稱、Google 評論）和 date（那份菜單或文章、評論的日期；真的不知道就寫 "未知"）。同一品項有多個來源時用最新的。
5. 只寫這一家店（看地址）的資訊，不要跟同名的其他分店搞混；連鎖店用官方菜單時在 note 註明「官方價格，各店可能不同」。
6. per_person 是一般一個人吃一餐大約花多少錢，沒有根據就給 null。`;

function reviewDate(r) {
  return (r.publishTime || "").slice(0, 10) || r.relativePublishTimeDescription || "日期不明";
}

function buildIntelPrompt(name, g, reviews, withSearch) {
  const lines = [
    `餐廳：${name}`,
    g.formattedAddress ? `地址：${g.formattedAddress}` : "",
    g.rating ? `Google 評分：${g.rating}（${g.userRatingCount || 0} 則評論）` : "",
    g.reviewSummary?.text?.text ? `Google 的評論摘要：${g.reviewSummary.text.text}` : "",
    "",
    "最新的幾則 Google 評論：",
    ...reviews.map((r, i) => `評論 ${i + 1}（${r.rating ?? "?"} 星，${reviewDate(r)}）：${(r.text?.text || r.originalText?.text || "").slice(0, 800)}`),
    "",
    withSearch
      ? "請用 Google 搜尋找這家店的菜單和價格（外送平台、店家官網或粉專、近期的部落格或新聞），以及更多實際評價，再整理。"
      : "沒有辦法上網搜尋，只能根據上面的評論整理；評論裡沒提到價格就讓 menu 留空。",
  ];
  return lines.filter((l, i) => l !== "" || i > 0).join("\n");
}

async function geminiCall(body) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": getKeys().gemini },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || "HTTP " + res.status);
  }
  return res.json();
}

function parseJSONLoose(text) {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("AI 回傳的格式不正確");
  return JSON.parse(text.slice(a, b + 1));
}

function cleanList(arr, n) {
  return (Array.isArray(arr) ? arr : []).map((s) => String(s).trim()).filter(Boolean).slice(0, n);
}

function cleanMenu(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map((m) => ({
      name: String(m.name || "").trim(),
      price: Math.round(Number(m.price)),
      note: String(m.note || "").trim(),
      source: String(m.source || "").trim() || "來源不明",
      date: String(m.date || "").trim() || "未知",
    }))
    .filter((m) => m.name && m.price > 0)
    .slice(0, 6);
}

// 菜單日期：取有標日期的來源中最新的一個
function latestDate(menu) {
  const ds = menu.map((m) => m.date).filter((d) => /^\d{4}-\d{2}/.test(d)).sort();
  return ds.length ? ds[ds.length - 1] : null;
}

async function geminiIntel(name, g, reviews) {
  const make = (withSearch) => ({
    systemInstruction: { parts: [{ text: INTEL_RULES }] },
    contents: [{ role: "user", parts: [{ text: buildIntelPrompt(name, g, reviews, withSearch) }] }],
    ...(withSearch ? { tools: [{ google_search: {} }] } : { generationConfig: { responseMimeType: "application/json" } }),
  });
  let data, searched = true, searchError = null;
  try {
    data = await geminiCall(make(true));
  } catch (e) {
    // 免費方案不能用 Google 搜尋，就退回只看評論
    console.warn("Gemini 搜尋失敗，改成只用評論", e);
    searched = false;
    searchError = e.message;
    data = await geminiCall(make(false));
  }
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join("");
  if (!text) return null;
  const json = parseJSONLoose(text);
  const meta = cand.groundingMetadata || {};
  const sources = (meta.groundingChunks || []).map((c) => c.web).filter((w) => w?.uri).slice(0, 5).map((w) => ({ uri: w.uri, title: w.title || w.uri }));
  const menu = cleanMenu(json.menu);
  return {
    good: cleanList(json.good, 3), bad: cleanList(json.bad, 3), tips: cleanList(json.tips, 2),
    menu, menuAsOf: latestDate(menu),
    perPerson: Number(json.per_person) > 0 ? Math.round(Number(json.per_person)) : null,
    perPersonBasis: String(json.per_person_basis || "").trim(),
    searched, searchError, sources,
    // Google 規定使用搜尋結果時要顯示它提供的搜尋建議
    searchHtml: meta.searchEntryPoint?.renderedContent || "",
  };
}

// 沒有 Gemini key 時：直接節錄最高分與最低分的評論
function excerptSummary(reviews) {
  const withText = reviews.filter((r) => (r.text?.text || "").trim());
  if (!withText.length) return null;
  const sorted = [...withText].sort((a, b) => (b.rating || 0) - (a.rating || 0));
  const clip = (r) => { const t = r.text.text.replace(/\s+/g, " ").trim(); return t.length > 70 ? t.slice(0, 70) + "…" : t; };
  const best = sorted[0], worst = sorted[sorted.length - 1];
  return {
    good: best.rating >= 4 ? [`${clip(best)}（${reviewDate(best)}）`] : [],
    bad: worst !== best && worst.rating <= 3 ? [`${clip(worst)}（${reviewDate(worst)}）`] : [],
  };
}

// ---------- 對外：取得一家店的評價資訊 ----------
const CACHE_VERSION = "v2:";
const inflight = new Map();

function getPlaceInfo(p) {
  const key = CACHE_VERSION + (p.id || p.name);
  const cached = cacheGet(key);
  if (cached) return Promise.resolve(cached);
  if (!inflight.has(key)) {
    inflight.set(key, (async () => {
      try {
        const g = await googleLookup(p);
        if (!g) return { notFound: true };
        const reviews = g.reviews || [];
        const info = {
          name: g.displayName?.text,
          rating: g.rating, count: g.userRatingCount,
          priceLevel: g.priceLevel, priceRange: g.priceRange,
          openNow: g.currentOpeningHours?.openNow,
          mapsUrl: g.googleMapsUri,
          fetchedAt: Date.now(),
        };
        let intel = null;
        if (getKeys().gemini) {
          try { intel = await geminiIntel(info.name || p.name, g, reviews); }
          catch (e) { console.warn("Gemini 整理失敗", e); info.aiError = e.message; }
        }
        if (intel) {
          Object.assign(info, intel);
          info.source = intel.searched ? "Gemini 整理自 Google 評論與網路搜尋" : "Gemini 整理自 Google 評論";
        } else if (g.reviewSummary?.text?.text) {
          info.summaryText = g.reviewSummary.text.text;
          info.source = "Google 評論摘要";
        } else if (reviews.length) {
          Object.assign(info, excerptSummary(reviews) || {});
          info.source = "Google 評論節錄";
        }
        cacheSet(key, info);
        return info;
      } finally {
        inflight.delete(key);
      }
    })());
  }
  return inflight.get(key);
}

// ---------- 畫面 ----------
const PRICE_LEVEL = {
  PRICE_LEVEL_FREE: "免費", PRICE_LEVEL_INEXPENSIVE: "$", PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$", PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
};

function priceText(info) {
  const r = info.priceRange;
  if (r?.startPrice?.units) {
    const end = r.endPrice?.units ? `–${r.endPrice.units}` : "+";
    return `NT$${r.startPrice.units}${end}`;
  }
  return PRICE_LEVEL[info.priceLevel] || "";
}

function dateText(d) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(d || "");
  if (!m) return d || "日期不明";
  return m[3] ? `${m[1]}/${Number(m[2])}/${Number(m[3])}` : `${m[1]} 年 ${Number(m[2])} 月`;
}

function listBlock(cls, head, items) {
  if (!items?.length) return "";
  return `<div class="review ${cls}"><div class="rv-head">${head}</div><ul>${items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>`;
}

function menuHTML(info) {
  if (!info.menu?.length) {
    if (!info.good && !info.bad) return "";
    return `<div class="menu-box"><div class="mi-src">🍽️ 找不到有標價格的菜單${info.searched === false ? "（目前只能看評論，開啟 Gemini 付費方案後可以上網搜尋菜單）" : ""}</div></div>`;
  }
  const asOf = info.menuAsOf ? `參考 ${dateText(info.menuAsOf)} 的資料` : "資料日期不明";
  return `<details class="menu-box" open>
    <summary>🍽️ 餐點參考價 <span class="menu-asof">（${esc(asOf)}，現場可能已調整）</span></summary>
    ${info.menu.map((m) => `<div class="menu-item">
      <div class="mi-main">${esc(m.name)}${m.note ? `<div class="mi-note">${esc(m.note)}</div>` : ""}<div class="mi-src">${esc(m.source)} · ${esc(dateText(m.date))}</div></div>
      <div class="mi-price">NT$${m.price}</div>
    </div>`).join("")}
  </details>`;
}

function reviewHTML(info) {
  if (info.notFound) return `<div class="gplace-meta">Google 上找不到這家店</div>`;
  const meta = [];
  if (info.rating) meta.push(`<span class="star">★ ${info.rating.toFixed(1)}</span>（${(info.count || 0).toLocaleString()}）`);
  const price = priceText(info);
  if (price) meta.push(esc(price));
  if (info.openNow === true) meta.push(`<span class="open">營業中</span>`);
  if (info.openNow === false) meta.push(`<span class="closed">休息中</span>`);
  let html = `<div class="gplace-meta">${meta.join(" · ")}</div>`;
  if (info.perPerson) {
    html += `<div class="per-person">💰 一人約 <b>NT$${info.perPerson}</b>${info.perPersonBasis ? `<span class="muted small">（${esc(info.perPersonBasis)}）</span>` : ""}</div>`;
  }
  if (info.summaryText) html += `<div class="review">${esc(info.summaryText)}</div>`;
  html += listBlock("good", "👍 好評", info.good);
  html += listBlock("bad", "👎 負評", info.bad);
  html += listBlock("tip", "💡 去之前知道", info.tips);
  html += menuHTML(info);
  if (info.source) html += `<div class="review-src">${esc(info.source)}${info.fetchedAt ? `・${esc(dateText(new Date(info.fetchedAt).toISOString().slice(0, 10)))} 查詢` : ""}</div>`;
  if (info.aiError) html += `<div class="review-src">⚠️ AI 整理失敗：${esc(info.aiError)}</div>`;
  if (info.sources?.length) {
    html += `<div class="sources">來源：${info.sources.map((s) => `<a href="${esc(s.uri)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join("、")}</div>`;
  }
  if (info.searchHtml) html += `<iframe class="search-suggest" sandbox="allow-popups allow-popups-to-escape-sandbox" title="Google 搜尋建議"></iframe>`;
  return html;
}

// 把評價填進卡片裡的 .gplace 區塊
function fillReview(el, p) {
  if (!el || !hasGoogleKey()) return;
  el.innerHTML = `<div class="gplace-meta">⏳ 讀取評價${getKeys().gemini ? "、搜尋菜單（約 10 秒）" : ""}…</div>`;
  getPlaceInfo(p)
    .then((info) => {
      if (!el.isConnected) return;
      el.innerHTML = reviewHTML(info);
      const frame = el.querySelector(".search-suggest");
      if (frame) frame.srcdoc = info.searchHtml;
    })
    .catch((e) => { if (el.isConnected) el.innerHTML = `<div class="gplace-meta">⚠️ 讀取評價失敗：${esc(e.message)}</div>`; });
}

// ---------- 設定 ----------
$("#save-keys-btn").addEventListener("click", () => {
  setKeys({ google: $("#key-google").value.trim(), gemini: $("#key-gemini").value.trim() });
  // 換了金鑰就清掉舊的評價快取，讓之前失敗的店可以重新查
  reviewCache = {};
  try { localStorage.removeItem(REVIEW_CACHE_STORE); } catch { /* 忽略 */ }
  toast("設定已儲存");
});

(() => {
  const k = getKeys();
  $("#key-google").value = k.google || "";
  $("#key-gemini").value = k.gemini || "";
})();
