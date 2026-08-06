// ==UserScript==
// @name         Amazon Seller Revealer - (Auto-CSV + Sheets + Safe Scraping)
// @name:de      Amazon Verkäufer-Anzeiger - (Auto-CSV + Sheets)
// @name:fr      Révélateur de Vendeurs Amazon - (Auto-CSV + Sheets)
// @name:es      Revelador de Vendedores Amazon - (Auto-CSV + Sheets)
// @name:ja      Amazon出品者リビーラー - (Auto-CSV + Sheets)
// @name:hi      Amazon विक्रेता रिवीलर - (Auto-CSV + Sheets)
// @namespace    https://github.com/smartrwl
// @author       Smartrwl
// @version      2.2.0
// @description  Reveals third-party seller identities, origin countries and hybrid ratings on Amazon search & bestseller pages. Auto-CSV, Google Sheets sync, country highlighting, settings panel, captcha-safe throttled scraping.
// @description:de  Zeigt Verkäufer-Identitäten, Herkunftsländer und Bewertungen direkt in den Amazon-Suchergebnissen. Auto-CSV, Google Sheets, Länder-Hervorhebung.
// @description:fr  Révèle l'identité des vendeurs tiers, leur pays d'origine et les notes hybrides sur Amazon. Auto-CSV, Google Sheets, surlignage par pays.
// @description:es  Revela la identidad de vendedores, país de origen y calificaciones híbridas en Amazon. Auto-CSV, Google Sheets, resaltado por país.
// @description:ja  Amazonの検索結果に出品者名・国・評価を表示。CSV自動収集、Googleスプレッドシート連携、国別ハイライト。
// @description:hi  Amazon खोज परिणामों पर विक्रेता की पहचान, देश और रेटिंग दिखाता है। Auto-CSV, Google Sheets, देश हाइलाइटिंग।
// @homepageURL  https://github.com/Smart-rwl/Amazon-Reveal-Seller
// @supportURL   https://github.com/Smart-rwl/Amazon-Reveal-Seller/issues
// @downloadURL  https://raw.githubusercontent.com/Smart-rwl/Amazon-Reveal-Seller/main/reveal-seller.user.js
// @updateURL    https://raw.githubusercontent.com/Smart-rwl/Amazon-Reveal-Seller/main/reveal-seller.user.js
// @match        https://www.amazon.com/*
// @match        https://www.amazon.in/*
// @match        https://www.amazon.co.uk/*
// @match        https://www.amazon.de/*
// @match        https://www.amazon.fr/*
// @match        https://www.amazon.it/*
// @match        https://www.amazon.es/*
// @match        https://www.amazon.ca/*
// @match        https://www.amazon.com.mx/*
// @match        https://www.amazon.com.br/*
// @match        https://www.amazon.com.au/*
// @match        https://www.amazon.co.jp/*
// @match        https://www.amazon.nl/*
// @match        https://www.amazon.se/*
// @match        https://www.amazon.pl/*
// @match        https://www.amazon.ae/*
// @match        https://www.amazon.sa/*
// @match        https://www.amazon.sg/*
// @match        https://www.amazon.com.tr/*
// @match        https://www.amazon.eg/*
// @grant        GM.getValue
// @grant        GM.setValue
// @license      MIT
// ==/UserScript==

(function () {
'use strict';

/* ================== 🔥 CONFIG ================== */
const GOOGLE_SHEET_WEBHOOK = "PASTE_YOUR_WEB_APP_URL_HERE";

const DEFAULT_SETTINGS = {
  redCountries: "CN, HK",       // highlight these in red
  greenCountries: "",           // highlight these in green (e.g. "IN" or "US")
  hideRed: false,               // dim products from red-list countries
  autoCsv: true,                // collect rows automatically while scrolling
  sheetsSync: true,             // push rows to Google Sheets webhook (if set)
  cacheDaysAsin: 1,             // product cache expiry (days)
  cacheDaysSeller: 7            // seller cache expiry (days)
};

/* ================== STATE ================== */
let SETTINGS = { ...DEFAULT_SETTINGS };
let collectedData = [];
let fetchQueue = [];
let activeFetches = 0;
let pausedUntil = 0;            // captcha cool-down timestamp
const MAX_CONCURRENT = 3;
const MAX_ROWS = 5000;
const CAPTCHA_COOLDOWN_MS = 5 * 60 * 1000; // 5 min pause after robot check

/* Localized "Fulfilled by Amazon" / "Sold by Amazon" phrases */
const FBA_PHRASES = [
  "Fulfilled by Amazon", "Versand durch Amazon", "Expédié par Amazon",
  "Spedito da Amazon", "Gestionado por Amazon", "Enviado por Amazon",
  "Amazon.co.jp が発送", "Verzonden door Amazon", "Wysyłka przez Amazon",
  "Skickas från Amazon", "Amazon tarafından gönderilir"
];
const SOLD_BY_AMAZON_PHRASES = [
  "sold by amazon", "ships from and sold by amazon", "verkauf durch amazon",
  "vendu et expédié par amazon", "venduto e spedito da amazon",
  "vendido y enviado por amazon", "amazon.co.jp が販売", "verkocht door amazon",
  "sprzedawane przez amazon", "säljs av amazon", "amazon tarafından satılır"
];

/* ================== UTIL ================== */
const delay = ms => new Promise(res => setTimeout(res, ms));

function safeParse(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function debounce(fn, wait) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

function csvList(str) {
  return String(str || "")
    .split(",")
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);
}

function isExpired(data, maxDays) {
  if (!data || !data.ts) return true;
  const age = (Date.now() - data.ts) / (1000 * 60 * 60 * 24);
  return age > maxDays;
}

/* Detect Amazon robot-check / captcha pages so we never cache garbage */
function isCaptchaPage(html) {
  return html.includes("validateCaptcha") ||
         html.includes("api-services-support@amazon.com") ||
         html.includes("Type the characters you see in this image");
}

/* ================== SETTINGS PERSISTENCE ================== */
async function loadSettings() {
  try {
    const saved = safeParse(await GM.getValue("sb-settings", null));
    if (saved) SETTINGS = { ...DEFAULT_SETTINGS, ...saved };
  } catch (e) { /* fall back to defaults */ }
}

async function saveSettings() {
  try { await GM.setValue("sb-settings", JSON.stringify(SETTINGS)); }
  catch (e) { console.warn("Settings save failed:", e); }
}

/* ================== THROTTLED FETCH QUEUE ================== */
async function queuedFetch(url) {
  return new Promise((resolve) => {
    fetchQueue.push({ url, resolve });
    updateQueueStatus();
    processQueue();
  });
}

async function processQueue() {
  if (activeFetches >= MAX_CONCURRENT || fetchQueue.length === 0) return;

  // Captcha cool-down: hold the queue instead of hammering Amazon
  const now = Date.now();
  if (now < pausedUntil) {
    setTimeout(processQueue, pausedUntil - now + 1000);
    return;
  }

  const item = fetchQueue.shift();
  const { url, resolve } = item;
  activeFetches++;

  try {
    await delay(400 + Math.random() * 500);
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 15000); // never let one request jam a slot
    const res = await fetch(url, { signal: ctrl.signal });
    const text = await res.text();
    clearTimeout(timeout);

    if (isCaptchaPage(text)) {
      console.warn("[SellerRevealer] Robot check detected — pausing fetches for 5 minutes.");
      pausedUntil = Date.now() + CAPTCHA_COOLDOWN_MS;
      item.tries = (item.tries || 0) + 1;
      if (item.tries <= 2) {
        fetchQueue.push(item); // requeue for after the cool-down
      } else {
        resolve(null); // give up on this URL after repeated robot checks
      }
      updateQueueStatus();
      showToast("⚠️ Amazon robot check detected. Pausing data collection for 5 min.");
    } else {
      resolve(text);
    }
  } catch (e) {
    console.warn("Fetch error:", e);
    resolve(null);
  }

  activeFetches--;
  updateQueueStatus();
  processQueue();
}

/* ================== GOOGLE SHEETS (BATCHED) ================== */
let sheetBuffer = [];
let sheetFlushTimer = null;
const SHEET_BATCH_SIZE = 20;
const SHEET_FLUSH_INTERVAL = 30 * 1000;

function sendToGoogleSheets(row) {
  if (!SETTINGS.sheetsSync) return;
  if (!GOOGLE_SHEET_WEBHOOK || GOOGLE_SHEET_WEBHOOK.includes("PASTE")) return;

  sheetBuffer.push(row);

  if (sheetBuffer.length >= SHEET_BATCH_SIZE) {
    flushSheetBuffer();
  } else if (!sheetFlushTimer) {
    sheetFlushTimer = setTimeout(flushSheetBuffer, SHEET_FLUSH_INTERVAL);
  }
}

async function flushSheetBuffer() {
  clearTimeout(sheetFlushTimer);
  sheetFlushTimer = null;
  if (sheetBuffer.length === 0) return;

  const batch = sheetBuffer.splice(0, sheetBuffer.length);

  try {
    const res = await fetch(GOOGLE_SHEET_WEBHOOK, {
      method: "POST",
      body: JSON.stringify({ rows: batch }),
      headers: { "Content-Type": "application/json" }
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
  } catch (e) {
    console.warn("Sheet upload failed, will retry with next batch:", e);
    sheetBuffer.unshift(...batch); // put rows back for retry
    sheetFlushTimer = setTimeout(flushSheetBuffer, SHEET_FLUSH_INTERVAL);
  }
}

// Flush anything pending before the user leaves the page
window.addEventListener("beforeunload", () => {
  if (sheetBuffer.length && SETTINGS.sheetsSync &&
      GOOGLE_SHEET_WEBHOOK && !GOOGLE_SHEET_WEBHOOK.includes("PASTE")) {
    navigator.sendBeacon(GOOGLE_SHEET_WEBHOOK, JSON.stringify({ rows: sheetBuffer }));
    sheetBuffer = [];
  }
});

/* ================== CACHE MAINTENANCE ================== */
function cleanExpiredCache() {
  let removed = 0;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (key.startsWith("asin-") || key.startsWith("seller-")) {
      const data = safeParse(localStorage.getItem(key));
      const maxDays = key.startsWith("asin-") ? SETTINGS.cacheDaysAsin : SETTINGS.cacheDaysSeller;
      if (!data || isExpired(data, maxDays)) {
        localStorage.removeItem(key);
        removed++;
      }
    }
  }
  if (removed) console.log(`[SellerRevealer] Cleaned ${removed} expired cache entries.`);
}

function clearAllCache() {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key && (key.startsWith("asin-") || key.startsWith("seller-"))) {
      localStorage.removeItem(key);
    }
  }
  showToast("🧹 Seller cache cleared.");
}

/* ================== SESSION PERSISTENCE (CSV survives pagination) ================== */
function loadCollectedData() {
  collectedData = safeParse(sessionStorage.getItem("sb-collected")) || [];
}

function persistCollectedData() {
  try { sessionStorage.setItem("sb-collected", JSON.stringify(collectedData)); }
  catch (e) { /* storage full — keep in memory only */ }
}

/* ================== TOAST (global — used before/after init) ================== */
function showToast(msg) {
  let toast = document.getElementById('sb-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'sb-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('sb-show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('sb-show'), 4000);
}

/* ================== QUEUE STATUS BADGE ================== */
function updateQueueStatus() {
  const el = document.getElementById('sb-status');
  if (!el) return;
  const pending = fetchQueue.length + activeFetches;
  if (Date.now() < pausedUntil) {
    el.textContent = '⏸ Paused (robot check)';
    el.style.display = 'inline-flex';
  } else if (pending > 0) {
    el.textContent = `⏳ ${pending} left`;
    el.style.display = 'inline-flex';
  } else {
    el.style.display = 'none';
  }
}

/* ================== INIT ================== */
async function onInit() {

await loadSettings();
loadCollectedData();
cleanExpiredCache();
injectStyles();
createFooterButtons();
updateCSVButtonCount();

function showData() {
  // Self-healing UI: Amazon's dynamic re-renders can wipe injected elements.
  // Re-create the toolbar and styles if they've been removed.
  if (!document.getElementById('sb-toolbar')) createFooterButtons();
  if (!document.getElementById('sb-styles')) injectStyles();

  getAsin();

  const selectors = [
    'div[data-asin]:not([data-asin=""]):not([data-processed])',
    'li[data-asin]:not([data-asin=""]):not([data-processed])',
    '#gridItemRoot:not([data-processed])'
  ];

  document.querySelectorAll(selectors.join(',')).forEach((product) => {
    product.dataset.processed = "true";
    createInfoBox(product);
    grabCardExtras(product);

    const asinCache = safeParse(localStorage.getItem(asinKey(product)));

    if (asinCache && !isExpired(asinCache, SETTINGS.cacheDaysAsin)) {
      getSellerIdAndNameFromLocalStorage(product);
    } else {
      // Viewport-priority: fetch only when the card is on/near screen,
      // so what you're actually looking at loads first instead of the
      // whole page queueing up in DOM order.
      viewObserver.observe(product);
    }
  });
}

// Fires when a product card scrolls to within 400px of the viewport
const viewObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      viewObserver.unobserve(entry.target);
      getSellerIdAndNameFromProductPage(entry.target);
    }
  });
}, { rootMargin: '400px' });

// Debounced observer — Amazon pages mutate constantly; without this the
// handler fires hundreds of times per scroll.
const observer = new MutationObserver(debounce(showData, 300));
observer.observe(document.body, { childList: true, subtree: true });
showData();

/* ================== ASIN ================== */
function getAsin() {
  document.querySelectorAll('a[href*="/dp/"]').forEach(link => {
    const match = link.href.match(/\/dp\/([A-Z0-9]{10})/);
    if (match) {
      const parent = link.closest('[data-asin]');
      if (parent && !parent.dataset.asin) parent.dataset.asin = match[1];
    }
  });
}

/* ================== CARD EXTRAS (price / review count — free to grab) ================== */
function grabCardExtras(product) {
  const priceEl = product.querySelector('.a-price .a-offscreen');
  if (priceEl) product.dataset.price = priceEl.textContent.trim();

  // Star rating is printed right on the search card — grab it for free
  // instead of fetching the product page for it.
  const starEl = product.querySelector('.a-icon-alt');
  if (starEl) {
    const m = starEl.textContent.match(/(\d+[.,]?\d*)/);
    if (m) product.dataset.productRating = m[1].replace(',', '.');
  }

  const reviewEl = product.querySelector(
    'span.a-size-base.s-underline-text, a[href*="#customerReviews"] span, .a-icon-star-small ~ span.a-size-small'
  );
  if (reviewEl) {
    const m = reviewEl.textContent.replace(/[,.]/g, '').match(/\d+/);
    if (m) product.dataset.reviewCount = m[0];
  }
}

/* ================== PRODUCT — FAST PATH (All-Offers ajax) ================== */
// The AOD ajax endpoint returns ~100KB instead of the 2–5MB full product
// page: the single biggest speed win. Falls back to the full page below
// if Amazon changes the endpoint or the layout differs.
async function getSellerFromAOD(product) {
  const asin = product.dataset.asin;
  const html = await queuedFetch(
    location.origin + '/gp/product/ajax/ref=aod_f_new?asin=' + asin +
    '&pc=dp&experienceId=aodAjaxMain'
  );
  if (!html) return false;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const pinned = doc.querySelector('#aod-pinned-offer') || doc;

  const soldBy = pinned.querySelector('#aod-offer-soldBy');
  if (!soldBy) return false;

  let sellerId = null, sellerName = '', sellerType = 'FBM';

  const link = soldBy.querySelector('a[href*="seller="]');
  if (link) {
    try {
      sellerId = new URL(link.getAttribute('href'), location.origin).searchParams.get('seller');
    } catch (e) { sellerId = null; }
    sellerName = link.textContent.trim();
  } else {
    const nameEl = soldBy.querySelector('.a-color-base, span.a-size-small:last-child');
    sellerName = nameEl ? nameEl.textContent.trim() : '';
  }
  if (!sellerName) return false;

  const shipsFrom = pinned.querySelector('#aod-offer-shipsFrom');
  if (shipsFrom && /amazon/i.test(shipsFrom.textContent)) sellerType = 'FBA';
  if (/^amazon(\.[a-z.]+)?$/i.test(sellerName)) {
    sellerName = 'Amazon';
    sellerType = 'Amazon';
  }

  // Rating comes free from the search card (grabCardExtras)
  const pRating = product.dataset.productRating || 'N/A';

  product.dataset.sellerName = sellerName;
  product.dataset.sellerId = sellerId || '';
  product.dataset.productRating = pRating;
  product.dataset.sellerType = sellerType;

  localStorage.setItem(asinKey(product), JSON.stringify({
    sid: sellerId, sn: sellerName, pr: pRating, st: sellerType, ts: Date.now()
  }));

  setSellerDetails(product);
  return true;
}

/* ================== PRODUCT PAGE (fallback) ================== */
async function getSellerIdAndNameFromProductPage(product) {

  if (!product.dataset.asin) return;

  // Try the lightweight endpoint first
  if (await getSellerFromAOD(product)) return;

  const html = await queuedFetch(location.origin + '/dp/' + product.dataset.asin);
  if (!html) return;

  const doc = new DOMParser().parseFromString(html, 'text/html');

  let sellerId = null, sellerName, pRating = "N/A", sellerType = "FBM";
  let extracted = false;

  try {
    const rEl = doc.querySelector('#acrPopover, .a-icon-alt');
    if (rEl) {
      const match = rEl.textContent.match(/(\d+[.,]?\d*)/);
      if (match) pRating = match[1].replace(',', '.');
    }

    const merchantInfo = doc.querySelector('#merchant-info, #tabular-buybox');
    const merchantText = (merchantInfo ? merchantInfo.textContent : '').toLowerCase();

    const sEl = doc.querySelector('#sellerProfileTriggerId, #merchant-info a[href*="seller="]');
    if (sEl) {
      try {
        const sellerUrl = new URL(sEl.getAttribute('href'), location.origin);
        sellerId = sellerUrl.searchParams.get('seller');
      } catch (e) { sellerId = null; }
      sellerName = sEl.textContent.trim();
      extracted = true;
    } else if (SOLD_BY_AMAZON_PHRASES.some(p => merchantText.includes(p))) {
      // Fixed: previously `html.includes('Amazon')` — true on EVERY page.
      // Now we check the actual buy-box merchant text, with localized phrases.
      sellerName = 'Amazon';
      extracted = true;
    } else {
      sellerName = 'Unknown';
    }

    if (FBA_PHRASES.some(p => html.includes(p))) sellerType = "FBA";
    if (sellerName === "Amazon") sellerType = "Amazon";

    product.dataset.sellerName = sellerName;
    product.dataset.sellerId = sellerId || "";
    product.dataset.productRating = pRating;
    product.dataset.sellerType = sellerType;

    // Only cache when we actually extracted something meaningful —
    // never cache "Unknown" from a partial/error page.
    if (extracted) {
      localStorage.setItem(asinKey(product), JSON.stringify({
        sid: sellerId,
        sn: sellerName,
        pr: pRating,
        st: sellerType,
        ts: Date.now()
      }));
    }

    setSellerDetails(product);

  } catch (e) {
    console.warn("Parsing error:", e);
  }
}

/* ================== SELLER PAGE ================== */
async function getSellerCountryAndRatingfromSellerPage(product) {

  const cache = safeParse(localStorage.getItem(sellerKey(product)));

  if (cache && !isExpired(cache, SETTINGS.cacheDaysSeller)) {
    getSellerCountryAndRatingfromLocalStorage(product);
    return;
  }

  const html = await queuedFetch(location.origin + '/sp?seller=' + product.dataset.sellerId);
  if (!html) return;

  const doc = new DOMParser().parseFromString(html, 'text/html');

  let country = '?', score = '0%', count = '0';

  try {
    const address = doc.querySelectorAll('.indent-left');
    if (address.length > 0) {
      country = address[address.length - 1].textContent.trim().toUpperCase();
    } else {
      const fallback = doc.body.textContent.match(/Country:\s*(.*)/i);
      if (fallback) country = fallback[1].trim().toUpperCase();
    }

    const feedback = doc.querySelector('#seller-info-feedback-summary');
    if (feedback) {
      const match = feedback.textContent.match(/(\d+%).*?\((\d+)/);
      if (match) {
        score = match[1];
        count = match[2];
      }
    }

    // Only cache real extractions
    if (country !== '?' || score !== '0%') {
      localStorage.setItem(sellerKey(product), JSON.stringify({
        c: country,
        rs: score,
        rc: count,
        ts: Date.now()
      }));
    }

    product.dataset.sellerCountry = country;
    product.dataset.sellerRatingScore = score;
    product.dataset.sellerRatingCount = count;

    populateInfoBox(product);
    applyCountryHighlight(product);
    if (SETTINGS.autoCsv) collectCSVData(product);

  } catch (e) {
    console.warn("Seller parsing error:", e);
  }
}

function getSellerCountryAndRatingfromLocalStorage(product) {
  const data = safeParse(localStorage.getItem(sellerKey(product)));
  if (!data) return;

  product.dataset.sellerCountry = data.c || '?';
  product.dataset.sellerRatingScore = data.rs || '0%';
  product.dataset.sellerRatingCount = data.rc || '0';

  populateInfoBox(product);
  applyCountryHighlight(product);
  if (SETTINGS.autoCsv) collectCSVData(product);
}

/* ================== COUNTRY HIGHLIGHTING ================== */
function applyCountryHighlight(product) {
  const country = (product.dataset.sellerCountry || '').toUpperCase();
  if (!country || country === '?') return;

  const red = csvList(SETTINGS.redCountries);
  const green = csvList(SETTINGS.greenCountries);

  const matches = list => list.some(c => country === c || country.includes(c));

  product.classList.remove('sb-red', 'sb-green', 'sb-hidden');

  if (matches(red)) {
    product.classList.add('sb-red');
    if (SETTINGS.hideRed) product.classList.add('sb-hidden');
  } else if (matches(green)) {
    product.classList.add('sb-green');
  }
}

function reapplyAllHighlights() {
  document.querySelectorAll('[data-processed]').forEach(applyCountryHighlight);
}

/* ================== CSV + SHEETS ================== */
function collectCSVData(product) {

  if (collectedData.length >= MAX_ROWS) return;

  const asin = product.dataset.asin;
  if (!asin) return;

  if (!collectedData.some(item => item.asin === asin)) {

    const row = {
      asin,
      seller: product.dataset.sellerName,
      sellerId: product.dataset.sellerId,
      country: product.dataset.sellerCountry || "",
      productRating: product.dataset.productRating,
      reviewCount: product.dataset.reviewCount || "",
      sellerFeedback: product.dataset.sellerRatingScore,
      feedbackCount: product.dataset.sellerRatingCount || "",
      price: product.dataset.price || "",
      type: product.dataset.sellerType,
      url: location.origin + '/dp/' + asin,
      sourcePage: location.href,
      date: new Date().toISOString()
    };

    collectedData.push(row);
    persistCollectedData();

    // 🔥 GOOGLE SHEETS AUTO PUSH (batched)
    sendToGoogleSheets(row);

    updateCSVButtonCount();
  }
}

/* ================== FOOTER TOOLBAR ================== */
function createFooterButtons() {
  if (document.getElementById('sb-toolbar')) return; // never duplicate
  const bar = document.createElement('div');
  bar.id = 'sb-toolbar';

  const status = document.createElement('span');
  status.id = 'sb-status';
  status.style.display = 'none';
  bar.appendChild(status);

  const settingsBtn = document.createElement('button');
  settingsBtn.id = 'sb-settings';
  settingsBtn.textContent = '⚙️ SoldBy';
  settingsBtn.addEventListener('click', openSettingsPanel);

  const csvBtn = document.createElement('button');
  csvBtn.id = 'sb-download-csv';
  csvBtn.textContent = `📥 CSV (${collectedData.length})`;
  csvBtn.addEventListener('click', downloadCSV);

  const resetBtn = document.createElement('button');
  resetBtn.id = 'sb-reset-csv';
  resetBtn.textContent = '🔄 Reset';
  resetBtn.addEventListener('click', () => {
    collectedData = [];
    persistCollectedData();
    updateCSVButtonCount();
    showToast('CSV list cleared.');
  });

  bar.appendChild(settingsBtn);
  bar.appendChild(csvBtn);
  bar.appendChild(resetBtn);
  document.body.appendChild(bar);
}

function downloadCSV() {
  if (collectedData.length === 0) {
    showToast('No data collected yet. Scroll through some products first.');
    return;
  }

  const headers = Object.keys(collectedData[0]);
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

  const csv = [
    headers.join(','),
    ...collectedData.map(row => headers.map(h => escape(row[h])).join(','))
  ].join('\n');

  // BOM so Excel opens UTF-8 (seller names with accents/CJK) correctly
  const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `amazon-sellers-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function updateCSVButtonCount() {
  const btn = document.getElementById('sb-download-csv');
  if (btn) btn.textContent = `📥 CSV (${collectedData.length})`;
}

/* ================== SETTINGS PANEL ================== */
function openSettingsPanel() {
  if (document.getElementById('sb-panel-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'sb-panel-overlay';

  const panel = document.createElement('div');
  panel.id = 'sb-panel';
  panel.innerHTML = `
    <h3>⚙️ Seller Revealer Settings</h3>

    <label>🔴 Red-flag countries <small>(comma separated, e.g. CN, HK)</small></label>
    <input type="text" id="sb-red" value="">

    <label>🟢 Green countries <small>(comma separated, e.g. IN, US)</small></label>
    <input type="text" id="sb-green" value="">

    <label class="sb-check"><input type="checkbox" id="sb-hide-red"> Dim products from red-flag countries</label>
    <label class="sb-check"><input type="checkbox" id="sb-auto-csv"> Auto-collect CSV data while scrolling</label>
    <label class="sb-check"><input type="checkbox" id="sb-sheets"> Push rows to Google Sheets webhook</label>

    <label>Product cache expiry (days)</label>
    <input type="number" id="sb-cache-asin" min="1" max="30">

    <label>Seller cache expiry (days)</label>
    <input type="number" id="sb-cache-seller" min="1" max="90">

    <div class="sb-panel-row">
      <button id="sb-clear-cache" class="sb-secondary">🧹 Clear Cache</button>
      <span style="flex:1"></span>
      <button id="sb-cancel" class="sb-secondary">Cancel</button>
      <button id="sb-save" class="sb-primary">💾 Save</button>
    </div>
  `;

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // Populate current values via JS (not innerHTML) to avoid escaping issues
  panel.querySelector('#sb-red').value = SETTINGS.redCountries;
  panel.querySelector('#sb-green').value = SETTINGS.greenCountries;
  panel.querySelector('#sb-hide-red').checked = SETTINGS.hideRed;
  panel.querySelector('#sb-auto-csv').checked = SETTINGS.autoCsv;
  panel.querySelector('#sb-sheets').checked = SETTINGS.sheetsSync;
  panel.querySelector('#sb-cache-asin').value = SETTINGS.cacheDaysAsin;
  panel.querySelector('#sb-cache-seller').value = SETTINGS.cacheDaysSeller;

  panel.querySelector('#sb-clear-cache').addEventListener('click', clearAllCache);
  panel.querySelector('#sb-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  panel.querySelector('#sb-save').addEventListener('click', async () => {
    SETTINGS.redCountries = panel.querySelector('#sb-red').value;
    SETTINGS.greenCountries = panel.querySelector('#sb-green').value;
    SETTINGS.hideRed = panel.querySelector('#sb-hide-red').checked;
    SETTINGS.autoCsv = panel.querySelector('#sb-auto-csv').checked;
    SETTINGS.sheetsSync = panel.querySelector('#sb-sheets').checked;
    SETTINGS.cacheDaysAsin = Math.max(1, parseInt(panel.querySelector('#sb-cache-asin').value, 10) || 1);
    SETTINGS.cacheDaysSeller = Math.max(1, parseInt(panel.querySelector('#sb-cache-seller').value, 10) || 7);

    await saveSettings();
    reapplyAllHighlights();
    overlay.remove();
    showToast('✅ Settings saved.');
  });
}

/* ================== INFO BOX ================== */
function createInfoBox(product) {
  if (product.querySelector('.seller-info')) return;
  const box = document.createElement('div');
  box.innerHTML = `<div class="seller-info">Loading...</div>`;
  product.appendChild(box);
}

function populateInfoBox(product) {
  const el = product.querySelector('.seller-info');
  if (!el) return;

  el.textContent = ''; // rebuild safely — no HTML injection from scraped names

  const name = document.createElement('span');
  name.className = 'sb-name';
  name.textContent = product.dataset.sellerName || 'Unknown';
  el.appendChild(name);

  // Clickable hybrid rating → jumps to the product's customer reviews
  const rating = document.createElement('a');
  rating.className = 'sb-rating';
  rating.href = `${location.origin}/dp/${product.dataset.asin}#customerReviews`;
  rating.title = 'Open customer reviews';
  rating.textContent = ` (${product.dataset.productRating || 'N/A'} / ${product.dataset.sellerRatingScore || '0%'}) `;
  el.appendChild(rating);

  const type = document.createElement('span');
  type.className = 'sb-type sb-type-' + (product.dataset.sellerType || 'FBM').toLowerCase();
  type.textContent = `[${product.dataset.sellerType || 'FBM'}]`;
  el.appendChild(type);

  if (product.dataset.sellerCountry && product.dataset.sellerCountry !== '?') {
    const country = document.createElement('span');
    country.className = 'sb-country';
    country.textContent = ` · ${product.dataset.sellerCountry}`;
    el.appendChild(country);
  }
}

/* ================== STYLES ================== */
function injectStyles() {
  if (document.getElementById('sb-styles')) return; // never duplicate
  const style = document.createElement('style');
  style.id = 'sb-styles';
  style.textContent = `
    .seller-info {
      font-size: 12px;
      color: #565959;
      background: #f0f2f2;
      border-radius: 4px;
      padding: 2px 6px;
      margin-top: 4px;
      display: inline-block;
      line-height: 1.4;
    }
    .seller-info .sb-name { font-weight: 600; color: #0f1111; }
    .seller-info .sb-rating { color: #007185; text-decoration: none; }
    .seller-info .sb-rating:hover { color: #c7511f; text-decoration: underline; }
    .seller-info .sb-type-fba { color: #067d62; font-weight: 600; }
    .seller-info .sb-type-amazon { color: #c45500; font-weight: 600; }
    .seller-info .sb-type-fbm { color: #565959; }
    .seller-info .sb-country { color: #0f1111; }

    [data-processed].sb-red { outline: 2px solid #d13212; outline-offset: -2px; border-radius: 8px; }
    [data-processed].sb-green { outline: 2px solid #067d62; outline-offset: -2px; border-radius: 8px; }
    [data-processed].sb-hidden { opacity: 0.25; filter: grayscale(1); }
    [data-processed].sb-hidden:hover { opacity: 1; filter: none; }

    #sb-toolbar {
      position: fixed;
      bottom: 12px;
      right: 12px;
      z-index: 999999;
      display: flex;
      gap: 6px;
    }
    #sb-toolbar button {
      background: #232f3e;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 12px;
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(0,0,0,.25);
    }
    #sb-toolbar button:hover { background: #37475a; }
    #sb-toolbar #sb-status {
      background: rgba(15,17,17,.85);
      color: #ffd814;
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 12px;
      align-items: center;
    }

    #sb-panel-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15,17,17,.55);
      z-index: 1000000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #sb-panel {
      background: #fff;
      width: 380px;
      max-width: 92vw;
      max-height: 85vh;
      overflow-y: auto;
      border-radius: 10px;
      padding: 18px 20px;
      font-size: 13px;
      color: #0f1111;
      box-shadow: 0 8px 30px rgba(0,0,0,.35);
    }
    #sb-panel h3 { margin: 0 0 12px; font-size: 16px; }
    #sb-panel label { display: block; margin: 10px 0 4px; font-weight: 600; }
    #sb-panel label small { font-weight: 400; color: #565959; }
    #sb-panel input[type="text"], #sb-panel input[type="number"] {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
      border: 1px solid #d5d9d9;
      border-radius: 6px;
      font-size: 13px;
    }
    #sb-panel .sb-check { font-weight: 400; display: flex; align-items: center; gap: 8px; }
    #sb-panel .sb-panel-row { display: flex; gap: 8px; margin-top: 16px; align-items: center; }
    #sb-panel button {
      border: none;
      border-radius: 6px;
      padding: 7px 12px;
      font-size: 13px;
      cursor: pointer;
    }
    #sb-panel .sb-primary { background: #ffd814; color: #0f1111; font-weight: 600; }
    #sb-panel .sb-primary:hover { background: #f7ca00; }
    #sb-panel .sb-secondary { background: #e7e9ec; color: #0f1111; }
    #sb-panel .sb-secondary:hover { background: #d5d9d9; }

    #sb-toast {
      position: fixed;
      bottom: 60px;
      right: 12px;
      background: #0f1111;
      color: #fff;
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 13px;
      z-index: 1000001;
      opacity: 0;
      transform: translateY(8px);
      transition: all .25s ease;
      pointer-events: none;
      max-width: 320px;
    }
    #sb-toast.sb-show { opacity: 1; transform: translateY(0); }
  `;
  document.head.appendChild(style);
}

function asinKey(p) { return 'asin-' + p.dataset.asin; }
function sellerKey(p) { return 'seller-' + p.dataset.sellerId; }

}

onInit();

})();
