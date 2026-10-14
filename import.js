"use strict";

// 匯入口袋名單：Google 地圖（Takeout 匯出）與照片（EXIF 位置）
// 外部函式庫只在需要時才載入
const LIB_JSZIP = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
const LIB_EXIFR = "https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.umd.js";

const libCache = {};
function loadScript(src) {
  return (libCache[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => { delete libCache[src]; reject(new Error("載入函式庫失敗，請確認網路連線")); };
    document.head.appendChild(s);
  }));
}

const impDlg = $("#import-dialog");
let imp = { kind: null, rows: [], running: false, cancelled: false };

const IMPORT_HELP = {
  gmaps: `<ol>
    <li>用電腦打開 <a href="https://takeout.google.com/" target="_blank" rel="noopener">Google Takeout</a></li>
    <li>按「取消全選」，只勾<b>「已儲存」</b>（你建立的清單，例如「想去的地點」）和<b>「地圖（你的地點）」</b>（加星號的地點）</li>
    <li>建立匯出，下載 .zip 檔</li>
    <li>回到這裡選那個 .zip（或解壓縮後的 .csv / .json 檔，可多選）</li>
  </ol><p class="muted">Google 清單裡可能也有景點、商店，匯入前可以取消勾選。匯入的店會放在「想吃」。</p>`,
  photos: `<p>選幾張你拍的食物照片，系統會讀取照片裡的<b>拍攝位置和時間</b>，找出那裡的餐廳，加到「吃過」。</p>
    <p class="muted">照片要有 GPS 位置資訊。從 IG、LINE 存下來的照片通常沒有；手機在選照片時也可能把位置拿掉。如果顯示「沒有位置」，可以改用電腦匯入（把照片傳到電腦後在電腦上選），再用「匯出 / 匯入」把資料搬到手機。</p>`,
};

function openImport(kind) {
  imp = { kind, rows: [], running: false, cancelled: false };
  $("#import-title").textContent = kind === "gmaps" ? "📥 從 Google 地圖匯入" : "📷 從照片匯入";
  $("#import-help").innerHTML = IMPORT_HELP[kind];
  $("#import-help").classList.remove("hidden");
  const input = $("#import-input");
  input.value = "";
  input.accept = kind === "gmaps" ? ".zip,.csv,.json,application/zip,text/csv,application/json" : "image/*";
  $("#import-pick-btn").textContent = kind === "gmaps" ? "選擇 Takeout 檔案" : "選擇照片（可多選）";
  $("#import-pick-btn").classList.remove("hidden");
  $("#import-status").textContent = "";
  $("#import-log-row").classList.toggle("hidden", kind !== "photos");
  renderImportRows();
  impDlg.showModal();
}

function closeImport() {
  imp.cancelled = true;
  imp.rows.forEach((r) => r.thumb?.startsWith("blob:") && URL.revokeObjectURL(r.thumb));
  impDlg.close();
}

$("#import-gmaps-btn").addEventListener("click", () => openImport("gmaps"));
$("#import-photos-btn").addEventListener("click", () => openImport("photos"));
$("#import-cancel-btn").addEventListener("click", closeImport);
impDlg.addEventListener("cancel", () => { imp.cancelled = true; });
$("#import-pick-btn").addEventListener("click", () => $("#import-input").click());

$("#import-input").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  if (!files.length || imp.running) return;
  imp.running = true;
  $("#import-pick-btn").classList.add("hidden");
  $("#import-help").classList.add("hidden");
  try {
    if (imp.kind === "gmaps") await readGoogleFiles(files);
    else await readPhotos(files);
  } catch (err) {
    $("#import-status").textContent = "⚠️ " + err.message;
    $("#import-pick-btn").classList.remove("hidden");
  } finally {
    imp.running = false;
    renderImportRows();
  }
});

// ---------- 共用：預覽清單 ----------
const existingPlace = (name) => state.places.find((p) => p.name === name);

function renderImportRows() {
  const rows = imp.rows;
  const box = $("#import-rows");
  $("#import-select-all").classList.toggle("hidden", !rows.length);
  if (!rows.length) {
    box.innerHTML = "";
    $("#import-ok-btn").disabled = true;
    return;
  }
  box.innerHTML = rows.map((r, i) => {
    const cat = r.categoryId ? categoryById(r.categoryId) : null;
    if (imp.kind === "photos") {
      const opts = r.candidates.map((c, j) => `<option value="${j}" ${j === r.choice ? "selected" : ""}>${esc(c.name)}（${c.dist}m）</option>`).join("");
      const sel = r.candidates.length
        ? `<select data-i="${i}">${opts}</select>`
        : `<div class="imp-sub">${r.failed ? "⚠️ 查詢失敗，稍後再匯入一次" : "附近找不到餐廳資料"}</div>`;
      return `<div class="imp-row">
        <input type="checkbox" data-i="${i}" ${r.checked ? "checked" : ""} ${r.candidates.length ? "" : "disabled"}>
        ${r.thumb ? `<img class="imp-thumb" src="${esc(r.thumb)}" alt="" onerror="this.style.visibility='hidden'">` : ""}
        <div class="imp-main">
          <div class="imp-sub">${esc(formatDate(r.ts))}${r.count > 1 ? `・${r.count} 張` : ""}</div>
          ${sel}
        </div>
      </div>`;
    }
    return `<div class="imp-row ${r.dup ? "dup" : ""}">
      <input type="checkbox" data-i="${i}" ${r.checked ? "checked" : ""} ${r.dup ? "disabled" : ""}>
      <div class="imp-main">
        <div class="imp-title">${esc(r.name)}</div>
        <div class="imp-sub">${r.dup ? "已在口袋名單・" : ""}${cat ? esc(cat.emoji + " " + cat.name) : "未分類"}${r.list ? "・" + esc(r.list) : ""}</div>
      </div>
    </div>`;
  }).join("");
  updateImportCount();
}

function updateImportCount() {
  const selectable = imp.rows.filter((r) => !r.dup && (imp.kind !== "photos" || r.candidates.length));
  const n = selectable.filter((r) => r.checked).length;
  $("#import-count").textContent = `已選 ${n} / ${selectable.length}`;
  $("#import-all").checked = n > 0 && n === selectable.length;
  $("#import-ok-btn").disabled = n === 0;
}

$("#import-rows").addEventListener("change", (e) => {
  const i = Number(e.target.dataset.i);
  const r = imp.rows[i];
  if (!r) return;
  if (e.target.type === "checkbox") r.checked = e.target.checked;
  else if (e.target.tagName === "SELECT") { r.choice = Number(e.target.value); r.checked = true; renderImportRows(); return; }
  updateImportCount();
});

$("#import-all").addEventListener("change", (e) => {
  imp.rows.forEach((r) => { if (!r.dup && (imp.kind !== "photos" || r.candidates.length)) r.checked = e.target.checked; });
  renderImportRows();
});

function formatDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ---------- Google 地圖 ----------
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// Takeout「已儲存」的清單：每個清單一個 CSV，欄位為 Title / Note / URL（中文介面可能是 標題 / 附註 / 網址）
function placesFromCSV(text, listName) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (re, fallback) => { const i = head.findIndex((h) => re.test(h)); return i >= 0 ? i : fallback; };
  const hasHeader = head.some((h) => /title|標題|名稱|url|網址/.test(h));
  const iTitle = col(/title|標題|名稱/, 0), iNote = col(/note|附註|備註|comment|評論/, 1), iUrl = col(/url|網址/, 2);
  return rows.slice(hasHeader ? 1 : 0).map((r) => ({
    name: (r[iTitle] || "").trim(),
    note: (r[iNote] || "").trim(),
    url: /^https?:\/\//.test(r[iUrl] || "") ? r[iUrl].trim() : "",
    list: listName,
  }));
}

// 「地圖（你的地點）」的 Saved Places.json（GeoJSON，加星號的地點）
function placesFromJSON(text, listName) {
  let data;
  try { data = JSON.parse(text); } catch { return []; }
  const features = data.features || (data.type === "Feature" ? [data] : []);
  return features.map((f) => {
    const p = f.properties || {};
    const loc = p.location || p.Location || {};
    return {
      name: (p.Title || p.title || loc.name || loc["Business Name"] || "").trim(),
      note: loc.address || loc.Address || "",
      url: p.google_maps_url || p["Google Maps URL"] || "",
      list: listName,
    };
  });
}

function listNameOf(path) {
  return path.split("/").pop().replace(/\.(csv|json)$/i, "");
}

async function readGoogleFiles(files) {
  $("#import-status").textContent = "讀取中…";
  const found = [];
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      await loadScript(LIB_JSZIP);
      const zip = await JSZip.loadAsync(file);
      for (const entry of Object.values(zip.files)) {
        if (entry.dir) continue;
        const path = entry.name;
        if (/\.csv$/i.test(path)) found.push(...placesFromCSV(await entry.async("string"), listNameOf(path)));
        else if (/\.json$/i.test(path) && /saved|已儲存|地點|places/i.test(path)) found.push(...placesFromJSON(await entry.async("string"), listNameOf(path)));
      }
    } else if (/\.csv$/i.test(file.name)) {
      found.push(...placesFromCSV(await file.text(), listNameOf(file.name)));
    } else if (/\.json$/i.test(file.name)) {
      found.push(...placesFromJSON(await file.text(), listNameOf(file.name)));
    }
  }
  const seen = new Set();
  imp.rows = found
    .filter((p) => p.name && !seen.has(p.name) && seen.add(p.name))
    .map((p) => {
      const cat = guessCategory(p.name, "");
      const dup = !!existingPlace(p.name);
      return { ...p, categoryId: cat?.id || null, price: cat?.price || 2, dup, checked: !dup };
    });
  $("#import-status").textContent = imp.rows.length
    ? `找到 ${imp.rows.length} 個地點，已全部勾選，不是餐廳的請取消勾選`
    : "沒有在檔案裡找到地點，請確認選的是 Takeout 的「已儲存」或「地圖（你的地點）」";
  if (!imp.rows.length) $("#import-pick-btn").classList.remove("hidden");
}

// ---------- 照片 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// OpenStreetMap 的免費伺服器連續查詢容易被限流，失敗就等一下再試
async function fetchOverpassRetry(lat, lon, radius, tries = 3) {
  for (let i = 0; ; i++) {
    try { return await fetchOverpass(lat, lon, radius); }
    catch (e) { if (i >= tries - 1 || imp.cancelled) throw e; await sleep(3000 * (i + 1)); }
  }
}

async function readPhotos(files) {
  const status = $("#import-status");
  status.textContent = "讀取照片資訊…";
  await loadScript(LIB_EXIFR);

  const photos = [];
  let noGps = 0;
  for (let i = 0; i < files.length; i++) {
    if (imp.cancelled) return;
    const file = files[i];
    status.textContent = `讀取照片資訊… ${i + 1} / ${files.length}`;
    const [gps, meta] = await Promise.all([
      exifr.gps(file).catch(() => null),
      exifr.parse(file, ["DateTimeOriginal", "CreateDate"]).catch(() => null),
    ]);
    if (!gps || !Number.isFinite(gps.latitude) || !Number.isFinite(gps.longitude)) { noGps++; continue; }
    const date = meta?.DateTimeOriginal || meta?.CreateDate;
    photos.push({ file, lat: gps.latitude, lon: gps.longitude, ts: date instanceof Date ? date.getTime() : file.lastModified });
  }

  if (!photos.length) {
    status.innerHTML = `⚠️ ${files.length} 張照片都沒有位置資訊。<br>可能是照片本來就沒存位置，或手機在選照片時把位置拿掉了。可以試試在電腦上匯入。`;
    $("#import-pick-btn").classList.remove("hidden");
    return;
  }

  // 同一天、距離 60m 內的照片視為同一餐
  photos.sort((a, b) => a.ts - b.ts);
  const visits = [];
  for (const p of photos) {
    const v = visits.find((v) => startOfDay(v.ts) === startOfDay(p.ts) && distance(v.lat, v.lon, p.lat, p.lon) < 60);
    if (v) v.photos.push(p);
    else visits.push({ lat: p.lat, lon: p.lon, ts: p.ts, photos: [p] });
  }

  // 位置相近的一起查，減少對 OpenStreetMap 的請求
  const spots = [];
  for (const v of visits) {
    let s = spots.find((s) => distance(s.lat, s.lon, v.lat, v.lon) < 40);
    if (!s) spots.push((s = { lat: v.lat, lon: v.lon, candidates: null }));
    v.spot = s;
  }
  for (let i = 0; i < spots.length; i++) {
    if (imp.cancelled) return;
    status.textContent = `查詢拍攝地點的餐廳… ${i + 1} / ${spots.length}`;
    const s = spots[i];
    try {
      const data = await fetchOverpassRetry(s.lat, s.lon, 120);
      s.candidates = data.elements
        .map((el) => {
          const t = el.tags || {};
          const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
          return { name: t["name:zh"] || t.name, cuisine: t.cuisine || "", dist: Math.round(distance(s.lat, s.lon, lat, lon)) };
        })
        .filter((c) => c.name)
        .sort((a, b) => a.dist - b.dist)
        .filter((c, j, arr) => arr.findIndex((x) => x.name === c.name) === j)
        .slice(0, 6);
    } catch {
      s.candidates = [];
      s.failed = true;
    }
    if (i < spots.length - 1) await sleep(800);
  }

  imp.rows = visits.map((v) => {
    let thumb = "";
    try { thumb = URL.createObjectURL(v.photos[0].file); } catch { /* 無法預覽 */ }
    const candidates = v.spot.candidates || [];
    return { ts: v.ts, count: v.photos.length, thumb, candidates, failed: v.spot.failed, choice: 0, checked: candidates.length > 0 };
  }).reverse();

  const matched = imp.rows.filter((r) => r.candidates.length).length;
  status.textContent = `${photos.length} 張照片整理成 ${visits.length} 餐，${matched} 餐找到附近餐廳` +
    (noGps ? `（另有 ${noGps} 張沒有位置）` : "") + "。請確認每一餐的店名是否正確。";
}

// ---------- 確認匯入 ----------
$("#import-ok-btn").addEventListener("click", () => {
  let added = 0, logged = 0;
  if (imp.kind === "gmaps") {
    for (const r of imp.rows) {
      if (!r.checked || r.dup || existingPlace(r.name)) continue;
      state.places.push({ id: uid(), name: r.name, categoryId: r.categoryId, price: r.price, note: r.note, url: r.url, status: "want" });
      added++;
    }
  } else {
    const addLogToo = $("#import-add-log").checked;
    for (const r of imp.rows) {
      if (!r.checked || !r.candidates.length) continue;
      const c = r.candidates[r.choice];
      const cat = guessCategory(c.name, c.cuisine);
      let place = existingPlace(c.name);
      if (!place) {
        place = { id: uid(), name: c.name, categoryId: cat?.id || null, price: cat?.price || 2, note: "", status: "been" };
        state.places.push(place);
        added++;
      } else place.status = "been";
      const sameDay = state.logs.some((l) => (l.placeId === place.id || l.name === place.name) && startOfDay(l.ts) === startOfDay(r.ts));
      if (addLogToo && !sameDay) {
        state.logs.push({ id: uid(), ts: r.ts, name: place.name, emoji: categoryById(place.categoryId)?.emoji, categoryId: place.categoryId, placeId: place.id });
        logged++;
      }
    }
  }
  save();
  closeImport();
  renderList();
  renderLog();
  toast(`新增 ${added} 家店` + (logged ? `、${logged} 筆紀錄` : ""));
});
