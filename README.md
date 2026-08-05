# Reveal Seller — Amazon Seller Revealer (v2.1)

**Auto-CSV · Google Sheets Sync · Country Highlighting · Clickable Ratings · Settings Panel**

A browser userscript for Amazon sellers and power users. It reveals third-party seller identities, origin countries, and hybrid product/seller ratings directly on Amazon search results and Bestseller pages — and collects everything into a downloadable CSV while you browse.

## 🚀 Key Features

- **Hybrid Ratings** — Displays both the Product Rating and Seller Feedback percentage (e.g., `4.1 / 87%`) under every product. Click the rating to jump straight to the product's customer reviews.
- **Seller Identity & Country** — Shows the seller's name, fulfilment type (`FBA` / `FBM` / `Amazon`), and origin country on each product card.
- **🔴🟢 Country Highlighting** — Outline products in red or green based on the seller's country. Optionally dim red-flagged products (hover to restore). Fully configurable in Settings.
- **Auto-CSV Collection** — Automatically gathers data for every product you scroll past. Data now **persists across pages** in the same session, so the counter keeps growing as you paginate.
- **Rich CSV Export** — ASIN, seller name, seller ID, country, product rating, review count, seller feedback %, feedback count, price, fulfilment type, product URL, source page, and timestamp. UTF-8 with BOM, so Excel opens international seller names correctly.
- **📊 Google Sheets Sync** — Optional webhook push. Rows are batched (20 rows or 30 seconds) with automatic retry, so you won't hit Apps Script quota limits.
- **⚙️ Settings Panel** — Configure red/green country lists, dimming, auto-collection, Sheets sync, and cache expiry. Includes a one-click cache cleaner. Settings persist across browser restarts.
- **Captcha-Safe Scraping** — Throttled, queued fetching (max 3 concurrent, randomized delays). If Amazon serves a robot check, the script pauses for 5 minutes automatically and never caches bad data.
- **Smart Caching** — Product data cached for 1 day, seller data for 7 days (both configurable). Expired entries are cleaned up automatically on every page load.
- **Bestseller Support** — Works on both search results and Bestseller grid layouts.
- **Multi-Domain Support** — 20 Amazon marketplaces: .com, .in, .co.uk, .de, .fr, .it, .es, .ca, .com.mx, .com.br, .com.au, .co.jp, .nl, .se, .pl, .ae, .sa, .sg, .com.tr, .eg.
- **Multilingual Metadata** — Localized script name and description in English, German, French, Spanish, Japanese, and Hindi.
- **Auto-Updates** — `@downloadURL` / `@updateURL` are set, so your userscript manager keeps you on the latest version.

## 🛠 Installation

1. **Install a Userscript Manager**
   - [Tampermonkey](https://www.tampermonkey.net/) (Recommended)
   - [Violentmonkey](https://violentmonkey.github.io/)
2. **Install the Script**
   - Open `reveal-seller.user.js` in this repository.
   - Click the **Raw** button.
   - Your userscript manager will prompt you to install it. Click **Install**.

## 📖 How to Use

1. **Browse Amazon** — Search for products or open any Bestseller category.
2. **View Insights** — Each product card shows a small info box: seller name, clickable hybrid rating, fulfilment type, and country.
3. **Use the Toolbar** (bottom-right corner of the page):
   - **⚙️ SoldBy** — Open the Settings panel.
   - **📥 CSV (count)** — Download everything collected so far as a `.csv` for Excel or Google Sheets.
   - **🔄 Reset** — Clear the collected list without refreshing the page.
4. **Configure** — In Settings you can set red-flag countries (default: `CN, HK`), green countries, dim red-flagged products, toggle auto-collection and Sheets sync, adjust cache expiry, or clear the cache.

## 📊 Google Sheets Setup (Optional)

1. Create a Google Sheet, then open **Extensions → Apps Script**.
2. Paste this `doPost` handler and deploy it as a **Web App** (execute as *Me*, access: *Anyone*):

```javascript
function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const rows = data.rows || [data]; // supports batched and single-row formats
  rows.forEach(r => sheet.appendRow(Object.values(r)));
  return ContentService.createTextOutput("OK");
}
```

3. Copy the Web App URL into the `GOOGLE_SHEET_WEBHOOK` constant at the top of the userscript.
4. Make sure "Push rows to Google Sheets webhook" is enabled in Settings.

## ⚙️ Metadata & Permissions

- **License**: MIT
- **Grants**: `GM.getValue`, `GM.setValue` (persistent settings only)
- **No external libraries** — the script is fully self-contained.

## ⚠️ Known Limitations

- The script reads the **buy box seller** only. Listings with multiple offers may be sold by other sellers not shown here.
- Extraction depends on Amazon's page structure, which changes periodically and varies by region. If sellers start showing as "Unknown", the selectors likely need an update — please [open an issue](https://github.com/Smart-rwl/Amazon-Reveal-Seller/issues).
- Country detection reads the seller's registered business address and may occasionally show a region or state instead of a country.
- Heavy use can trigger Amazon's robot checks. The built-in throttling and 5-minute cool-down are conservative defaults — don't raise `MAX_CONCURRENT` unless you enjoy captchas.

## 💬 Community & Support

Have a question or a sourcing tip to share? Join our [GitHub Discussions](https://github.com/Smart-rwl/Amazon-Reveal-Seller/discussions)!

## 🤝 Contributing

Feel free to fork this project, open issues, or submit pull requests to improve the extraction logic or add support for new Amazon layouts. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

**Author**: [Smartrwl](https://github.com/smart-rwl)

*Disclaimer: This tool is for educational and data research purposes. Automated scraping may conflict with Amazon's Terms of Service — use responsibly and at your own risk.*
