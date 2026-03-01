// ==UserScript==
// @name         Reveal Seller - (Auto-CSV + Clickable Ratings + Reset)
// @name:de      Reveal Seller - (Auto-CSV + Klickbare Bewertungen + Zurücksetzen)
// @name:fr      Reveal Seller - (Auto-CSV + Évaluations cliquables + Réinitialiser)
// @name:es      Reveal Seller - (Auto-CSV + Calificaciones clicables + Restablecer)
// @name:it      Reveal Seller - (Auto-CSV + Valutazioni cliccabili + Ripristina)
// @name:jp      Reveal Seller - (自動CSV + クリック可能な評価 + リセット)
// @name:tr      Reveal Seller - (Otomatik CSV + Tıklanabilir Değerlendirmeler + Sıfırla)
// @namespace    https://github.com/smartrwl
// @author       Smartrwl
// @version      1.2.0
// @description  Shows seller name and hybrid ratings. Auto-collects data for CSV as you scroll with a reset option.
// @match        https://www.amazon.co.jp/*
// @match        https://www.amazon.co.uk/*
// @match        https://www.amazon.com/*
// @match        https://www.amazon.in/*
// @match        https://www.amazon.com.be/*
// @match        https://www.amazon.com.mx/*
// @match        https://www.amazon.com.tr/*
// @match        https://www.amazon.de/*
// @match        https://www.amazon.es/*
// @match        https://www.amazon.fr/*
// @match        https://www.amazon.it/*
// @match        https://www.amazon.nl/*
// @match        https://www.amazon.se/*
// @require      https://openuserjs.org/src/libs/sizzle/GM_config.min.js
// @grant        GM.getValue
// @grant        GM.setValue
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  let collectedData = [];

  // --- STORAGE & CONFIG LOGIC ---
  function accessLocalStorageItems(type, deleteItems = false) {
    const entries = Object.keys(localStorage).filter(storageItem => storageItem.startsWith(type.toLowerCase() + '-'))
    if (!deleteItems) return entries.length
    const approval = confirm(`Do you really want to delete all ${entries.length} ${type}s?`)
    if (!approval) return null
    entries.forEach(storageItem => localStorage.removeItem(storageItem))
    updateLocalStorageItemCount(type)
    alert(`Done! ${entries.length} ${type} entries deleted`)
  }

  function updateLocalStorageItemCount(type) {
    const field = GM_config.fields[`local-storage-clear-${type.toLowerCase()}`];
    if (field && field.node) field.node.value = `Delete ${accessLocalStorageItems(type)} ${type}s from local storage`;
  }

  const frame = document.createElement('div');
  frame.classList.add('sb-options');
  const backdrop = document.createElement('div');
  backdrop.classList.add('sb-options--backdrop');
  document.body.appendChild(frame);
  document.body.appendChild(backdrop);

  GM_config.init({
    'id': 'sb-settings',
    'title': 'SoldBy Settings',
    'fields': {
      'auto-csv-enabled': { 'label': 'Enable Auto-CSV Collection', 'type': 'checkbox', 'default': true }, // 👈 ADDON: New Toggle
      'countries': { 'section': ['Countries to highlight', 'ISO codes'], 'label': 'List of country codes', 'type': 'text', 'default': 'CN, HK' },
      'unknown': { 'label': 'Highlight unknown countries', 'type': 'checkbox', 'default': true },
      'hide': { 'label': 'Hide highlighted products', 'type': 'checkbox', 'default': false },
      'max-asin-age': { 'label': 'ASIN re-fetch days', 'type': 'int', 'default': 1 },
      'max-seller-age': { 'label': 'Seller re-fetch days', 'type': 'int', 'default': 7 },
      'local-storage-clear-asin': { 'type': 'button', 'click': () => accessLocalStorageItems('ASIN', true) },
      'local-storage-clear-seller': { 'type': 'button', 'click': () => accessLocalStorageItems('Seller', true) },
    },
    'events': {
      'init': onInit,
      'open': () => {
        GM_config.frame.removeAttribute('style');
        backdrop.style.display = 'block';
        updateLocalStorageItemCount('ASIN');
        updateLocalStorageItemCount('Seller');
      },
      'save': () => GM_config.close(),
      'close': () => backdrop.removeAttribute('style')
    },
    'frame': frame
  });

  function onInit() {
    addSettingsAndDownloadButtons();

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
            if (localStorage.getItem(asinKey(product))) {
                getSellerIdAndNameFromLocalStorage(product);
            } else {
                getSellerIdAndNameFromProductPage(product);
            }
        });
    }

    const observer = new MutationObserver(showData);
    observer.observe(document.body, { childList: true, subtree: true });
    showData();

    function getAsin() {
      const selectors = ['#gridItemRoot:not([data-asin])', '.zg-grid-general-faceout:not([data-asin])'];
      document.querySelectorAll(selectors.join(',')).forEach((p) => {
        const link = p.querySelector('a[href*="/dp/"]');
        if (link) {
          const match = link.href.match(/\/dp\/(.{10})/);
          if (match) p.dataset.asin = match[1];
        }
      });
    }

    function getSellerIdAndNameFromProductPage(product) {
      if (!product.dataset.asin) return;
      const link = window.location.origin + '/dp/' + product.dataset.asin + '?psc=1';
      fetch(link).then(res => res.text()).then(html => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        let sellerId, sellerName, pRating = "N/A";

        const rEl = doc.querySelector('#acrPopover, .a-star-rating .a-icon-alt');
        if (rEl) {
            const rText = rEl.getAttribute('title') || rEl.textContent;
            const rMatch = rText.match(/(\d+\.?\d*)/);
            if (rMatch) pRating = parseFloat(rMatch[1]).toFixed(1);
        }

        const sEl = doc.querySelector('#sellerProfileTriggerId, #merchant-info a:first-of-type');
        if (sEl) {
          const sParams = new URLSearchParams(sEl.href);
          sellerId = sParams.get('seller');
          sellerName = sEl.textContent.trim();
        } else {
          sellerName = html.includes('sold by Amazon') ? 'Amazon' : 'Unknown';
        }

        product.dataset.sellerName = sellerName;
        product.dataset.productRating = pRating;
        if (sellerId) {
            product.dataset.sellerId = sellerId;
            localStorage.setItem(asinKey(product), JSON.stringify({sid: sellerId, sn: sellerName, pr: pRating, ts: Date.now()}));
        }
        setSellerDetails(product);
      });
    }

    function getSellerIdAndNameFromLocalStorage(product) {
        const data = JSON.parse(localStorage.getItem(asinKey(product)));
        product.dataset.sellerName = data.sn;
        product.dataset.sellerId = data.sid || "";
        product.dataset.productRating = data.pr || "N/A";
        setSellerDetails(product);
    }

    function setSellerDetails(product) {
      if (product.dataset.sellerName.includes('Amazon') || product.dataset.sellerName == 'Unknown') {
        populateInfoBox(product);
        return;
      }
      const cachedSeller = localStorage.getItem(sellerKey(product));
      if (cachedSeller) {
        getSellerCountryAndRatingfromLocalStorage(product);
      } else {
        getSellerCountryAndRatingfromSellerPage(product);
      }
    }

    function getSellerCountryAndRatingfromLocalStorage(product) {
      const data = JSON.parse(localStorage.getItem(sellerKey(product)));
      product.dataset.sellerCountry = data.c;
      product.dataset.sellerRatingScore = data.rs;
      product.dataset.sellerRatingCount = data.rc;
      populateInfoBox(product);
      collectCSVData(product.dataset.asin, product.dataset.sellerName, product.dataset.sellerId, product.dataset.productRating, data.rs);
    }

    function getSellerCountryAndRatingfromSellerPage(product) {
      const link = window.location.origin + '/sp?seller=' + product.dataset.sellerId;
      fetch(link).then(res => res.text()).then(html => {
        const sellerPage = new DOMParser().parseFromString(html, 'text/html');
        const address = sellerPage.querySelectorAll('.indent-left');
        const country = address.length > 0 ? address[address.length - 1].textContent.trim().toUpperCase() : '?';
        const feedback = sellerPage.querySelector('#seller-info-feedback-summary');
        let score = '0%', count = '0';
        if (feedback) {
          const match = feedback.textContent.match(/(\d+%).*?\((\d+)/);
          if (match) { score = match[1]; count = match[2]; }
        }
        product.dataset.sellerCountry = country;
        product.dataset.sellerRatingScore = score;
        product.dataset.sellerRatingCount = count;
        localStorage.setItem(sellerKey(product), JSON.stringify({c: country, rs: score, rc: count, ts: Date.now()}));
        populateInfoBox(product);
        collectCSVData(product.dataset.asin, product.dataset.sellerName, product.dataset.sellerId, product.dataset.productRating, score);
      });
    }

    function createInfoBox(product) {
        const box = document.createElement('div');
        box.className = 'seller-info-ct';
        box.innerHTML = `<div class="seller-info"><div class="seller-icon seller-loading"></div><div class="seller-text">loading...</div></div>`;
        const title = product.querySelector('h2, .p13n-sc-truncate, .a-link-normal, .a-price');
        if (title && title.parentNode) {
            title.parentNode.insertBefore(box, title.nextSibling);
        }
    }

    function populateInfoBox(product) {
        const text = product.querySelector('.seller-text');
        const icon = product.querySelector('.seller-icon');
        if (!text || !icon) return;
        icon.classList.remove('seller-loading');

        const pRating = product.dataset.productRating || "N/A";
        const sFeedback = (product.dataset.sellerRatingScore || "0%").replace(/\s/g, '');

        const reviewLink = window.location.origin + '/dp/' + product.dataset.asin + '#customerReviews';
        const hybridDisplay = ` <a href="${reviewLink}" class="sb-hybrid-link">(${pRating}/${sFeedback})</a>`;

        text.innerHTML = `❓ ${product.dataset.sellerName}${hybridDisplay}`;

        if (product.dataset.sellerName === 'Amazon') {
            icon.innerHTML = '<img src="/favicon.ico" style="width:0.8em;height:0.8em;">';
            text.innerHTML = `📦 Amazon <a href="${reviewLink}" class="sb-hybrid-link">(${pRating}/100%)</a>`;
        } else if (product.dataset.sellerCountry) {
            icon.textContent = getFlagEmoji(product.dataset.sellerCountry);
        }
    }

    function collectCSVData(asin, seller, sid, pRating, sScore) {
        // 👈 ADDON: Only collect data if the setting is checked
        if (GM_config.get('auto-csv-enabled') === false) return; 

        if (!collectedData.some(item => item.asin === asin)) {
            collectedData.push({ asin, seller, sellerId: sid || "N/A", pRating, sScore });
            updateCSVButtonCount();
        }
    }

    function updateCSVButtonCount() {
        const csvBtn = document.getElementById('sb-download-csv');
        if (csvBtn) csvBtn.textContent = `📥 CSV (${collectedData.length})`;
    }

    function addSettingsAndDownloadButtons() {
        const footer = document.querySelector('.navFooterCopyright');
        if (!footer || document.getElementById('sb-download-csv')) return;

        const btnContainer = document.createElement('div');
        btnContainer.style.marginTop = "10px";

        const gearBtn = document.createElement('button');
        gearBtn.textContent = '⚙️ SoldBy';
        gearBtn.className = 'sb-btn';
        gearBtn.onclick = () => GM_config.open();

        const csvBtn = document.createElement('button');
        csvBtn.id = 'sb-download-csv';
        csvBtn.textContent = '📥 CSV (0)';
        csvBtn.className = 'sb-btn';
        csvBtn.style.marginLeft = "10px";
        csvBtn.onclick = downloadCSV;

        const resetBtn = document.createElement('button');
        resetBtn.textContent = '🔄 Reset CSV';
        resetBtn.className = 'sb-btn';
        resetBtn.style.marginLeft = "10px";
        resetBtn.onclick = () => {
            if (confirm("Clear all collected products from the CSV list?")) {
                collectedData = [];
                updateCSVButtonCount();
            }
        };

        btnContainer.appendChild(gearBtn);
        btnContainer.appendChild(csvBtn);
        btnContainer.appendChild(resetBtn);
        footer.appendChild(btnContainer);
    }

    function downloadCSV() {
        if (collectedData.length === 0) {
            alert("No data collected yet! Please scroll to see products.");
            return;
        }
        let csvContent = "data:text/csv;charset=utf-8,ASIN,Seller Name,Seller ID,Product Rating,Seller Feedback\n";
        collectedData.forEach(row => {
            csvContent += `${row.asin},"${row.seller.replace(/"/g, '""')}",${row.sellerId},${row.pRating},${row.sScore}\n`;
        });
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `amazon_data_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function asinKey(p) { return 'asin-' + p.dataset.asin; }
    function sellerKey(p) { return 'seller-' + p.dataset.sellerId; }
    function getFlagEmoji(cc) {
      if (cc === '?') return '❓';
      return cc.toUpperCase().replace(/./g, char => String.fromCodePoint(127397 + char.charCodeAt()));
    }
  }

  const style = document.createElement('style');
  style.innerHTML = `
    .seller-info-ct { margin-top: 4px; display: block; clear: both; }
    .seller-info { display: inline-flex; align-items: center; gap: 4px; padding: 2px 5px; border: 1px solid #d5d9d9; border-radius: 4px; background: #fff; font-size: 11px !important; }
    .sb-hybrid-link { color: #c45500 !important; font-weight: bold; margin-left: 4px; text-decoration: none; }
    .sb-hybrid-link:hover { text-decoration: underline; }
    .seller-loading { width: 10px; height: 10px; border: 2px solid #ff99004d; border-top-color: #ff9900; border-radius: 50%; animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .sb-btn { background: #f0f2f2; border: 1px solid #d5d9d9; border-radius: 8px; padding: 5px 10px; cursor: pointer; font-size: 12px; }
    .sb-options { display: none; position: fixed; top: 10%; left: 50%; transform: translateX(-50%); background: white; z-index: 9999; padding: 1rem; border: 1px solid #ccc; width: 400px; }
    .sb-options--backdrop { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); z-index: 199; }
  `;
  document.head.appendChild(style);
})();
