// ==UserScript==
// @name         Amazon Seller Revealer - (Auto-CSV + Sheets + Safe Scraping)
// @name:de      Amazon Verkäufer-Anzeiger - (Auto-CSV + Sheets)
// @name:fr      Révélateur de Vendeurs Amazon - (Auto-CSV + Sheets)
// @name:es      Revelador de Vendedores Amazon - (Auto-CSV + Sheets)
// @name:ja      Amazon出品者リビーラー - (Auto-CSV + Sheets)
// @name:hi      Amazon विक्रेता रिवीलर - (Auto-CSV + Sheets)
// @namespace    https://github.com/smartrwl
// @author       Smartrwl
// @version      3.0.0
// @description  Reveals third-party seller identities, origin countries and hybrid ratings on Amazon search & bestseller pages. Fast AOD-based scraping, extraction health monitor, adaptive throttling, localized UI, auto-CSV, Google Sheets sync, country highlighting, built-in diagnostics.
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

/*
 * ARCHITECTURE (v3)
 * ─────────────────
 *  1. PARSERS   — pure functions, no side effects. Unit-tested against
 *                 HTML fixtures (see tests/ in the repo). If Amazon breaks
 *                 something, this is the ONLY section that should change.
 *  2. NET       — throttled fetch queue with adaptive delays, captcha
 *                 detection, retry caps and timeouts.
 *  3. HEALTH    — rolling extraction-success monitor; warns the user when
 *                 Amazon has likely changed their markup.
 *  4. STORE     — settings (GM), cache (localStorage), session CSV data.
 *  5. SHEETS    — batched Google Sheets webhook with retry + sendBeacon.
 *  6. UI        — toolbar, status badge, info boxes, settings panel,
 *                 toasts, styles. Localized (en/hi/de/fr/es/ja).
 *  7. APP       — observers and orchestration.
 */

(function () {
'use strict';

/* ═══════════════════════ 0. CONFIG ═══════════════════════ */

const GOOGLE_SHEET_WEBHOOK = "PASTE_YOUR_WEB_APP_URL_HERE";

const DEFAULT_SETTINGS = {
  redCountries: "CN, HK",
  greenCountries: "",
  hideRed: false,
  autoCsv: true,
  sheetsSync: true,
  cacheDaysAsin: 1,
  cacheDaysSeller: 7,
  collapsed: false
};

const MAX_CONCURRENT = 3;
const MAX_ROWS = 5000;
const CAPTCHA_COOLDOWN_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;
const MAX_CAPTCHA_RETRIES = 2;

/* ═══════════════════════ 1. PARSERS (pure, unit-tested) ═══════════════════════ */
// [TESTABLE-START] — everything between these markers is extracted and run
// by the test harness under jsdom. Keep it free of browser/app state.

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

const COUNTRY_LABEL_RE = /(?:Country|Land|Pays|Pa[ií]s|Paese|Kraj|Ülke|国)\s*[:：]\s*([^\n<]{2,40})/i;

function safeParse(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function csvList(str) {
  return String(str || "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
}

function csvEscape(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

function isExpired(data, maxDays) {
  if (!data || !data.ts) return true;
  return (Date.now() - data.ts) / 86400000 > maxDays;
}

function isCaptchaPage(html) {
  return html.includes("validateCaptcha") ||
         html.includes("api-services-support@amazon.com") ||
         html.includes("Type the characters you see in this image");
}

/* "4.2 out of 5 stars" / "4,2 von 5 Sternen" → "4.2" */
function extractRating(text) {
  if (!text) return null;
  const m = text.match(/(\d+[.,]?\d*)/);
  return m ? m[1].replace(',', '.') : null;
}

function looksLikeAmazon(name) {
  return /^amazon(\.[a-z.]{2,10})?$/i.test((name || '').trim());
}

/*
 * Parse the All-Offers-Display ajax fragment (fast path, ~100KB).
 * Returns {sellerId, sellerName, sellerType} or null when the
 * fragment doesn't contain a recognizable offer.
 */
function parseAOD(doc, origin) {
  const pinned = doc.querySelector('#aod-pinned-offer') || doc;
  const soldBy = pinned.querySelector('#aod-offer-soldBy');
  if (!soldBy) return null;

  let sellerId = null, sellerName = '', sellerType = 'FBM';

  const link = soldBy.querySelector('a[href*="seller="]');
  if (link) {
    try {
      sellerId = new URL(link.getAttribute('href'), origin).searchParams.get('seller');
    } catch (e) { sellerId = null; }
    sellerName = link.textContent.trim();
  } else {
    // Amazon-as-seller renders as plain text, not a link
    const spans = soldBy.querySelectorAll('span');
    for (const s of spans) {
      const t = s.textContent.trim();
      if (t && !/sold by|verkauf|vendu|vendido|venduto|販売/i.test(t)) { sellerName = t; }
    }
    if (!sellerName) sellerName = soldBy.textContent.trim();
  }
  if (!sellerName) return null;

  const shipsFrom = pinned.querySelector('#aod-offer-shipsFrom');
  if (shipsFrom && /amazon/i.test(shipsFrom.textContent)) sellerType = 'FBA';
  if (looksLikeAmazon(sellerName)) { sellerName = 'Amazon'; sellerType = 'Amazon'; }

  return { sellerId, sellerName, sellerType };
}

/*
 * Parse a full product page (fallback path).
 * Returns {sellerId, sellerName, pRating, sellerType, extracted}.
 * `extracted` is false when nothing trustworthy was found — callers
 * must NOT cache such results.
 */
function parseProductPage(doc, rawHtml, origin) {
  let sellerId = null, sellerName = 'Unknown', pRating = 'N/A',
      sellerType = 'FBM', extracted = false;

  const rEl = doc.querySelector('#acrPopover, .a-icon-alt');
  if (rEl) pRating = extractRating(rEl.getAttribute('title') || rEl.textContent) || 'N/A';

  const merchantInfo = doc.querySelector('#merchant-info, #tabular-buybox');
  const merchantText = (merchantInfo ? merchantInfo.textContent : '').toLowerCase();

  const sEl = doc.querySelector('#sellerProfileTriggerId, #merchant-info a[href*="seller="]');
  if (sEl) {
    try {
      sellerId = new URL(sEl.getAttribute('href'), origin).searchParams.get('seller');
    } catch (e) { sellerId = null; }
    sellerName = sEl.textContent.trim();
    extracted = true;
  } else if (SOLD_BY_AMAZON_PHRASES.some(p => merchantText.includes(p))) {
    sellerName = 'Amazon';
    extracted = true;
  }

  if (FBA_PHRASES.some(p => rawHtml.includes(p))) sellerType = 'FBA';
  if (sellerName === 'Amazon') sellerType = 'Amazon';

  return { sellerId, sellerName, pRating, sellerType, extracted };
}

/*
 * Parse a seller profile page (/sp?seller=...).
 * Returns {country, score, count, found}.
 * Handles thousands separators in feedback counts ("1,234 ratings").
 */
function parseSellerPage(doc) {
  let country = '?', score = '0%', count = '0', found = false;

  const address = doc.querySelectorAll('.indent-left');
  if (address.length > 0) {
    country = address[address.length - 1].textContent.trim().toUpperCase();
    found = true;
  } else {
    const m = (doc.body ? doc.body.textContent : '').match(COUNTRY_LABEL_RE);
    if (m) { country = m[1].trim().toUpperCase(); found = true; }
  }

  const feedback = doc.querySelector('#seller-info-feedback-summary');
  if (feedback) {
    const m = feedback.textContent.match(/(\d+%).*?\(([\d,.\s]+)/);
    if (m) {
      score = m[1];
      count = m[2].replace(/[^\d]/g, '') || '0';
      found = true;
    }
  }

  return { country, score, count, found };
}

// [TESTABLE-END]

/* ═══════════════════════ I18N ═══════════════════════ */

const I18N = {
  en: { settings: '⚙️ SoldBy', csv: '📥 CSV', reset: '🔄 Reset', loading: 'Loading…',
        queued: 'left', paused: '⏸ Paused (robot check)', savedOk: '✅ Settings saved.',
        cacheCleared: '🧹 Seller cache cleared.', csvCleared: 'CSV list cleared.',
        noData: 'No data collected yet. Scroll through some products first.',
        captchaToast: '⚠️ Amazon robot check detected. Pausing data collection for 5 min.',
        healthWarn: '⚠️ Most sellers are failing to load — Amazon may have changed their page layout. Try the Diagnose button in Settings.',
        panelTitle: '⚙️ Seller Revealer Settings',
        redLabel: '🔴 Red-flag countries', greenLabel: '🟢 Green countries',
        listHint: '(comma separated, e.g. CN, HK)',
        hideRed: 'Dim products from red-flag countries',
        autoCsv: 'Auto-collect CSV data while scrolling',
        sheets: 'Push rows to Google Sheets webhook',
        cacheAsin: 'Product cache expiry (days)', cacheSeller: 'Seller cache expiry (days)',
        clearCache: '🧹 Clear Cache', diagnose: '🩺 Diagnose', cancel: 'Cancel', save: '💾 Save',
        diagRunning: 'Running diagnostics on a product from this page…',
        diagNoAsin: 'No product found on this page to test with.',
        unknownSeller: 'Unknown' },
  hi: { settings: '⚙️ विक्रेता', csv: '📥 CSV', reset: '🔄 रीसेट', loading: 'लोड हो रहा है…',
        queued: 'बाकी', paused: '⏸ रुका हुआ (रोबोट जांच)', savedOk: '✅ सेटिंग्स सहेजी गईं।',
        cacheCleared: '🧹 कैश साफ़ किया गया।', csvCleared: 'CSV सूची साफ़ की गई।',
        noData: 'अभी तक कोई डेटा नहीं। पहले कुछ उत्पाद स्क्रॉल करें।',
        captchaToast: '⚠️ Amazon रोबोट जांच मिली। 5 मिनट के लिए रुका।',
        healthWarn: '⚠️ अधिकांश विक्रेता लोड नहीं हो रहे — Amazon ने लेआउट बदला हो सकता है। Settings में Diagnose आज़माएँ।',
        panelTitle: '⚙️ Seller Revealer सेटिंग्स',
        redLabel: '🔴 लाल-सूची देश', greenLabel: '🟢 हरी-सूची देश',
        listHint: '(कॉमा से अलग, जैसे CN, HK)',
        hideRed: 'लाल-सूची देशों के उत्पाद धुंधले करें',
        autoCsv: 'स्क्रॉल करते समय CSV डेटा अपने आप इकट्ठा करें',
        sheets: 'Google Sheets webhook पर भेजें',
        cacheAsin: 'उत्पाद कैश अवधि (दिन)', cacheSeller: 'विक्रेता कैश अवधि (दिन)',
        clearCache: '🧹 कैश साफ़ करें', diagnose: '🩺 जांच', cancel: 'रद्द करें', save: '💾 सहेजें',
        diagRunning: 'इस पृष्ठ के एक उत्पाद पर जांच चल रही है…',
        diagNoAsin: 'जांच के लिए इस पृष्ठ पर कोई उत्पाद नहीं मिला।',
        unknownSeller: 'अज्ञात' },
  de: { settings: '⚙️ Verkäufer', csv: '📥 CSV', reset: '🔄 Zurücksetzen', loading: 'Lädt…',
        queued: 'übrig', paused: '⏸ Pausiert (Robot-Check)', savedOk: '✅ Einstellungen gespeichert.',
        cacheCleared: '🧹 Cache geleert.', csvCleared: 'CSV-Liste geleert.',
        noData: 'Noch keine Daten. Erst durch Produkte scrollen.',
        captchaToast: '⚠️ Amazon-Robot-Check erkannt. 5 Min. Pause.',
        healthWarn: '⚠️ Die meisten Verkäufer laden nicht — Amazon hat evtl. das Layout geändert. Diagnose in den Einstellungen versuchen.',
        panelTitle: '⚙️ Seller Revealer Einstellungen',
        redLabel: '🔴 Rote Länder', greenLabel: '🟢 Grüne Länder',
        listHint: '(kommagetrennt, z. B. CN, HK)',
        hideRed: 'Produkte aus roten Ländern abdunkeln',
        autoCsv: 'CSV-Daten beim Scrollen automatisch sammeln',
        sheets: 'Zeilen an Google-Sheets-Webhook senden',
        cacheAsin: 'Produkt-Cache (Tage)', cacheSeller: 'Verkäufer-Cache (Tage)',
        clearCache: '🧹 Cache leeren', diagnose: '🩺 Diagnose', cancel: 'Abbrechen', save: '💾 Speichern',
        diagRunning: 'Diagnose läuft an einem Produkt dieser Seite…',
        diagNoAsin: 'Kein Produkt zum Testen auf dieser Seite gefunden.',
        unknownSeller: 'Unbekannt' },
  fr: { settings: '⚙️ Vendeur', csv: '📥 CSV', reset: '🔄 Réinit.', loading: 'Chargement…',
        queued: 'restants', paused: '⏸ En pause (captcha)', savedOk: '✅ Paramètres enregistrés.',
        cacheCleared: '🧹 Cache vidé.', csvCleared: 'Liste CSV vidée.',
        noData: 'Pas encore de données. Faites défiler des produits.',
        captchaToast: '⚠️ Captcha Amazon détecté. Pause de 5 min.',
        healthWarn: '⚠️ La plupart des vendeurs ne chargent pas — Amazon a peut-être changé sa mise en page. Essayez Diagnostic dans les paramètres.',
        panelTitle: '⚙️ Paramètres Seller Revealer',
        redLabel: '🔴 Pays à risque', greenLabel: '🟢 Pays approuvés',
        listHint: '(séparés par des virgules, ex. CN, HK)',
        hideRed: 'Atténuer les produits des pays à risque',
        autoCsv: 'Collecter les données CSV automatiquement',
        sheets: 'Envoyer au webhook Google Sheets',
        cacheAsin: 'Cache produit (jours)', cacheSeller: 'Cache vendeur (jours)',
        clearCache: '🧹 Vider le cache', diagnose: '🩺 Diagnostic', cancel: 'Annuler', save: '💾 Enregistrer',
        diagRunning: 'Diagnostic en cours sur un produit de cette page…',
        diagNoAsin: 'Aucun produit trouvé pour le test.',
        unknownSeller: 'Inconnu' },
  es: { settings: '⚙️ Vendedor', csv: '📥 CSV', reset: '🔄 Reiniciar', loading: 'Cargando…',
        queued: 'restantes', paused: '⏸ Pausado (captcha)', savedOk: '✅ Ajustes guardados.',
        cacheCleared: '🧹 Caché borrada.', csvCleared: 'Lista CSV borrada.',
        noData: 'Aún no hay datos. Desplázate por algunos productos.',
        captchaToast: '⚠️ Captcha de Amazon detectado. Pausa de 5 min.',
        healthWarn: '⚠️ La mayoría de vendedores no cargan — Amazon pudo cambiar su diseño. Prueba Diagnóstico en Ajustes.',
        panelTitle: '⚙️ Ajustes de Seller Revealer',
        redLabel: '🔴 Países en rojo', greenLabel: '🟢 Países en verde',
        listHint: '(separados por comas, ej. CN, HK)',
        hideRed: 'Atenuar productos de países en rojo',
        autoCsv: 'Recolectar datos CSV automáticamente',
        sheets: 'Enviar filas al webhook de Google Sheets',
        cacheAsin: 'Caducidad caché de producto (días)', cacheSeller: 'Caducidad caché de vendedor (días)',
        clearCache: '🧹 Borrar caché', diagnose: '🩺 Diagnóstico', cancel: 'Cancelar', save: '💾 Guardar',
        diagRunning: 'Ejecutando diagnóstico en un producto de esta página…',
        diagNoAsin: 'No se encontró producto para probar.',
        unknownSeller: 'Desconocido' },
  ja: { settings: '⚙️ 出品者', csv: '📥 CSV', reset: '🔄 リセット', loading: '読み込み中…',
        queued: '件残り', paused: '⏸ 一時停止（ロボット確認）', savedOk: '✅ 設定を保存しました。',
        cacheCleared: '🧹 キャッシュを消去しました。', csvCleared: 'CSVリストを消去しました。',
        noData: 'まだデータがありません。商品をスクロールしてください。',
        captchaToast: '⚠️ Amazonのロボット確認を検出。5分間停止します。',
        healthWarn: '⚠️ 出品者情報の取得に失敗しています — Amazonのレイアウト変更の可能性。設定の「診断」をお試しください。',
        panelTitle: '⚙️ Seller Revealer 設定',
        redLabel: '🔴 警告国', greenLabel: '🟢 安全国',
        listHint: '（カンマ区切り、例: CN, HK）',
        hideRed: '警告国の商品を暗くする',
        autoCsv: 'スクロール中にCSVデータを自動収集',
        sheets: 'Google Sheets Webhookへ送信',
        cacheAsin: '商品キャッシュ有効期限（日）', cacheSeller: '出品者キャッシュ有効期限（日）',
        clearCache: '🧹 キャッシュ消去', diagnose: '🩺 診断', cancel: 'キャンセル', save: '💾 保存',
        diagRunning: 'このページの商品で診断を実行中…',
        diagNoAsin: 'テストする商品が見つかりません。',
        unknownSeller: '不明' }
};

function detectLang() {
  const nav = (navigator.language || 'en').slice(0, 2);
  if (I18N[nav]) return nav;
  const host = location.hostname;
  if (host.endsWith('.de')) return 'de';
  if (host.endsWith('.fr')) return 'fr';
  if (host.endsWith('.es') || host.endsWith('.com.mx')) return 'es';
  if (host.endsWith('.co.jp')) return 'ja';
  return 'en';
}

const T = I18N[detectLang()];

/* ═══════════════════════ 2. NET — adaptive throttled queue ═══════════════════════ */

const Net = {
  queue: [],
  active: 0,
  pausedUntil: 0,
  // Adaptive throttle: speeds up on sustained success, backs off on trouble
  baseDelay: 450,
  jitter: 450,
  okStreak: 0,

  fetch(url) {
    return new Promise((resolve) => {
      this.queue.push({ url, resolve, tries: 0 });
      UI.updateStatus();
      this.pump();
    });
  },

  onSuccess() {
    this.okStreak++;
    if (this.okStreak >= 10 && this.baseDelay > 350) {
      this.baseDelay -= 25;
      this.okStreak = 0;
    }
  },

  onTrouble() {
    this.okStreak = 0;
    this.baseDelay = Math.min(1500, this.baseDelay + 200);
  },

  async pump() {
    if (this.active >= MAX_CONCURRENT || this.queue.length === 0) return;

    const now = Date.now();
    if (now < this.pausedUntil) {
      setTimeout(() => this.pump(), this.pausedUntil - now + 1000);
      return;
    }

    const item = this.queue.shift();
    this.active++;

    try {
      await new Promise(r => setTimeout(r, this.baseDelay + Math.random() * this.jitter));
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(item.url, { signal: ctrl.signal });
      const text = await res.text();
      clearTimeout(timeout);

      if (isCaptchaPage(text)) {
        console.warn('[SellerRevealer] Robot check — pausing 5 min.');
        this.pausedUntil = Date.now() + CAPTCHA_COOLDOWN_MS;
        this.onTrouble();
        item.tries++;
        if (item.tries <= MAX_CAPTCHA_RETRIES) this.queue.push(item);
        else item.resolve(null);
        UI.toast(T.captchaToast);
      } else {
        this.onSuccess();
        item.resolve(text);
      }
    } catch (e) {
      console.warn('[SellerRevealer] Fetch error:', e);
      this.onTrouble();
      item.resolve(null);
    }

    this.active--;
    UI.updateStatus();
    this.pump();
  }
};

/* ═══════════════════════ 3. HEALTH — extraction monitor ═══════════════════════ */

const Health = {
  results: [],   // rolling window of booleans (true = seller extracted)
  warned: false,

  record(ok) {
    this.results.push(!!ok);
    if (this.results.length > 30) this.results.shift();

    if (!this.warned && this.results.length >= 12) {
      const recent = this.results.slice(-12);
      const failRate = recent.filter(r => !r).length / recent.length;
      if (failRate > 0.6) {
        this.warned = true;
        UI.toast(T.healthWarn, 8000);
        console.warn('[SellerRevealer] HEALTH: extraction failure rate ' +
          Math.round(failRate * 100) + '% over last 12 products. ' +
          'Amazon markup may have changed — parsers need updating.');
      }
    }
  },

  summary() {
    if (!this.results.length) return 'no data yet';
    const ok = this.results.filter(r => r).length;
    return `${ok}/${this.results.length} extractions succeeded`;
  }
};

/* ═══════════════════════ 4. STORE ═══════════════════════ */

const Store = {
  settings: { ...DEFAULT_SETTINGS },
  rows: [],

  async loadSettings() {
    try {
      const saved = safeParse(await GM.getValue('sb-settings', null));
      if (saved) this.settings = { ...DEFAULT_SETTINGS, ...saved };
    } catch (e) { /* defaults */ }
  },

  async saveSettings() {
    try { await GM.setValue('sb-settings', JSON.stringify(this.settings)); }
    catch (e) { console.warn('Settings save failed:', e); }
  },

  asinKey(p) { return 'asin-' + p.dataset.asin; },
  sellerKey(p) { return 'seller-' + p.dataset.sellerId; },

  getCache(key, maxDays) {
    const data = safeParse(localStorage.getItem(key));
    return (data && !isExpired(data, maxDays)) ? data : null;
  },

  setCache(key, obj) {
    try { localStorage.setItem(key, JSON.stringify({ ...obj, ts: Date.now() })); }
    catch (e) { /* storage full */ }
  },

  cleanExpired() {
    let removed = 0;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith('asin-') || key.startsWith('seller-')) {
        const data = safeParse(localStorage.getItem(key));
        const maxDays = key.startsWith('asin-')
          ? this.settings.cacheDaysAsin : this.settings.cacheDaysSeller;
        if (!data || isExpired(data, maxDays)) {
          localStorage.removeItem(key);
          removed++;
        }
      }
    }
    if (removed) console.log(`[SellerRevealer] Cleaned ${removed} expired cache entries.`);
  },

  clearAllCache() {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('asin-') || key.startsWith('seller-'))) {
        localStorage.removeItem(key);
      }
    }
    UI.toast(T.cacheCleared);
  },

  loadRows() {
    this.rows = safeParse(sessionStorage.getItem('sb-collected')) || [];
  },

  persistRows() {
    try { sessionStorage.setItem('sb-collected', JSON.stringify(this.rows)); }
    catch (e) { /* keep in memory */ }
  },

  addRow(row) {
    if (this.rows.length >= MAX_ROWS) return false;
    if (this.rows.some(r => r.asin === row.asin)) return false;
    this.rows.push(row);
    this.persistRows();
    return true;
  },

  resetRows() {
    this.rows = [];
    this.persistRows();
  }
};

/* ═══════════════════════ 5. SHEETS — batched webhook ═══════════════════════ */

const Sheets = {
  buffer: [],
  timer: null,
  BATCH: 20,
  INTERVAL: 30000,

  enabled() {
    return Store.settings.sheetsSync &&
           GOOGLE_SHEET_WEBHOOK && !GOOGLE_SHEET_WEBHOOK.includes('PASTE');
  },

  push(row) {
    if (!this.enabled()) return;
    this.buffer.push(row);
    if (this.buffer.length >= this.BATCH) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), this.INTERVAL);
  },

  async flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.buffer.length) return;

    const batch = this.buffer.splice(0, this.buffer.length);
    try {
      const res = await fetch(GOOGLE_SHEET_WEBHOOK, {
        method: 'POST',
        body: JSON.stringify({ rows: batch }),
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
    } catch (e) {
      console.warn('Sheet upload failed, retrying later:', e);
      this.buffer.unshift(...batch);
      this.timer = setTimeout(() => this.flush(), this.INTERVAL);
    }
  },

  beacon() {
    if (this.buffer.length && this.enabled()) {
      navigator.sendBeacon(GOOGLE_SHEET_WEBHOOK, JSON.stringify({ rows: this.buffer }));
      this.buffer = [];
    }
  }
};

window.addEventListener('beforeunload', () => Sheets.beacon());

/* ═══════════════════════ 6. UI ═══════════════════════ */

const UI = {

  toast(msg, ms = 4000) {
    let toast = document.getElementById('sb-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'sb-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('sb-show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('sb-show'), ms);
  },

  updateStatus() {
    const el = document.getElementById('sb-status');
    if (!el) return;
    const pending = Net.queue.length + Net.active;
    if (Date.now() < Net.pausedUntil) {
      el.textContent = T.paused;
      el.style.display = 'inline-flex';
    } else if (pending > 0) {
      el.textContent = `⏳ ${pending} ${T.queued}`;
      el.style.display = 'inline-flex';
    } else {
      el.style.display = 'none';
    }
  },

  updateCsvCount() {
    const btn = document.getElementById('sb-download-csv');
    if (btn) btn.textContent = `${T.csv} (${Store.rows.length})`;
  },

  ensureToolbar() {
    if (document.getElementById('sb-toolbar')) return;

    const bar = document.createElement('div');
    bar.id = 'sb-toolbar';
    if (Store.settings.collapsed) bar.classList.add('sb-collapsed');

    const status = document.createElement('span');
    status.id = 'sb-status';
    status.style.display = 'none';

    const settingsBtn = document.createElement('button');
    settingsBtn.id = 'sb-settings';
    settingsBtn.textContent = T.settings;
    settingsBtn.addEventListener('click', () => this.openSettings());

    const csvBtn = document.createElement('button');
    csvBtn.id = 'sb-download-csv';
    csvBtn.textContent = `${T.csv} (${Store.rows.length})`;
    csvBtn.addEventListener('click', () => this.downloadCSV());

    const resetBtn = document.createElement('button');
    resetBtn.id = 'sb-reset-csv';
    resetBtn.textContent = T.reset;
    resetBtn.addEventListener('click', () => {
      Store.resetRows();
      this.updateCsvCount();
      this.toast(T.csvCleared);
    });

    const collapseBtn = document.createElement('button');
    collapseBtn.id = 'sb-collapse';
    collapseBtn.title = 'Minimize';
    collapseBtn.textContent = Store.settings.collapsed ? '◀' : '▶';
    collapseBtn.addEventListener('click', async () => {
      Store.settings.collapsed = !Store.settings.collapsed;
      bar.classList.toggle('sb-collapsed', Store.settings.collapsed);
      collapseBtn.textContent = Store.settings.collapsed ? '◀' : '▶';
      await Store.saveSettings();
    });

    bar.append(status, settingsBtn, csvBtn, resetBtn, collapseBtn);
    document.body.appendChild(bar);
  },

  downloadCSV() {
    if (!Store.rows.length) { this.toast(T.noData); return; }

    const headers = Object.keys(Store.rows[0]);
    const csv = [
      headers.join(','),
      ...Store.rows.map(row => headers.map(h => csvEscape(row[h])).join(','))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `amazon-sellers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  createInfoBox(product) {
    if (product.querySelector('.seller-info')) return;
    const box = document.createElement('div');
    const inner = document.createElement('div');
    inner.className = 'seller-info';
    inner.textContent = T.loading;
    box.appendChild(inner);
    product.appendChild(box);
  },

  populateInfoBox(product) {
    const el = product.querySelector('.seller-info');
    if (!el) return;

    el.textContent = ''; // rebuild safely — scraped names can't inject HTML

    const name = document.createElement('span');
    name.className = 'sb-name';
    name.textContent = product.dataset.sellerName || T.unknownSeller;
    el.appendChild(name);

    const rating = document.createElement('a');
    rating.className = 'sb-rating';
    rating.href = `${location.origin}/dp/${product.dataset.asin}#customerReviews`;
    rating.title = 'Open customer reviews';
    const feedback = product.dataset.sellerType === 'Amazon'
      ? '–' : (product.dataset.sellerRatingScore || '0%');
    rating.textContent = ` (${product.dataset.productRating || 'N/A'} / ${feedback}) `;
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
  },

  applyHighlight(product) {
    const country = (product.dataset.sellerCountry || '').toUpperCase();
    if (!country || country === '?') return;

    const red = csvList(Store.settings.redCountries);
    const green = csvList(Store.settings.greenCountries);
    const matches = list => list.some(c => country === c || country.includes(c));

    product.classList.remove('sb-red', 'sb-green', 'sb-hidden');

    if (matches(red)) {
      product.classList.add('sb-red');
      if (Store.settings.hideRed) product.classList.add('sb-hidden');
    } else if (matches(green)) {
      product.classList.add('sb-green');
    }
  },

  reapplyAllHighlights() {
    document.querySelectorAll('[data-processed]').forEach(p => this.applyHighlight(p));
  },

  openSettings() {
    if (document.getElementById('sb-panel-overlay')) return;

    const S = Store.settings;
    const overlay = document.createElement('div');
    overlay.id = 'sb-panel-overlay';

    const panel = document.createElement('div');
    panel.id = 'sb-panel';
    panel.innerHTML = `
      <h3>${T.panelTitle}</h3>
      <label>${T.redLabel} <small>${T.listHint}</small></label>
      <input type="text" id="sb-red">
      <label>${T.greenLabel} <small>${T.listHint}</small></label>
      <input type="text" id="sb-green">
      <label class="sb-check"><input type="checkbox" id="sb-hide-red"> ${T.hideRed}</label>
      <label class="sb-check"><input type="checkbox" id="sb-auto-csv"> ${T.autoCsv}</label>
      <label class="sb-check"><input type="checkbox" id="sb-sheets"> ${T.sheets}</label>
      <label>${T.cacheAsin}</label>
      <input type="number" id="sb-cache-asin" min="1" max="30">
      <label>${T.cacheSeller}</label>
      <input type="number" id="sb-cache-seller" min="1" max="90">
      <div class="sb-panel-row">
        <button id="sb-clear-cache" class="sb-secondary">${T.clearCache}</button>
        <button id="sb-diagnose" class="sb-secondary">${T.diagnose}</button>
        <span style="flex:1"></span>
        <button id="sb-cancel" class="sb-secondary">${T.cancel}</button>
        <button id="sb-save" class="sb-primary">${T.save}</button>
      </div>
      <div id="sb-diag-out"></div>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    panel.querySelector('#sb-red').value = S.redCountries;
    panel.querySelector('#sb-green').value = S.greenCountries;
    panel.querySelector('#sb-hide-red').checked = S.hideRed;
    panel.querySelector('#sb-auto-csv').checked = S.autoCsv;
    panel.querySelector('#sb-sheets').checked = S.sheetsSync;
    panel.querySelector('#sb-cache-asin').value = S.cacheDaysAsin;
    panel.querySelector('#sb-cache-seller').value = S.cacheDaysSeller;

    panel.querySelector('#sb-clear-cache').addEventListener('click', () => Store.clearAllCache());
    panel.querySelector('#sb-diagnose').addEventListener('click', () => App.diagnose(panel.querySelector('#sb-diag-out')));
    panel.querySelector('#sb-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    panel.querySelector('#sb-save').addEventListener('click', async () => {
      S.redCountries = panel.querySelector('#sb-red').value;
      S.greenCountries = panel.querySelector('#sb-green').value;
      S.hideRed = panel.querySelector('#sb-hide-red').checked;
      S.autoCsv = panel.querySelector('#sb-auto-csv').checked;
      S.sheetsSync = panel.querySelector('#sb-sheets').checked;
      S.cacheDaysAsin = Math.max(1, parseInt(panel.querySelector('#sb-cache-asin').value, 10) || 1);
      S.cacheDaysSeller = Math.max(1, parseInt(panel.querySelector('#sb-cache-seller').value, 10) || 7);

      await Store.saveSettings();
      this.reapplyAllHighlights();
      overlay.remove();
      this.toast(T.savedOk);
    });
  },

  ensureStyles() {
    if (document.getElementById('sb-styles')) return;
    const style = document.createElement('style');
    style.id = 'sb-styles';
    style.textContent = `
      .seller-info {
        font-size: 12px; color: #565959; background: #f0f2f2;
        border-radius: 4px; padding: 2px 6px; margin-top: 4px;
        display: inline-block; line-height: 1.4;
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
        position: fixed; bottom: 12px; right: 12px; z-index: 999999;
        display: flex; gap: 6px; align-items: center;
      }
      #sb-toolbar.sb-collapsed > button:not(#sb-collapse),
      #sb-toolbar.sb-collapsed > #sb-status { display: none !important; }
      #sb-toolbar button {
        background: #232f3e; color: #fff; border: none; border-radius: 6px;
        padding: 6px 10px; font-size: 12px; cursor: pointer;
        box-shadow: 0 2px 6px rgba(0,0,0,.25);
      }
      #sb-toolbar button:hover { background: #37475a; }
      #sb-toolbar #sb-status {
        background: rgba(15,17,17,.85); color: #ffd814; border-radius: 6px;
        padding: 6px 10px; font-size: 12px; align-items: center;
      }

      #sb-panel-overlay {
        position: fixed; inset: 0; background: rgba(15,17,17,.55);
        z-index: 1000000; display: flex; align-items: center; justify-content: center;
      }
      #sb-panel {
        background: #fff; width: 400px; max-width: 92vw; max-height: 85vh;
        overflow-y: auto; border-radius: 10px; padding: 18px 20px;
        font-size: 13px; color: #0f1111; box-shadow: 0 8px 30px rgba(0,0,0,.35);
      }
      #sb-panel h3 { margin: 0 0 12px; font-size: 16px; }
      #sb-panel label { display: block; margin: 10px 0 4px; font-weight: 600; }
      #sb-panel label small { font-weight: 400; color: #565959; }
      #sb-panel input[type="text"], #sb-panel input[type="number"] {
        width: 100%; box-sizing: border-box; padding: 6px 8px;
        border: 1px solid #d5d9d9; border-radius: 6px; font-size: 13px;
      }
      #sb-panel .sb-check { font-weight: 400; display: flex; align-items: center; gap: 8px; }
      #sb-panel .sb-panel-row { display: flex; gap: 8px; margin-top: 16px; align-items: center; flex-wrap: wrap; }
      #sb-panel button { border: none; border-radius: 6px; padding: 7px 12px; font-size: 13px; cursor: pointer; }
      #sb-panel .sb-primary { background: #ffd814; color: #0f1111; font-weight: 600; }
      #sb-panel .sb-primary:hover { background: #f7ca00; }
      #sb-panel .sb-secondary { background: #e7e9ec; color: #0f1111; }
      #sb-panel .sb-secondary:hover { background: #d5d9d9; }
      #sb-diag-out { margin-top: 12px; font-family: monospace; font-size: 12px; white-space: pre-wrap; color: #0f1111; }

      #sb-toast {
        position: fixed; bottom: 60px; right: 12px; background: #0f1111;
        color: #fff; padding: 8px 14px; border-radius: 6px; font-size: 13px;
        z-index: 1000001; opacity: 0; transform: translateY(8px);
        transition: all .25s ease; pointer-events: none; max-width: 320px;
      }
      #sb-toast.sb-show { opacity: 1; transform: translateY(0); }
    `;
    document.head.appendChild(style);
  }
};

/* ═══════════════════════ 7. APP — orchestration ═══════════════════════ */

const App = {

  aodUrl(asin) {
    return location.origin + '/gp/product/ajax/ref=aod_f_new?asin=' + asin +
           '&pc=dp&experienceId=aodAjaxMain';
  },

  scanAsins() {
    document.querySelectorAll('a[href*="/dp/"]').forEach(link => {
      const match = link.href.match(/\/dp\/([A-Z0-9]{10})/);
      if (match) {
        const parent = link.closest('[data-asin]');
        if (parent && !parent.dataset.asin) parent.dataset.asin = match[1];
      }
    });
  },

  grabCardExtras(product) {
    const priceEl = product.querySelector('.a-price .a-offscreen');
    if (priceEl) product.dataset.price = priceEl.textContent.trim();

    // Star rating is printed on the card — free, no fetch needed
    const starEl = product.querySelector('.a-icon-alt');
    if (starEl) {
      const r = extractRating(starEl.textContent);
      if (r) product.dataset.productRating = r;
    }

    const reviewEl = product.querySelector(
      'span.a-size-base.s-underline-text, a[href*="#customerReviews"] span, .a-icon-star-small ~ span.a-size-small'
    );
    if (reviewEl) {
      const m = reviewEl.textContent.replace(/[,.]/g, '').match(/\d+/);
      if (m) product.dataset.reviewCount = m[0];
    }
  },

  applySellerData(product, data) {
    product.dataset.sellerName = data.sellerName;
    product.dataset.sellerId = data.sellerId || '';
    product.dataset.productRating = product.dataset.productRating || data.pRating || 'N/A';
    product.dataset.sellerType = data.sellerType;
  },

  async resolveSeller(product) {
    if (!product.dataset.asin) return;

    // 1. Fast path: AOD ajax (~100KB)
    const aodHtml = await Net.fetch(this.aodUrl(product.dataset.asin));
    if (aodHtml) {
      const doc = new DOMParser().parseFromString(aodHtml, 'text/html');
      const data = parseAOD(doc, location.origin);
      if (data) {
        this.applySellerData(product, data);
        Store.setCache(Store.asinKey(product), {
          sid: data.sellerId, sn: data.sellerName,
          pr: product.dataset.productRating, st: data.sellerType
        });
        Health.record(true);
        this.afterSellerKnown(product);
        return;
      }
    }

    // 2. Fallback: full product page
    const pageHtml = await Net.fetch(location.origin + '/dp/' + product.dataset.asin);
    if (!pageHtml) { Health.record(false); return; }

    const doc = new DOMParser().parseFromString(pageHtml, 'text/html');
    const data = parseProductPage(doc, pageHtml, location.origin);

    this.applySellerData(product, data);
    if (data.extracted) {
      Store.setCache(Store.asinKey(product), {
        sid: data.sellerId, sn: data.sellerName,
        pr: product.dataset.productRating, st: data.sellerType
      });
    }
    Health.record(data.extracted);
    this.afterSellerKnown(product);
  },

  resolveSellerFromCache(product, cached) {
    this.applySellerData(product, {
      sellerName: cached.sn, sellerId: cached.sid,
      pRating: cached.pr, sellerType: cached.st
    });
    this.afterSellerKnown(product);
  },

  afterSellerKnown(product) {
    if (!product.dataset.sellerId) {
      // Amazon itself, or no seller page to consult
      UI.populateInfoBox(product);
      if (Store.settings.autoCsv) this.collect(product);
      return;
    }

    const cached = Store.getCache(Store.sellerKey(product), Store.settings.cacheDaysSeller);
    if (cached) {
      product.dataset.sellerCountry = cached.c || '?';
      product.dataset.sellerRatingScore = cached.rs || '0%';
      product.dataset.sellerRatingCount = cached.rc || '0';
      UI.populateInfoBox(product);
      UI.applyHighlight(product);
      if (Store.settings.autoCsv) this.collect(product);
      return;
    }

    this.resolveSellerProfile(product);
  },

  async resolveSellerProfile(product) {
    const html = await Net.fetch(location.origin + '/sp?seller=' + product.dataset.sellerId);
    if (!html) { UI.populateInfoBox(product); return; }

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const data = parseSellerPage(doc);

    if (data.found) {
      Store.setCache(Store.sellerKey(product), {
        c: data.country, rs: data.score, rc: data.count
      });
    }

    product.dataset.sellerCountry = data.country;
    product.dataset.sellerRatingScore = data.score;
    product.dataset.sellerRatingCount = data.count;

    UI.populateInfoBox(product);
    UI.applyHighlight(product);
    if (Store.settings.autoCsv) this.collect(product);
  },

  collect(product) {
    const asin = product.dataset.asin;
    if (!asin) return;

    const row = {
      asin,
      seller: product.dataset.sellerName,
      sellerId: product.dataset.sellerId,
      country: product.dataset.sellerCountry || '',
      productRating: product.dataset.productRating,
      reviewCount: product.dataset.reviewCount || '',
      sellerFeedback: product.dataset.sellerRatingScore || '',
      feedbackCount: product.dataset.sellerRatingCount || '',
      price: product.dataset.price || '',
      type: product.dataset.sellerType,
      url: location.origin + '/dp/' + asin,
      sourcePage: location.href,
      date: new Date().toISOString()
    };

    if (Store.addRow(row)) {
      Sheets.push(row);
      UI.updateCsvCount();
    }
  },

  /* Built-in diagnostics: tests all three extraction layers against a
     live product from the current page, and reports which ones work. */
  async diagnose(outEl) {
    const first = document.querySelector('[data-asin]:not([data-asin=""])');
    if (!first || !first.dataset.asin) {
      outEl.textContent = T.diagNoAsin;
      return;
    }
    const asin = first.dataset.asin;
    outEl.textContent = T.diagRunning;

    const lines = [`ASIN: ${asin}`, `Health: ${Health.summary()}`];

    const aodHtml = await Net.fetch(this.aodUrl(asin));
    if (!aodHtml) {
      lines.push('AOD endpoint: ✗ no response (network/captcha)');
    } else if (isCaptchaPage(aodHtml)) {
      lines.push('AOD endpoint: ✗ robot check page');
    } else {
      const aod = parseAOD(new DOMParser().parseFromString(aodHtml, 'text/html'), location.origin);
      lines.push(aod
        ? `AOD parser: ✓ ${aod.sellerName} [${aod.sellerType}] id=${aod.sellerId || '–'}`
        : 'AOD parser: ✗ fragment received but no offer found (markup change?)');
    }

    const pageHtml = await Net.fetch(location.origin + '/dp/' + asin);
    if (!pageHtml) {
      lines.push('Product page: ✗ no response');
    } else if (isCaptchaPage(pageHtml)) {
      lines.push('Product page: ✗ robot check page');
    } else {
      const pp = parseProductPage(new DOMParser().parseFromString(pageHtml, 'text/html'), pageHtml, location.origin);
      lines.push(pp.extracted
        ? `Page parser: ✓ ${pp.sellerName} [${pp.sellerType}] rating=${pp.pRating}`
        : 'Page parser: ✗ page received but seller not found (markup change?)');
    }

    outEl.textContent = lines.join('\n');
  },

  boot() {
    const viewObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          viewObserver.unobserve(entry.target);
          this.resolveSeller(entry.target);
        }
      });
    }, { rootMargin: '400px' });

    const scan = () => {
      UI.ensureToolbar();   // self-healing: Amazon re-renders can wipe these
      UI.ensureStyles();
      this.scanAsins();

      const selectors = [
        'div[data-asin]:not([data-asin=""]):not([data-processed])',
        'li[data-asin]:not([data-asin=""]):not([data-processed])',
        '#gridItemRoot:not([data-processed])'
      ];

      document.querySelectorAll(selectors.join(',')).forEach((product) => {
        product.dataset.processed = 'true';
        UI.createInfoBox(product);
        this.grabCardExtras(product);

        const cached = Store.getCache(Store.asinKey(product), Store.settings.cacheDaysAsin);
        if (cached) this.resolveSellerFromCache(product, cached);
        else viewObserver.observe(product);   // viewport-priority loading
      });
    };

    let debounceTimer;
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(scan, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    scan();
  }
};

/* ═══════════════════════ BOOT ═══════════════════════ */

(async function main() {
  await Store.loadSettings();
  Store.loadRows();
  Store.cleanExpired();
  UI.ensureStyles();
  UI.ensureToolbar();
  UI.updateCsvCount();
  App.boot();
})();

})();
