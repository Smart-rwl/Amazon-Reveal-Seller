/* Parser unit tests for reveal-seller.user.js
 * Extracts the [TESTABLE-START]..[TESTABLE-END] block from the userscript
 * and runs the pure parser functions against Amazon-like HTML fixtures.
 * Run: node test.js
 */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const src = fs.readFileSync(__dirname + '/reveal-seller.user.js', 'utf8');
const start = src.indexOf('// [TESTABLE-START]');
const end = src.indexOf('// [TESTABLE-END]');
if (start < 0 || end < 0) { console.error('TESTABLE markers not found'); process.exit(1); }
const block = src.slice(start, end);

const dom = new JSDOM('');
const sandbox = new Function('URL', block + `
  return { safeParse, csvList, csvEscape, isExpired, isCaptchaPage,
           extractRating, looksLikeAmazon, parseAOD, parseProductPage, parseSellerPage };
`);
const P = sandbox(dom.window.URL);

const parse = html => new JSDOM(html).window.document;
const ORIGIN = 'https://www.amazon.in';

let pass = 0, fail = 0;
function t(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      expected ${e}\n      got      ${a}`); }
}

/* ───── extractRating ───── */
console.log('extractRating');
t('english stars', P.extractRating('4.2 out of 5 stars'), '4.2');
t('german comma decimal', P.extractRating('4,3 von 5 Sternen'), '4.3');
t('integer rating', P.extractRating('5 out of 5 stars'), '5');
t('null on empty', P.extractRating(''), null);

/* ───── looksLikeAmazon ───── */
console.log('looksLikeAmazon');
t('Amazon', P.looksLikeAmazon('Amazon'), true);
t('Amazon.in', P.looksLikeAmazon('Amazon.in'), true);
t('Amazon.co.uk', P.looksLikeAmazon('Amazon.co.uk'), true);
t('not a store containing amazon', P.looksLikeAmazon('AmazonBestDeals Store'), false);

/* ───── isCaptchaPage ───── */
console.log('isCaptchaPage');
t('captcha detected', P.isCaptchaPage('<form action="/errors/validateCaptcha">'), true);
t('robot text detected', P.isCaptchaPage('Type the characters you see in this image'), true);
t('normal page ok', P.isCaptchaPage('<div id="dp-container">product</div>'), false);

/* ───── parseAOD ───── */
console.log('parseAOD');
{
  const doc = parse(`
    <div id="aod-pinned-offer">
      <div id="aod-offer-shipsFrom"><span class="a-color-tertiary">Ships from</span><span class="a-color-base">Amazon</span></div>
      <div id="aod-offer-soldBy"><span class="a-color-tertiary">Sold by</span>
        <a href="/gp/aag/main?seller=A1B2C3D4E5F6G7&asin=B0TEST">Cool Kicks Store</a></div>
    </div>`);
  t('third-party FBA seller', P.parseAOD(doc, ORIGIN),
    { sellerId: 'A1B2C3D4E5F6G7', sellerName: 'Cool Kicks Store', sellerType: 'FBA' });
}
{
  const doc = parse(`
    <div id="aod-pinned-offer">
      <div id="aod-offer-shipsFrom"><span class="a-color-base">Cool Kicks Store</span></div>
      <div id="aod-offer-soldBy"><span class="a-color-tertiary">Sold by</span>
        <a href="/sp?seller=AXYZ123456789&ref_=aod">Cool Kicks Store</a></div>
    </div>`);
  t('third-party FBM seller', P.parseAOD(doc, ORIGIN),
    { sellerId: 'AXYZ123456789', sellerName: 'Cool Kicks Store', sellerType: 'FBM' });
}
{
  const doc = parse(`
    <div id="aod-pinned-offer">
      <div id="aod-offer-shipsFrom"><span class="a-color-base">Amazon.in</span></div>
      <div id="aod-offer-soldBy"><span class="a-color-tertiary">Sold by</span><span class="a-color-base">Amazon.in</span></div>
    </div>`);
  t('Amazon as seller (no link)', P.parseAOD(doc, ORIGIN),
    { sellerId: null, sellerName: 'Amazon', sellerType: 'Amazon' });
}
{
  const doc = parse('<div id="aod-container"><p>No offers here</p></div>');
  t('null on unrecognized fragment', P.parseAOD(doc, ORIGIN), null);
}

/* ───── parseProductPage ───── */
console.log('parseProductPage');
{
  const html = `
    <span class="a-icon-alt">4.1 out of 5 stars</span>
    <div id="merchant-info">Sold by <a id="sellerProfileTriggerId" href="/sp?seller=A9SELLER99999">Campus Activewear</a> and Fulfilled by Amazon.</div>`;
  const doc = parse(html);
  const r = P.parseProductPage(doc, html, ORIGIN);
  t('third-party seller extracted', r,
    { sellerId: 'A9SELLER99999', sellerName: 'Campus Activewear', pRating: '4.1', sellerType: 'FBA', extracted: true });
}
{
  const html = `
    <span class="a-icon-alt">4.5 out of 5 stars</span>
    <div id="merchant-info">Ships from and sold by Amazon.in.</div>`;
  const doc = parse(html);
  const r = P.parseProductPage(doc, html, ORIGIN);
  t('sold by Amazon (localized phrase)', r,
    { sellerId: null, sellerName: 'Amazon', pRating: '4.5', sellerType: 'Amazon', extracted: true });
}
{
  // The v2.0 bug regression test: page mentions "Amazon" everywhere (nav,
  // footer) but merchant info is missing → must NOT claim Amazon is seller.
  const html = `
    <nav>Amazon.in - Best deals on Amazon today</nav>
    <footer>© Amazon</footer>`;
  const doc = parse(html);
  const r = P.parseProductPage(doc, html, ORIGIN);
  t('REGRESSION: no false "Amazon" from page chrome', [r.sellerName, r.extracted], ['Unknown', false]);
}
{
  const html = `
    <span class="a-icon-alt">3,9 von 5 Sternen</span>
    <div id="merchant-info">Verkauf durch Amazon.</div>Versand durch Amazon`;
  const doc = parse(html);
  const r = P.parseProductPage(doc, html, ORIGIN);
  t('german page: rating + sold by Amazon', [r.pRating, r.sellerName, r.extracted], ['3.9', 'Amazon', true]);
}

/* ───── parseSellerPage ───── */
console.log('parseSellerPage');
{
  const doc = parse(`
    <div id="seller-info-feedback-summary"><span>92% positive in the last 12 months (1,234 ratings)</span></div>
    <div class="indent-left">Baoan District, Shenzhen</div>
    <div class="indent-left">Guangdong</div>
    <div class="indent-left">CN</div>`);
  t('address + feedback with thousands separator', P.parseSellerPage(doc),
    { country: 'CN', score: '92%', count: '1234', found: true });
}
{
  const doc = parse(`<body><p>Business Name: Foo Ltd</p><p>Country: India</p></body>`);
  t('country from labeled text fallback', P.parseSellerPage(doc).country, 'INDIA');
}
{
  const doc = parse('<div id="something-else">nothing useful</div>');
  t('found=false on unrecognized page', P.parseSellerPage(doc).found, false);
}

/* ───── csv utils ───── */
console.log('csv utils');
t('csvEscape doubles quotes', P.csvEscape('Say "hi", ok'), '"Say ""hi"", ok"');
t('csvEscape handles null', P.csvEscape(null), '""');
t('csvList normalizes', P.csvList(' cn, hk ,'), ['CN', 'HK']);

/* ───── cache expiry ───── */
console.log('cache expiry');
t('fresh entry not expired', P.isExpired({ ts: Date.now() }, 1), false);
t('2-day-old entry expired at 1 day', P.isExpired({ ts: Date.now() - 2 * 86400000 }, 1), true);
t('missing ts = expired', P.isExpired({}, 7), true);
t('null = expired', P.isExpired(null, 7), true);

/* ───── safeParse ───── */
console.log('safeParse');
t('valid json', P.safeParse('{"a":1}'), { a: 1 });
t('corrupted json returns null', P.safeParse('{oops'), null);
t('null input returns null', P.safeParse(null), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
