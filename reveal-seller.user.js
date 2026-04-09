// ==UserScript==
// @name         Amazon Seller Revealer - (Auto-CSV + Sheets + Safe Scraping)
// @namespace    https://github.com/smartrwl
// @author       Smartrwl
// @version      2.0.0
// @description  Full upgraded version with Google Sheets + throttling + expiry + stability
// @match        https://www.amazon.*/*
// @require      https://openuserjs.org/src/libs/sizzle/GM_config.min.js
// @grant        GM.getValue
// @grant        GM.setValue
// @license      MIT
// ==/UserScript==

(function () {
'use strict';

/* ================== 🔥 CONFIG ================== */
const GOOGLE_SHEET_WEBHOOK = "PASTE_YOUR_WEB_APP_URL_HERE";

/* ================== STATE ================== */
let collectedData = [];
let fetchQueue = [];
let activeFetches = 0;
const MAX_CONCURRENT = 3;

/* ================== UTIL ================== */
const delay = ms => new Promise(res => setTimeout(res, ms));

async function queuedFetch(url) {
  return new Promise((resolve) => {
    fetchQueue.push({ url, resolve });
    processQueue();
  });
}

async function processQueue() {
  if (activeFetches >= MAX_CONCURRENT || fetchQueue.length === 0) return;

  const { url, resolve } = fetchQueue.shift();
  activeFetches++;

  try {
    await delay(700 + Math.random() * 600);
    const res = await fetch(url);
    const text = await res.text();
    resolve(text);
  } catch (e) {
    console.warn("Fetch error:", e);
    resolve(null);
  }

  activeFetches--;
  processQueue();
}

function isExpired(data, maxDays) {
  if (!data || !data.ts) return true;
  const age = (Date.now() - data.ts) / (1000 * 60 * 60 * 24);
  return age > maxDays;
}

/* ================== GOOGLE SHEETS ================== */
function sendToGoogleSheets(row) {
  if (!GOOGLE_SHEET_WEBHOOK || GOOGLE_SHEET_WEBHOOK.includes("PASTE")) return;

  try {
    fetch(GOOGLE_SHEET_WEBHOOK, {
      method: "POST",
      body: JSON.stringify(row),
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    console.warn("Sheet upload failed:", e);
  }
}

/* ================== INIT ================== */
function onInit() {

function showData() {
  getAsin();

  const selectors = [
    'div[data-asin]:not([data-asin=""]):not([data-processed])',
    'li[data-asin]:not([data-asin=""]):not([data-processed])',
    '#gridItemRoot:not([data-processed])'
  ];

  document.querySelectorAll(selectors.join(',')).forEach((product) => {
    product.dataset.processed = "true";
    createInfoBox(product);

    const asinCache = JSON.parse(localStorage.getItem(asinKey(product)));

    if (asinCache && !isExpired(asinCache, 1)) {
      getSellerIdAndNameFromLocalStorage(product);
    } else {
      getSellerIdAndNameFromProductPage(product);
    }
  });
}

const observer = new MutationObserver(showData);
observer.observe(document.body, { childList: true, subtree: true });
showData();

/* ================== ASIN ================== */
function getAsin() {
  document.querySelectorAll('a[href*="/dp/"]').forEach(link => {
    const match = link.href.match(/\/dp\/(.{10})/);
    if (match) {
      const parent = link.closest('[data-asin]');
      if (parent) parent.dataset.asin = match[1];
    }
  });
}

/* ================== PRODUCT ================== */
async function getSellerIdAndNameFromProductPage(product) {

  if (!product.dataset.asin) return;

  const html = await queuedFetch(location.origin + '/dp/' + product.dataset.asin);
  if (!html) return;

  const doc = new DOMParser().parseFromString(html, 'text/html');

  let sellerId, sellerName, pRating = "N/A", sellerType = "FBM";

  try {
    const rEl = doc.querySelector('#acrPopover, .a-icon-alt');
    if (rEl) {
      const match = rEl.textContent.match(/(\d+\.?\d*)/);
      if (match) pRating = match[1];
    }

    const sEl = doc.querySelector('#sellerProfileTriggerId, #merchant-info a');
    if (sEl) {
      sellerId = new URLSearchParams(sEl.href).get('seller');
      sellerName = sEl.textContent.trim();
    } else {
      sellerName = html.includes('Amazon') ? 'Amazon' : 'Unknown';
    }

    if (html.includes("Fulfilled by Amazon")) sellerType = "FBA";
    if (sellerName === "Amazon") sellerType = "Amazon";

    product.dataset.sellerName = sellerName;
    product.dataset.sellerId = sellerId || "";
    product.dataset.productRating = pRating;
    product.dataset.sellerType = sellerType;

    localStorage.setItem(asinKey(product), JSON.stringify({
      sid: sellerId,
      sn: sellerName,
      pr: pRating,
      st: sellerType,
      ts: Date.now()
    }));

    setSellerDetails(product);

  } catch (e) {
    console.warn("Parsing error:", e);
  }
}

/* ================== SELLER ================== */
async function getSellerCountryAndRatingfromSellerPage(product) {

  const cache = JSON.parse(localStorage.getItem(sellerKey(product)));

  if (cache && !isExpired(cache, 7)) {
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
      const fallback = doc.body.innerText.match(/Country:\s*(.*)/i);
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

    localStorage.setItem(sellerKey(product), JSON.stringify({
      c: country,
      rs: score,
      rc: count,
      ts: Date.now()
    }));

    product.dataset.sellerCountry = country;
    product.dataset.sellerRatingScore = score;

    populateInfoBox(product);

    collectCSVData(product);

  } catch (e) {
    console.warn("Seller parsing error:", e);
  }
}

/* ================== CSV + SHEETS ================== */
function collectCSVData(product) {

  if (collectedData.length > 5000) return;

  const asin = product.dataset.asin;

  if (!collectedData.some(item => item.asin === asin)) {

    const row = {
      asin,
      seller: product.dataset.sellerName,
      sellerId: product.dataset.sellerId,
      rating: product.dataset.productRating,
      feedback: product.dataset.sellerRatingScore,
      type: product.dataset.sellerType,
      url: location.href,
      date: new Date().toISOString()
    };

    collectedData.push(row);

    // 🔥 GOOGLE SHEETS AUTO PUSH
    sendToGoogleSheets(row);

    updateCSVButtonCount();
  }
}

/* ================== EXISTING ================== */
function getSellerIdAndNameFromLocalStorage(product) {
  const data = JSON.parse(localStorage.getItem(asinKey(product)));
  product.dataset.sellerName = data.sn;
  product.dataset.sellerId = data.sid || "";
  product.dataset.productRating = data.pr || "N/A";
  product.dataset.sellerType = data.st || "FBM";
  setSellerDetails(product);
}

function setSellerDetails(product) {
  if (!product.dataset.sellerId) {
    populateInfoBox(product);
    return;
  }
  getSellerCountryAndRatingfromSellerPage(product);
}

function createInfoBox(product) {
  const box = document.createElement('div');
  box.innerHTML = `<div class="seller-info">Loading...</div>`;
  product.appendChild(box);
}

function populateInfoBox(product) {
  const el = product.querySelector('.seller-info');
  if (!el) return;

  el.innerHTML = `
    ${product.dataset.sellerName} 
    (${product.dataset.productRating}/${product.dataset.sellerRatingScore || "0%"}) 
    [${product.dataset.sellerType}]
  `;
}

function updateCSVButtonCount() {
  const btn = document.getElementById('sb-download-csv');
  if (btn) btn.textContent = `📥 CSV (${collectedData.length})`;
}

function asinKey(p) { return 'asin-' + p.dataset.asin; }
function sellerKey(p) { return 'seller-' + p.dataset.sellerId; }

}

onInit();

})();
