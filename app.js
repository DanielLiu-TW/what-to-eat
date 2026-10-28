"use strict";

// ---------- 儲存 ----------
const STORE_KEY = "wte-v1";
const DAY = 24 * 60 * 60 * 1000;

const defaultState = () => ({
  catOverrides: {},       // 內建類型的修改 { id: { name, emoji, price, hidden } }
  customCategories: [],   // 自訂類型
  places: [],             // 口袋名單 { id, name, categoryId, price, note, status: "want" | "been", url }
  logs: [],               // 飲食紀錄 { id, ts, name, emoji, categoryId, placeId }
  settings: { source: "nearby", budget: 300, avoidDays: 3, radius: 800, hideVisited: true, onlyWant: false, nearbyFine: true },
});

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      const d = defaultState();
      return { ...d, ...s, settings: { ...d.settings, ...(s.settings || {}) } };
    }
  } catch (e) { /* 讀不到就用預設 */ }
  return defaultState();
}

let state = loadState();

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast("無法儲存資料（瀏覽器可能是私密模式）"); }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---------- 小工具 ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

function daysAgoText(ts) {
  if (ts == null) return "還沒吃過";
  const d = Math.floor((startOfDay(Date.now()) - startOfDay(ts)) / DAY);
  if (d <= 0) return "今天吃過";
  if (d === 1) return "昨天吃過";
  return `${d} 天前吃過`;
}

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function mapsSearchUrl(query) {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(query);
}

function setSeg(container, value) {
  $$(`${container} button`).forEach((b) => b.classList.toggle("on", b.dataset.v === String(value)));
}

// ---------- 類型 ----------
function allCategories({ includeHidden = false } = {}) {
  const builtin = BUILTIN_CATEGORIES.map((c) => ({ ...c, builtin: true, ...(state.catOverrides[c.id] || {}) }));
  const list = [...builtin, ...state.customCategories.map((c) => ({ kw: [c.name], osm: [], ...c }))];
  return includeHidden ? list : list.filter((c) => !c.hidden);
}

function categoryById(id) {
  return allCategories({ includeHidden: true }).find((c) => c.id === id);
}

// 從店名或 OSM cuisine 推測類型
function guessCategory(name, cuisine) {
  const cuisines = (cuisine || "").toLowerCase().split(/[;,]\s*/).filter(Boolean);
  const cats = allCategories({ includeHidden: true });
  return (
    cats.find((c) => (c.kw || []).some((k) => k.length >= 2 && name.includes(k))) ||
    cats.find((c) => (c.osm || []).some((o) => cuisines.includes(o))) ||
    null
  );
}

// ---------- 紀錄 ----------
function lastEatenCategory(catId) {
  let last = null;
  for (const l of state.logs) {
    if (l.categoryId === catId && (last == null || l.ts > last)) last = l.ts;
  }
  return last;
}

function lastEatenPlace(place) {
  let last = null;
  for (const l of state.logs) {
    if ((l.placeId === place.id || l.name === place.name) && (last == null || l.ts > last)) last = l.ts;
  }
  return last;
}

function addLog({ name, emoji, categoryId = null, placeId = null }) {
  const place = placeId ? state.places.find((p) => p.id === placeId) : state.places.find((p) => p.name === name);
  if (place) {
    place.status = "been";
    placeId = place.id;
  }
  state.logs.push({ id: uid(), ts: Date.now(), name, emoji, categoryId, placeId });
  save();
  renderLog();
  toast(`已記錄：${emoji || "🍽️"} ${name}，吃飽愉快！`);
}

// ---------- 幫我選 ----------
let pickRejected = new Set();
let pickShown = [];

// 預算滑軌：價位區間的下限低於預算就算在範圍內；拉到最右邊是不限
const BUDGET_MAX = 1000;
const TIER_MIN = { 1: 0, 2: 150, 3: 350 };

function inBudget(tier) {
  const b = state.settings.budget;
  return b >= BUDGET_MAX || (TIER_MIN[tier] ?? 0) < b;
}

function budgetText(b) {
  return b >= BUDGET_MAX ? "不限" : `NT$ ${b} 以內`;
}

function lastEatenName(name) {
  let last = null;
  for (const l of state.logs) if (l.name === name && (last == null || l.ts > last)) last = l.ts;
  return last;
}

function pickPool() {
  const { source, avoidDays } = state.settings;
  const cutoff = avoidDays > 0 ? startOfDay(Date.now()) - (avoidDays - 1) * DAY : Infinity;
  const wantNames = new Set(state.places.filter((p) => p.status === "want").map((p) => p.name));
  const items =
    source === "nearby"
      ? (nearbyPlaces || []).map((p) => {
          const last = lastEatenName(p.name);
          // 不知道價位的店先當作在預算內
          return { kind: "nearby", key: p.id, item: p, price: p.tier || p.cat?.price || 1, last, fresh: last == null, want: wantNames.has(p.name) };
        })
      : source === "category"
      ? allCategories().map((c) => ({ kind: "category", key: c.id, item: c, price: c.price, last: lastEatenCategory(c.id) }))
      : state.places
          .filter((p) => !state.settings.onlyWant || p.status === "want")
          .map((p) => ({ kind: "place", key: p.id, item: p, price: p.price, last: lastEatenPlace(p), want: p.status === "want" }));
  return items.filter((x) => inBudget(Number(x.price)) && !pickRejected.has(x.key) && !(x.last != null && x.last >= cutoff));
}

// 越久沒吃的權重越高，沒吃過的最高；想吃清單裡的店加倍；附近沒去過的新店再加重
function weight(x) {
  const days = x.last == null ? 30 : Math.min(30, (Date.now() - x.last) / DAY);
  return (1 + days / 10) * (x.want ? 2 : 1) * (x.kind === "nearby" && x.fresh ? 3 : 1);
}

function placeMapsUrl(p) {
  return p.url || mapsSearchUrl(p.name);
}

function weightedSample(pool, n, exclude = new Set()) {
  const cand = pool.filter((x) => !exclude.has(x.key));
  const out = [];
  while (out.length < n && cand.length) {
    const total = cand.reduce((s, x) => s + weight(x), 0);
    let r = Math.random() * total;
    let i = 0;
    for (; i < cand.length - 1; i++) {
      r -= weight(cand[i]);
      if (r <= 0) break;
    }
    out.push(cand.splice(i, 1)[0]);
  }
  return out;
}

async function doPick(reroll = false) {
  if (reroll) pickShown.forEach((x) => pickRejected.add(x.key));
  if (state.settings.source === "nearby" && !nearbyPlaces) {
    const btn = $("#pick-btn");
    btn.disabled = true;
    $("#pick-actions").classList.add("hidden");
    try {
      await loadNearby((msg) => { $("#pick-results").innerHTML = `<div class="empty">${esc(msg)}</div>`; });
    } catch (e) {
      return showPickEmpty("⚠️ " + e.message);
    } finally {
      btn.disabled = false;
    }
    if (!nearbyPlaces.length) return showPickEmpty("附近沒有找到店家，試試到「附近」放大範圍");
  }
  const pool = pickPool();
  if (state.settings.source === "place" && !state.places.length)
    return showPickEmpty("口袋名單還是空的，先到「口袋名單」新增，或從 Google 地圖、照片匯入吧！");
  if (!pool.length) {
    if (pickRejected.size) {
      pickRejected = new Set();
      toast("全部看過一輪了，重新開始");
      return doPick(false);
    }
    return showPickEmpty("沒有符合條件的選項，試試放寬預算或「避開天數」");
  }
  pickShown = weightedSample(pool, 3);
  renderPick();
}

function showPickEmpty(msg) {
  pickShown = [];
  $("#pick-results").innerHTML = `<div class="empty">${esc(msg)}</div>`;
  $("#pick-actions").classList.add("hidden");
}

function rejectOne(key) {
  pickRejected.add(key);
  const idx = pickShown.findIndex((x) => x.key === key);
  const pool = pickPool();
  const [next] = weightedSample(pool, 1, new Set(pickShown.map((x) => x.key)));
  if (next) pickShown.splice(idx, 1, next);
  else pickShown.splice(idx, 1);
  renderPick();
}

function renderPick() {
  const box = $("#pick-results");
  box.innerHTML = pickShown
    .map((x) => {
      if (x.kind === "nearby") {
        const p = x.item;
        const meta = [p.cat ? p.cat.name : AMENITY_LABEL[p.amenity] || "餐廳", `${p.dist}m`, x.fresh ? "" : daysAgoText(x.last)].filter(Boolean);
        return `<div class="card" data-key="${esc(x.key)}">
          <div class="card-head">
            <div class="card-emoji">${esc(p.cat?.emoji || "🍽️")}</div>
            <div class="card-title">${esc(p.name)}${x.fresh ? '<span class="badge">沒去過</span>' : ""}${x.want ? '<span class="badge">想吃</span>' : ""}<div class="card-meta">${esc(meta.join(" · "))}</div></div>
            <button class="card-close" data-act="reject" aria-label="不想吃">✕</button>
          </div>
          <div class="gplace"></div>
          <div class="card-btns">
            <button class="go" data-act="eat">✓ 就吃這家</button>
            <a href="${esc(nearbyMapsUrl(p))}" target="_blank" rel="noopener">🗺️ 地圖</a>
            <button data-act="save">＋ 口袋</button>
          </div>
        </div>`;
      }
      if (x.kind === "category") {
        const c = x.item;
        return `<div class="card" data-key="${esc(x.key)}">
          <div class="card-head">
            <div class="card-emoji">${esc(c.emoji)}</div>
            <div class="card-title">${esc(c.name)}<div class="card-meta">${priceTag(c.price)} · ${daysAgoText(x.last)}</div></div>
            <button class="card-close" data-act="reject" aria-label="不想吃">✕</button>
          </div>
          <div class="card-btns">
            <button class="go" data-act="eat">✓ 就吃這個</button>
            <button data-act="nearby">📍 附近有嗎</button>
            <a href="${mapsSearchUrl(c.name)}" target="_blank" rel="noopener">🗺️ Google</a>
          </div>
        </div>`;
      }
      const p = x.item;
      const c = categoryById(p.categoryId);
      return `<div class="card" data-key="${esc(x.key)}">
        <div class="card-head">
          <div class="card-emoji">${esc(c?.emoji || "🍽️")}</div>
          <div class="card-title">${esc(p.name)}${x.want ? '<span class="badge">想吃</span>' : ""}<div class="card-meta">${esc(c?.name || "未分類")} · ${priceTag(p.price)} · ${daysAgoText(x.last)}${p.note ? " · " + esc(p.note) : ""}</div></div>
          <button class="card-close" data-act="reject" aria-label="不想吃">✕</button>
        </div>
        <div class="card-btns">
          <button class="go" data-act="eat">✓ 就吃這家</button>
          <a href="${esc(placeMapsUrl(p))}" target="_blank" rel="noopener">🗺️ 地圖</a>
        </div>
      </div>`;
    })
    .join("");
  $("#pick-actions").classList.toggle("hidden", !pickShown.length);
  for (const x of pickShown) {
    const el = box.querySelector(`.card[data-key="${CSS.escape(x.key)}"] .gplace`);
    if (x.kind === "nearby") fillReview(el, x.item);
  }
}

$("#pick-results").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const key = btn.closest(".card").dataset.key;
  const x = pickShown.find((s) => s.key === key);
  if (!x) return;
  const act = btn.dataset.act;
  if (act === "reject") rejectOne(key);
  else if (act === "save") savePlaceFromNearby(x.item);
  else if (act === "eat") {
    if (x.kind === "nearby") addLog({ name: x.item.name, emoji: x.item.cat?.emoji, categoryId: x.item.cat?.id || null });
    else if (x.kind === "category") addLog({ name: x.item.name, emoji: x.item.emoji, categoryId: x.item.id });
    else addLog({ name: x.item.name, emoji: categoryById(x.item.categoryId)?.emoji, categoryId: x.item.categoryId, placeId: x.item.id });
    pickShown = [];
    pickRejected = new Set();
    renderPick();
  } else if (act === "nearby") {
    nbFilter.cat = x.item.id;
    nbFilter.q = "";
    $("#nearby-filter").value = "";
    nearbyRandom = null;
    switchTab("nearby");
    // 還沒定位的話，switchTab 會自動定位，定位完會接著搜尋這個類型
    if (nearbyPlaces) { renderNearby(); searchCategoryNearby(x.item.id); }
  }
});

$("#pick-btn").addEventListener("click", (e) => {
  // 骰子轉一圈的小動畫
  const btn = e.currentTarget;
  btn.classList.remove("rolling");
  void btn.offsetWidth;
  btn.classList.add("rolling");
  pickRejected = new Set();
  doPick();
});
$("#reroll-btn").addEventListener("click", () => doPick(true));

$("#share-btn").addEventListener("click", async () => {
  const lines = pickShown.map((x, i) => {
    const emoji = x.kind === "category" ? x.item.emoji : categoryById(x.item.categoryId)?.emoji || "🍽️";
    return `${i + 1}. ${emoji} ${x.item.name}`;
  });
  const text = `今天吃什麼？幫我選一個 👇\n${lines.join("\n")}`;
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); toast("已複製，貼給朋友吧！"); }
  } catch (e) { /* 使用者取消分享 */ }
});

$("#pick-source").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.settings.source = b.dataset.v;
  setSeg("#pick-source", b.dataset.v);
  $("#only-want-row").classList.toggle("hidden", b.dataset.v !== "place");
  save();
  if (pickShown.length) { pickRejected = new Set(); doPick(); }
});

$("#budget").addEventListener("input", (e) => {
  state.settings.budget = Number(e.target.value);
  $("#budget-value").textContent = budgetText(state.settings.budget);
});
$("#budget").addEventListener("change", save);

$("#avoid-days").addEventListener("change", (e) => {
  state.settings.avoidDays = Number(e.target.value);
  save();
});

$("#only-want").addEventListener("change", (e) => {
  state.settings.onlyWant = e.target.checked;
  save();
});

// ---------- 附近 ----------
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const AMENITY_LABEL = { restaurant: "餐廳", fast_food: "速食 / 小吃", food_court: "美食街", cafe: "咖啡 / 早午餐" };

let nearbyPlaces = null; // 最近一次查詢的結果
let nearbyRandom = null; // 隨機抽出的 3 家（null = 顯示全部）

function distance(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("這個瀏覽器不支援定位"));
    navigator.geolocation.getCurrentPosition(resolve, (err) => {
      const msg = { 1: "定位權限被拒絕，請到瀏覽器設定允許位置存取", 2: "目前無法取得位置", 3: "定位逾時，再試一次" }[err.code];
      reject(new Error(msg || "定位失敗"));
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  });
}

async function fetchOverpass(lat, lon, radius) {
  const q = `[out:json][timeout:25];
nwr["amenity"~"^(restaurant|fast_food|food_court|cafe)$"]["name"](around:${radius},${lat},${lon});
out center tags 400;`;
  let lastErr;
  for (const url of OVERPASS_ENDPOINTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: ctrl.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("查詢附近店家失敗（" + (lastErr?.message || "網路錯誤") + "），稍後再試");
}

let lastPosition = null; // { latitude, longitude }

async function nearbyFromOverpass(lat, lon) {
  const data = await fetchOverpass(lat, lon, state.settings.radius);
  return data.elements.map((el) => {
    const t = el.tags || {};
    const plat = el.lat ?? el.center?.lat, plon = el.lon ?? el.center?.lon;
    const addr = [t["addr:city"], t["addr:district"], t["addr:street"], t["addr:housenumber"] && t["addr:housenumber"] + "號"].filter(Boolean).join("");
    return { id: el.type + el.id, name: t["name:zh"] || t.name, lat: plat, lon: plon, cuisine: t.cuisine || "", amenity: t.amenity, addr };
  });
}

// 定位並抓附近的店，結果放在 nearbyPlaces。有 Google key 先用 Google，失敗再用 OpenStreetMap
// 合併 Google 與 OpenStreetMap：同一家店（同名，或 40m 內名字互相包含）只留 Google 的
function mergeSources(google, osm) {
  const out = [...google];
  for (const o of osm) {
    if (!o.name || o.lat == null) continue;
    const dup = google.some((g) =>
      g.name === o.name ||
      ((g.name.includes(o.name) || o.name.includes(g.name)) && distance(g.lat, g.lon, o.lat, o.lon) < 40));
    if (!dup) out.push(o);
  }
  return out;
}

let nearbyRawCache = null; // 上次 Google 查到的原始結果

async function loadNearby(onStatus = () => {}, { force = false } = {}) {
  if (force) nearbyRawCache = null;
  onStatus("📡 定位中…");
  const pos = await getPosition();
  const { latitude: lat, longitude: lon } = pos.coords;
  lastPosition = { latitude: lat, longitude: lon };
  onStatus("🔎 搜尋附近的店…");
  let raw = null, googleErr = null;
  // 15 分鐘內在差不多的位置（150m 內）、同樣範圍重新定位，直接用上次的結果，省 API 額度
  const c = nearbyRawCache;
  if (c && Date.now() - c.ts < 15 * 60 * 1000 && c.radius === state.settings.radius && distance(c.lat, c.lon, lat, lon) < 150) {
    raw = c.raw;
  } else if (hasGoogleKey()) {
    // Google 和 OpenStreetMap 同時查，有些巷子裡的小店只有其中一邊有。
    // OpenStreetMap 的伺服器常常很慢，最多等 10 秒，沒回來就算了
    const osm = Promise.race([nearbyFromOverpass(lat, lon), new Promise((r) => setTimeout(() => r([]), 10000))]).catch(() => []);
    try { raw = await googleNearby(lat, lon, state.settings.radius, { fine: state.settings.nearbyFine }); }
    catch (e) { googleErr = e; console.warn("Google 附近搜尋失敗，改用 OpenStreetMap", e); }
    const osmPlaces = await osm;
    if (raw) {
      raw = mergeSources(raw, osmPlaces);
      nearbyRawCache = { ts: Date.now(), lat, lon, radius: state.settings.radius, raw };
    } else if (osmPlaces.length) raw = osmPlaces;
  }
  if (!raw) {
    try { raw = await nearbyFromOverpass(lat, lon); }
    catch (e) {
      throw new Error(googleErr ? `Google 和 OpenStreetMap 都查詢失敗（${googleErr.message}）` : e.message + "。可以到「紀錄」設定 Google Maps API key，查詢會更穩定");
    }
  }
  const seen = new Set();
  const maxDist = state.settings.radius * 1.05;
  nearbyPlaces = raw
    .filter((p) => p.name && p.lat != null && !seen.has(p.name) && seen.add(p.name))
    .map((p) => ({ ...p, dist: Math.round(distance(lat, lon, p.lat, p.lon)), cat: guessCategory(p.name, p.cuisine) }))
    .filter((p) => p.dist <= maxDist)
    .sort((a, b) => a.dist - b.dist);
  nearbyRandom = null;
  renderNearby();
}

let locating = null; // 定位中的 Promise，避免重複定位

function locate() {
  if (locating) return locating;
  const btn = $("#locate-btn");
  const status = $("#nearby-status");
  btn.disabled = true;
  $("#nearby-list").innerHTML = "";
  locating = (async () => {
    try {
      await loadNearby((msg) => { status.textContent = msg; });
      nbSearched.clear();
      // 正在看某個類型時，換了位置或範圍要重新搜尋
      if (nbFilter.cat && nbFilter.cat !== "_other") searchCategoryNearby(nbFilter.cat);
    } catch (e) {
      status.textContent = "⚠️ " + e.message;
    } finally {
      btn.disabled = false;
      locating = null;
    }
  })();
  return locating;
}

function savePlaceFromNearby(p) {
  if (state.places.some((x) => x.name === p.name)) return toast("已經在口袋名單裡了");
  openEdit("place", null, { name: p.name, categoryId: p.cat?.id || "", price: p.tier || p.cat?.price || 2, note: p.addr, status: "want" });
}

// 篩選條件（「沒去過」記在設定裡，其他只在這次使用）
const nbFilter = { q: "", cat: null, sort: "distance", price: 0, open: false, rating: false };

let visitedCache = null;
function visitedNames() {
  return (visitedCache ||= new Set(state.logs.map((l) => l.name)));
}

function nbMatches(p, { skipCat = false } = {}) {
  const f = nbFilter;
  if (state.settings.hideVisited && visitedNames().has(p.name)) return false;
  if (f.price) {
    const tier = p.tier || p.cat?.price;
    if (tier && tier > f.price) return false;
  }
  if (f.open && p.openNow !== true) return false;
  if (f.rating && !(p.rating >= 4)) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    const hit = [p.name, p.cuisine, p.cat?.name || ""].some((s) => s.toLowerCase().includes(q)) || p.matchQ?.includes(f.q);
    if (!hit) return false;
  }
  if (!skipCat && f.cat) {
    if (f.cat === "_other" ? placeCats(p).length : !placeCats(p).includes(f.cat)) return false;
  }
  return true;
}

// 一家店可能屬於好幾類：店名猜出來的類型，加上用 Google 關鍵字搜尋找到的類型
function placeCats(p) {
  const ids = p.matchCats ? [...p.matchCats] : [];
  if (p.cat && !ids.includes(p.cat.id)) ids.unshift(p.cat.id);
  return ids;
}

// ---------- 關鍵字搜尋附近（補足一般附近搜尋只抓得到 40 家的問題） ----------
const nbSearched = new Map(); // 搜過的關鍵字 → Promise

function categoryTerms(cat) {
  return cat.name.split("/").map((s) => s.trim()).filter(Boolean).slice(0, 2);
}

function mergeNearby(found, tag) {
  if (!lastPosition) return 0;
  const { latitude: lat, longitude: lon } = lastPosition;
  const byKey = new Map(nearbyPlaces.map((p) => [p.gid || p.name, p]));
  let added = 0;
  for (const f of found) {
    if (!f.name || f.lat == null) continue;
    const dist = Math.round(distance(lat, lon, f.lat, f.lon));
    if (dist > state.settings.radius * 1.05) continue; // 搜尋範圍是方形，把角落的去掉
    let p = byKey.get(f.gid || f.name) || nearbyPlaces.find((x) => x.name === f.name);
    if (!p) {
      p = { ...f, dist, cat: guessCategory(f.name, f.cuisine) };
      nearbyPlaces.push(p);
      byKey.set(f.gid || f.name, p);
      added++;
    }
    if (tag.cat) (p.matchCats ||= []).includes(tag.cat) || p.matchCats.push(tag.cat);
    if (tag.q) (p.matchQ ||= []).includes(tag.q) || p.matchQ.push(tag.q);
  }
  return added;
}

async function searchNearbyTerms(terms, tag, label) {
  if (!hasGoogleKey() || !lastPosition || !nearbyPlaces) return;
  const key = JSON.stringify([terms, state.settings.radius, lastPosition]);
  if (!nbSearched.has(key)) {
    const { latitude: lat, longitude: lon } = lastPosition;
    nbSearched.set(key, (async () => {
      $("#nearby-status").textContent = `🔎 在 Google 搜尋附近的「${label}」…`;
      // 第一個關鍵字多翻幾頁，第二個（例如「鹹酥雞」）翻一頁
      const results = await Promise.allSettled(terms.map((t, i) => googleTextNearby(t, lat, lon, state.settings.radius, i === 0 ? 3 : 1)));
      const found = results.filter((r) => r.status === "fulfilled").flatMap((r) => r.value);
      if (!found.length && results.some((r) => r.status === "rejected")) throw results.find((r) => r.status === "rejected").reason;
      mergeNearby(found, tag);
    })().catch((e) => { nbSearched.delete(key); toast("搜尋失敗：" + e.message); }));
  }
  await nbSearched.get(key);
  renderNearby();
}

function searchCategoryNearby(catId) {
  const cat = categoryById(catId);
  if (cat) return searchNearbyTerms(categoryTerms(cat), { cat: catId }, cat.name);
}

function nearbyFiltered() {
  if (!nearbyPlaces) return [];
  visitedCache = null;
  const items = nearbyPlaces.filter((p) => nbMatches(p));
  if (nbFilter.sort === "rating") items.sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.dist - b.dist);
  else if (nbFilter.sort === "random") items.sort((a, b) => a.rnd - b.rnd);
  else items.sort((a, b) => a.dist - b.dist);
  return items;
}

function nearbyMapsUrl(p) {
  if (p.mapsUrl) return p.mapsUrl;
  return mapsSearchUrl(p.addr ? `${p.name} ${p.addr}` : `${p.lat},${p.lon}`);
}

function renderNearbyChips() {
  visitedCache = null;
  // 沒有資料的條件（例如 OpenStreetMap 沒有評分）就不顯示
  const has = (k) => !!nearbyPlaces?.some((p) => p[k] != null);
  $$("#nb-chips [data-toggle]").forEach((b) => {
    const k = b.dataset.toggle;
    b.classList.toggle("on", k === "fresh" ? state.settings.hideVisited : nbFilter[k]);
    if (k === "open") b.classList.toggle("hidden", !has("openNow"));
    if (k === "rating") b.classList.toggle("hidden", !has("rating"));
  });
  $('#nb-sort option[value="rating"]').hidden = !has("rating");
  $("#nb-sort").parentElement.classList.toggle("on", nbFilter.sort !== "distance");
  $("#nb-price").parentElement.classList.toggle("on", nbFilter.price > 0);

  // 類型標籤：依目前其他條件下的店家數排序
  const box = $("#nb-cats");
  if (!nearbyPlaces?.length) { box.innerHTML = ""; return; }
  const counts = new Map();
  let other = 0, total = 0;
  for (const p of nearbyPlaces) {
    if (!nbMatches(p, { skipCat: true })) continue;
    total++;
    const ids = placeCats(p);
    ids.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
    if (!ids.length) other++;
  }
  // 從「幫我選」帶過來的類型就算附近沒有也要顯示，才知道是在篩它
  if (nbFilter.cat && nbFilter.cat !== "_other" && !counts.has(nbFilter.cat)) counts.set(nbFilter.cat, 0);
  const chip = (id, label, n) =>
    `<button class="chip ${nbFilter.cat === id ? "on" : ""}" data-cat="${esc(id ?? "")}">${esc(label)} <span class="cnt">${n}</span></button>`;
  // 最後放一個下拉選單，可以選任何類型去 Google 搜尋（附近一開始沒抓到的類型也找得到）
  const more = hasGoogleKey()
    ? `<span class="chip chip-select"><select id="nb-more" aria-label="搜尋其他類型"><option value="">🔍 其他類型</option>${
        allCategories().map((c) => `<option value="${esc(c.id)}">${esc(`${c.emoji} ${c.name}`)}</option>`).join("")
      }</select></span>`
    : "";
  box.innerHTML =
    chip(null, "全部", total) +
    [...counts].sort((a, b) => b[1] - a[1]).map(([id, n]) => { const c = categoryById(id); return chip(id, `${c.emoji} ${c.name}`, n); }).join("") +
    (other ? chip("_other", "其他", other) : "") +
    more;
}

function renderNearby() {
  const status = $("#nearby-status");
  const list = $("#nearby-list");
  if (!nearbyPlaces) return;
  renderNearbyChips();
  const items = nearbyFiltered();
  status.textContent = nearbyPlaces.length
    ? (nearbyRandom ? `從 ${items.length} 家裡抽出 ${Math.min(3, items.length)} 家` : `符合 ${items.length} 家`)
    : "這個範圍內沒有找到店家，試試放大範圍";
  $("#nearby-random-btn").classList.toggle("hidden", !items.length);
  $("#nearby-all-btn").classList.toggle("hidden", !nearbyRandom);
  // 保底：直接開 Google 地圖搜尋同樣的東西
  const term = nbFilter.q || (nbFilter.cat && nbFilter.cat !== "_other" ? categoryTerms(categoryById(nbFilter.cat))[0] : "");
  const hint = $("#nb-gmaps");
  hint.classList.toggle("hidden", !term);
  if (term) {
    hint.href = lastPosition
      ? `https://www.google.com/maps/search/${encodeURIComponent(term)}/@${lastPosition.latitude},${lastPosition.longitude},16z`
      : mapsSearchUrl(term);
    hint.textContent = `🗺️ 在 Google 地圖看附近的「${term}」`;
  }

  let shown = items;
  if (nearbyRandom) {
    const ids = new Set(items.map((p) => p.id));
    shown = nearbyRandom.filter((p) => ids.has(p.id));
  }
  if (!items.length && nearbyPlaces.length) {
    list.innerHTML = `<div class="empty">沒有符合的店，試試取消一些條件</div>`;
    return;
  }
  const showInfoBtn = hasGoogleKey() && !nearbyRandom;
  const visited = visitedNames();
  list.innerHTML = shown.slice(0, 80).map((p) => {
    // 正在篩某個類型時，顯示那個類型（例如用「炸雞」搜到的小吃店就標炸雞）
    const ids = placeCats(p);
    const cat = nbFilter.cat && ids.includes(nbFilter.cat) ? categoryById(nbFilter.cat) : p.cat || (ids[0] && categoryById(ids[0]));
    const meta = [cat ? cat.name : AMENITY_LABEL[p.amenity] || "餐廳", p.dist + "m"];
    if (!cat && p.cuisine && !p.gid) meta.splice(1, 0, p.cuisine);
    if (p.tier || p.priceText) meta.push(priceTag(p.tier, p.priceText));
    const stats = [];
    if (p.rating) stats.push(`<span class="star">★ ${p.rating.toFixed(1)}</span>`);
    if (p.openNow === true) stats.push(`<span class="open">營業中</span>`);
    if (p.openNow === false) stats.push(`<span class="closed">休息中</span>`);
    return `<div class="card" data-id="${esc(p.id)}">
      <div class="card-head">
        <div class="card-emoji">${esc(cat?.emoji || "🍽️")}</div>
        <div class="card-title">${esc(p.name)}${visited.has(p.name) ? '<span class="badge been">吃過</span>' : ""}<div class="card-meta">${esc(meta.join(" · "))}${stats.length ? ` · ${stats.join(" · ")}` : ""}</div></div>
        ${showInfoBtn ? `<button class="card-more" data-act="review">評價<br>菜單</button>` : ""}
      </div>
      <div class="gplace"></div>
      <div class="card-btns">
        <button class="go" data-act="eat">✓ 就吃這家</button>
        <a href="${esc(nearbyMapsUrl(p))}" target="_blank" rel="noopener">🗺️ 地圖</a>
        <button data-act="save">＋ 口袋</button>
      </div>
    </div>`;
  }).join("");
  // 抽出的 3 家自動載入評價與菜單；完整清單則按按鈕才載入，避免浪費 API 額度
  if (nearbyRandom) shown.forEach((p) => fillReview(list.querySelector(`.card[data-id="${CSS.escape(p.id)}"] .gplace`), p));
}

$("#nearby-list").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const p = nearbyPlaces.find((x) => x.id === btn.closest(".card").dataset.id);
  if (!p) return;
  if (btn.dataset.act === "eat") {
    addLog({ name: p.name, emoji: p.cat?.emoji, categoryId: p.cat?.id || null });
    renderNearby();
  } else if (btn.dataset.act === "save") {
    savePlaceFromNearby(p);
  } else if (btn.dataset.act === "review") {
    fillReview(btn.closest(".card").querySelector(".gplace"), p);
    btn.remove();
  }
});

function updateNearby() {
  nearbyRandom = null;
  renderNearby();
}

$("#locate-btn").addEventListener("click", locate);
$("#nearby-fine").addEventListener("change", (e) => {
  state.settings.nearbyFine = e.target.checked;
  nearbyRawCache = null; // 換了精細度，下次定位要重查
  save();
});
$("#nearby-filter").addEventListener("input", (e) => { nbFilter.q = e.target.value.trim(); updateNearby(); });
// 按 Enter（手機鍵盤的「搜尋」）時用 Google 搜尋附近，找名字裡沒有關鍵字的店
$("#nearby-filter").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.target.blur();
  const q = nbFilter.q;
  if (q.length >= 1) searchNearbyTerms([q], { q }, q);
});
$("#nb-chips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-toggle]");
  if (!b) return;
  const k = b.dataset.toggle;
  if (k === "fresh") { state.settings.hideVisited = !state.settings.hideVisited; save(); }
  else nbFilter[k] = !nbFilter[k];
  updateNearby();
});
$("#nb-cats").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cat]");
  if (!b) return;
  const id = b.dataset.cat || null;
  nbFilter.cat = nbFilter.cat === id ? null : id;
  updateNearby();
  if (nbFilter.cat && nbFilter.cat !== "_other") searchCategoryNearby(nbFilter.cat);
});
$("#nb-cats").addEventListener("change", (e) => {
  if (e.target.id !== "nb-more" || !e.target.value) return;
  nbFilter.cat = e.target.value;
  updateNearby();
  searchCategoryNearby(nbFilter.cat);
});
$("#nb-radius").addEventListener("change", (e) => {
  state.settings.radius = Number(e.target.value);
  save();
  if (nearbyPlaces) locate();
});
$("#nb-sort").addEventListener("change", (e) => {
  nbFilter.sort = e.target.value;
  if (nbFilter.sort === "random") nearbyPlaces?.forEach((p) => { p.rnd = Math.random(); });
  updateNearby();
});
$("#nb-price").addEventListener("change", (e) => { nbFilter.price = Number(e.target.value); updateNearby(); });
$("#nearby-random-btn").addEventListener("click", () => {
  const items = [...nearbyFiltered()];
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  nearbyRandom = items.slice(0, 3);
  renderNearby();
  window.scrollTo(0, 0);
});
$("#nearby-all-btn").addEventListener("click", updateNearby);

// ---------- 口袋名單 / 類型管理 ----------
let listMode = "place";

function renderList() {
  const box = $("#list-items");
  $("#import-row").classList.toggle("hidden", listMode !== "place");
  if (listMode === "place") {
    if (!state.places.length) {
      box.innerHTML = `<div class="empty">還沒有餐廳<br>把常去的、想去的店加進來，<br>或從 Google 地圖、照片匯入，<br>「幫我選」就能從這裡抽！</div>`;
      return;
    }
    const item = (p) => {
      const c = categoryById(p.categoryId);
      return `<button class="list-item" data-id="${esc(p.id)}">
        <span class="li-emoji">${esc(c?.emoji || "🍽️")}</span>
        <span class="li-main"><div class="li-title">${esc(p.name)}</div><div class="li-sub">${esc(c?.name || "未分類")} · ${priceTag(p.price)}${p.note ? " · " + esc(p.note) : ""}</div></span>
        <span class="li-right">${p.status === "want" ? "" : daysAgoText(lastEatenPlace(p))}</span>
      </button>`;
    };
    const want = state.places.filter((p) => p.status === "want");
    const been = state.places.filter((p) => p.status !== "want").sort((a, b) => (lastEatenPlace(b) || 0) - (lastEatenPlace(a) || 0));
    box.innerHTML =
      (want.length ? `<div class="section-head">🆕 想吃（${want.length}）</div>` + want.map(item).join("") : "") +
      (been.length ? `<div class="section-head">✅ 吃過（${been.length}）</div>` + been.map(item).join("") : "");
  } else {
    box.innerHTML =
      `<p class="muted small">點一下可以修改價位或隱藏不想出現的類型。</p>` +
      allCategories({ includeHidden: true })
        .map((c) => `<button class="list-item ${c.hidden ? "off" : ""}" data-id="${esc(c.id)}">
          <span class="li-emoji">${esc(c.emoji)}</span>
          <span class="li-main"><div class="li-title">${esc(c.name)}${c.hidden ? "（已隱藏）" : ""}</div><div class="li-sub">${priceTag(c.price)}${c.builtin ? "" : " · 自訂"}</div></span>
          <span class="li-right">${daysAgoText(lastEatenCategory(c.id))}</span>
        </button>`)
        .join("");
  }
}

$("#list-mode").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  listMode = b.dataset.v;
  setSeg("#list-mode", listMode);
  renderList();
});

$("#list-items").addEventListener("click", (e) => {
  const item = e.target.closest(".list-item");
  if (item) openEdit(listMode, item.dataset.id);
});

$("#add-btn").addEventListener("click", () => openEdit(listMode, null));

// 編輯對話框
const dlg = $("#edit-dialog");
const form = $("#edit-form");
let editing = null; // { kind, id }

function openEdit(kind, id, preset = {}) {
  editing = { kind, id };
  const isPlace = kind === "place";
  const existing = id ? (isPlace ? state.places.find((p) => p.id === id) : categoryById(id)) : null;
  const v = { name: "", emoji: "", categoryId: "", price: 2, note: "", status: "want", ...preset, ...(existing || {}) };

  $("#edit-title").textContent = (id ? "編輯" : "新增") + (isPlace ? "餐廳" : "料理類型");
  $("#cat-row").classList.toggle("hidden", !isPlace);
  $("#status-row").classList.toggle("hidden", !isPlace);
  form.status.value = v.status === "want" ? "want" : "been";
  $("#note-row").classList.toggle("hidden", !isPlace);
  $("#emoji-row").classList.toggle("hidden", isPlace);

  form.categoryId.innerHTML =
    `<option value="">未分類</option>` +
    allCategories({ includeHidden: true }).map((c) => `<option value="${esc(c.id)}">${esc(c.emoji + " " + c.name)}</option>`).join("");
  form.name.value = v.name;
  form.emoji.value = v.emoji;
  form.categoryId.value = v.categoryId || "";
  form.price.value = String(v.price);
  form.note.value = v.note || "";

  const del = $("#delete-btn");
  del.classList.toggle("hidden", !existing);
  del.textContent = existing?.builtin ? (existing.hidden ? "恢復顯示" : "隱藏") : "刪除";
  dlg.showModal();
}

// 選類型時自動帶入該類型的價位
form.categoryId.addEventListener("change", () => {
  const c = categoryById(form.categoryId.value);
  if (c) form.price.value = String(c.price);
});

form.addEventListener("submit", (e) => {
  if (e.submitter?.value !== "ok" || !editing) return;
  const { kind, id } = editing;
  const name = form.name.value.trim();
  if (!name) return;
  const price = Number(form.price.value);
  if (kind === "place") {
    const data = { name, categoryId: form.categoryId.value || null, price, note: form.note.value.trim(), status: form.status.value };
    if (id) Object.assign(state.places.find((p) => p.id === id), data);
    else state.places.push({ id: uid(), ...data });
  } else {
    const emoji = form.emoji.value.trim() || "🍽️";
    const builtin = BUILTIN_CATEGORIES.find((c) => c.id === id);
    if (builtin) state.catOverrides[id] = { ...(state.catOverrides[id] || {}), name, emoji, price };
    else if (id) Object.assign(state.customCategories.find((c) => c.id === id), { name, emoji, price });
    else state.customCategories.push({ id: "c-" + uid(), name, emoji, price });
  }
  save();
  renderList();
  toast("已儲存");
});

$("#delete-btn").addEventListener("click", () => {
  const { kind, id } = editing;
  if (kind === "place") {
    if (!confirm("確定要從口袋名單刪除？")) return;
    state.places = state.places.filter((p) => p.id !== id);
  } else if (BUILTIN_CATEGORIES.some((c) => c.id === id)) {
    const o = state.catOverrides[id] || {};
    state.catOverrides[id] = { ...o, hidden: !o.hidden };
  } else {
    if (!confirm("確定要刪除這個類型？")) return;
    state.customCategories = state.customCategories.filter((c) => c.id !== id);
  }
  save();
  editing = null;
  dlg.close("cancel");
  renderList();
});

// ---------- 紀錄 ----------
function renderLog() {
  const box = $("#log-items");
  if (!state.logs.length) {
    box.innerHTML = `<div class="empty">還沒有紀錄<br>選好要吃什麼後按「就吃這個」就會記在這裡</div>`;
    return;
  }
  const logs = [...state.logs].sort((a, b) => b.ts - a.ts).slice(0, 200);
  let html = "", lastDay = null;
  for (const l of logs) {
    const day = startOfDay(l.ts);
    if (day !== lastDay) {
      const d = new Date(l.ts);
      const label = day === startOfDay(Date.now()) ? "今天" : day === startOfDay(Date.now() - DAY) ? "昨天" : `${d.getMonth() + 1}/${d.getDate()}（${"日一二三四五六"[d.getDay()]}）`;
      html += `<div class="day-head">${label}</div>`;
      lastDay = day;
    }
    const t = new Date(l.ts);
    const cat = l.categoryId ? categoryById(l.categoryId) : null;
    html += `<div class="list-item">
      <span class="li-emoji">${esc(l.emoji || "🍽️")}</span>
      <span class="li-main"><div class="li-title">${esc(l.name)}</div><div class="li-sub">${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}${cat && cat.name !== l.name ? " · " + esc(cat.name) : ""}</div></span>
      <button class="li-del" data-id="${esc(l.id)}" aria-label="刪除紀錄">✕</button>
    </div>`;
  }
  box.innerHTML = html;
}

$("#log-items").addEventListener("click", (e) => {
  const b = e.target.closest(".li-del");
  if (!b || !confirm("刪除這筆紀錄？")) return;
  state.logs = state.logs.filter((l) => l.id !== b.dataset.id);
  save();
  renderLog();
});

$("#export-btn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `吃什麼備份-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$("#import-btn").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.logs) || !Array.isArray(data.places)) throw new Error();
    if (!confirm("匯入會覆蓋目前的資料，確定嗎？")) return;
    const d = defaultState();
    state = { ...d, ...data, settings: { ...d.settings, ...(data.settings || {}) } };
    save();
    initUI();
    toast("匯入完成");
  } catch {
    toast("檔案格式不正確");
  } finally {
    e.target.value = "";
  }
});

// ---------- 分頁 ----------
const TAB_TITLES = { pick: "今天吃什麼？", nearby: "附近有什麼", list: "口袋名單", log: "吃過的紀錄" };

// 依時段問候，例如「午安 · 午餐想吃什麼？」
function mealGreeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 10) return "早安 ☀️ · 早餐吃什麼好？";
  if (h >= 10 && h < 14) return "午安 🍱 · 午餐時間到了";
  if (h >= 14 && h < 17) return "下午好 ☕ · 來點下午茶？";
  if (h >= 17 && h < 21) return "晚安 🌆 · 晚餐想吃什麼？";
  return "夜深了 🌙 · 宵夜吃點什麼？";
}

const TAB_SUBS = {
  nearby: () => "找找身邊沒去過的店",
  list: () => `想吃 ${state.places.filter((p) => p.status === "want").length} 家 · 吃過 ${state.places.filter((p) => p.status !== "want").length} 家`,
  log: () => `已經記錄 ${state.logs.length} 餐`,
};

function switchTab(tab) {
  $$(".tab").forEach((s) => s.classList.toggle("active", s.id === "tab-" + tab));
  $$(".tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  $("#page-title").textContent = TAB_TITLES[tab];
  $("#page-sub").textContent = tab === "pick" ? mealGreeting() : TAB_SUBS[tab]();
  if (tab === "list") renderList();
  if (tab === "log") renderLog();
  // 第一次進「附近」自動定位
  if (tab === "nearby" && !nearbyPlaces) locate();
  window.scrollTo(0, 0);
}

$(".tabbar").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) switchTab(b.dataset.tab);
});

// ---------- 初始化 ----------
function initUI() {
  const s = state.settings;
  setSeg("#pick-source", s.source);
  $("#budget").value = String(s.budget);
  $("#budget-value").textContent = budgetText(s.budget);
  $("#avoid-days").value = String(s.avoidDays);
  $("#only-want").checked = s.onlyWant;
  $("#only-want-row").classList.toggle("hidden", s.source !== "place");
  $("#nb-radius").value = String(s.radius);
  $("#nearby-fine").checked = s.nearbyFine;
  renderList();
  renderLog();
}

initUI();
$("#page-sub").textContent = mealGreeting();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
