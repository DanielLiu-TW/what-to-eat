"use strict";

// 評價摘要：Google Places API（評分、價位、評論）＋ Claude（整理好評 / 負評）
// 金鑰另外存，不會被「匯出」帶出去
const KEYS_STORE = "wte-keys";
const REVIEW_CACHE_STORE = "wte-review-cache";
const REVIEW_CACHE_DAYS = 7;
const CLAUDE_SDK = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.129.0/+esm";
const CLAUDE_MODEL = "claude-opus-5-5";

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

// Google 一次最多回 20 家：最近的、最熱門的各查一次再合併
async function googleNearby(lat, lon, radius) {
  const results = await Promise.allSettled(["DISTANCE", "POPULARITY"].map((rank) => googleNearbyOnce(lat, lon, radius, rank)));
  const ok = results.filter((r) => r.status === "fulfilled").flatMap((r) => r.value);
  if (!ok.length && results.every((r) => r.status === "rejected")) throw results[0].reason;
  return ok;
}

async function googleNearbyOnce(lat, lon, radius, rankPreference) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": getKeys().google,
      "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.primaryType,places.formattedAddress,places.googleMapsUri,places.rating,places.userRatingCount,places.priceLevel,places.priceRange",
    },
    body: JSON.stringify({
      includedTypes: ["restaurant", "meal_takeaway", "cafe"],
      maxResultCount: 20,
      rankPreference,
      languageCode: "zh-TW",
      locationRestriction: { circle: { center: { latitude: lat, longitude: lon }, radius } },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || "HTTP " + res.status);
  }
  return ((await res.json()).places || []).map((g) => ({
    id: "g:" + g.id, gid: g.id,
    name: g.displayName?.text, lat: g.location?.latitude, lon: g.location?.longitude,
    cuisine: googleCuisine(g.primaryType), amenity: "restaurant", addr: g.formattedAddress || "",
    rating: g.rating, count: g.userRatingCount, tier: googleTier(g), mapsUrl: g.googleMapsUri,
  }));
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

// ---------- Claude 摘要 ----------
let claudeClient = null;

async function getClaude() {
  if (!claudeClient) {
    const { default: Anthropic } = await import(CLAUDE_SDK);
    // 金鑰只存在使用者自己的瀏覽器裡，所以允許從瀏覽器直接呼叫
    claudeClient = new Anthropic({ apiKey: getKeys().claude, dangerouslyAllowBrowser: true });
  }
  return claudeClient;
}

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    good: { type: "array", items: { type: "string" }, description: "好評重點，最多 3 點" },
    bad: { type: "array", items: { type: "string" }, description: "負評重點，最多 3 點；沒有就給空陣列" },
  },
  required: ["good", "bad"],
  additionalProperties: false,
};

async function claudeSummarize(name, reviews) {
  const client = await getClaude();
  const text = reviews
    .map((r, i) => `評論 ${i + 1}（${r.rating ?? "?"} 星）：${(r.text?.text || r.originalText?.text || "").slice(0, 800)}`)
    .join("\n\n");
  const res = await client.beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SUMMARY_SCHEMA } },
    system: "你幫使用者快速判斷要不要去一家餐廳。根據提供的 Google 評論，用繁體中文整理好評和負評的重點。每點 20 字以內，具體描述（例如「湯頭濃郁」、「假日要排 30 分鐘」），不要空泛的形容。只根據評論內容，不要自己編造。",
    messages: [{ role: "user", content: `餐廳：${name}\n\n${text}` }],
  });
  if (res.stop_reason === "refusal") return null;
  const block = res.content.find((b) => b.type === "text");
  if (!block) return null;
  const out = JSON.parse(block.text);
  return { good: out.good.slice(0, 3), bad: out.bad.slice(0, 3) };
}

// 沒有 Claude key 時：直接節錄最高分與最低分的評論
function excerptSummary(reviews) {
  const withText = reviews.filter((r) => (r.text?.text || "").trim());
  if (!withText.length) return null;
  const sorted = [...withText].sort((a, b) => (b.rating || 0) - (a.rating || 0));
  const clip = (r) => { const t = r.text.text.replace(/\s+/g, " ").trim(); return t.length > 70 ? t.slice(0, 70) + "…" : t; };
  const best = sorted[0], worst = sorted[sorted.length - 1];
  return {
    good: best.rating >= 4 ? [clip(best)] : [],
    bad: worst !== best && worst.rating <= 3 ? [clip(worst)] : [],
  };
}

// ---------- 對外：取得一家店的評價資訊 ----------
const inflight = new Map();

function getPlaceInfo(p) {
  const key = p.id || p.name;
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
        };
        if (g.reviewSummary?.text?.text) {
          info.summaryText = g.reviewSummary.text.text;
          info.source = "Google 評論摘要";
        }
        if (!info.summaryText && reviews.length) {
          let s = null;
          if (getKeys().claude) {
            try { s = await claudeSummarize(info.name || p.name, reviews); info.source = "AI 整理自 Google 評論"; }
            catch (e) { console.warn("Claude 摘要失敗", e); }
          }
          if (!s) { s = excerptSummary(reviews); info.source = "Google 評論節錄"; }
          if (s) Object.assign(info, s);
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

function reviewHTML(info) {
  if (info.notFound) return `<div class="gplace-meta">Google 上找不到這家店</div>`;
  const meta = [];
  if (info.rating) meta.push(`<span class="star">★ ${info.rating.toFixed(1)}</span>（${(info.count || 0).toLocaleString()}）`);
  const price = priceText(info);
  if (price) meta.push(esc(price));
  if (info.openNow === true) meta.push(`<span class="open">營業中</span>`);
  if (info.openNow === false) meta.push(`<span class="closed">休息中</span>`);
  let html = `<div class="gplace-meta">${meta.join(" · ")}</div>`;
  if (info.summaryText) {
    html += `<div class="review">${esc(info.summaryText)}</div>`;
  } else {
    if (info.good?.length) html += `<div class="review good"><div class="rv-head">👍 好評</div><ul>${info.good.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>`;
    if (info.bad?.length) html += `<div class="review bad"><div class="rv-head">👎 負評</div><ul>${info.bad.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>`;
  }
  if (info.source && (info.summaryText || info.good?.length || info.bad?.length)) html += `<div class="review-src">${esc(info.source)}</div>`;
  return html;
}

// 把評價填進卡片裡的 .gplace 區塊
function fillReview(el, p) {
  if (!el || !hasGoogleKey()) return;
  el.innerHTML = `<div class="gplace-meta">⏳ 讀取 Google 評價…</div>`;
  getPlaceInfo(p)
    .then((info) => { if (el.isConnected) el.innerHTML = reviewHTML(info); })
    .catch((e) => { if (el.isConnected) el.innerHTML = `<div class="gplace-meta">⚠️ 讀取評價失敗：${esc(e.message)}</div>`; });
}

// ---------- 設定 ----------
$("#save-keys-btn").addEventListener("click", () => {
  setKeys({ google: $("#key-google").value.trim(), claude: $("#key-claude").value.trim() });
  claudeClient = null;
  toast("設定已儲存");
});

(() => {
  const k = getKeys();
  $("#key-google").value = k.google || "";
  $("#key-claude").value = k.claude || "";
})();
