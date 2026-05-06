import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const TEST_URL = process.env.ALLOCINE_TEST_URL;
if (!TEST_URL) {
    console.error('❌ Variable ALLOCINE_TEST_URL non définie.');
    console.error('   Ajoutez-la en secret GitHub ou via : ALLOCINE_TEST_URL=https://... node check-selectors.js');
    process.exit(1);
}

let SELECTORS = {
    filmItem:           '.card.entity-card-simple.userprofile-entity-card-simple',
    filmTitle:          '.meta-title.meta-title-link',
    filmRating:         '.rating-mdl',
    filmReviewBlock:    '.review-card',
    filmReview:         '.content-txt.review-card-content',
    nextPage:           '.button.button-md.button-primary-full.button-right',
    popupAcceptCookies: '.jad_cmp_paywall_button'
};

try {
    const raw = JSON.parse(fs.readFileSync(path.resolve('selectors.json'), 'utf8'));
    Object.assign(SELECTORS, raw?.discovered || raw);
} catch {}

const delay = ms => new Promise(r => setTimeout(r, ms));

let passed = 0, failed = 0;

function check(label, ok, detail = '') {
    if (ok) passed++; else failed++;
    const icon = ok ? '✅' : '❌';
    console.log(`  ${icon} ${label}${detail ? `  (${detail})` : ''}`);
}

function info(label, detail) {
    console.log(`  ℹ️  ${label}${detail ? `  — ${detail}` : ''}`);
}

async function run() {
    console.log('\n🔍 AlloCiné — Selector Health Check');
    console.log(`   URL  : ${TEST_URL}`);
    console.log(`   Date : ${new Date().toUTCString()}\n`);

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    try {
        const page = await browser.newPage();

        // ── Page films ───────────────────────────────────────────────────────
        console.log('── Films ──────────────────────────────────────────────────');
        await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

        if (await page.$(SELECTORS.popupAcceptCookies)) {
            await page.click(SELECTORS.popupAcceptCookies);
            await delay(600);
        }

        const filmCount = await page.$$eval(SELECTORS.filmItem, els => els.length).catch(() => 0);
        check('Films détectés sur la page 1', filmCount > 0, `${filmCount} films`);

        if (filmCount > 0) {
            const title = await page
                .$eval(`${SELECTORS.filmItem} ${SELECTORS.filmTitle}`, el => el.textContent?.trim())
                .catch(() => '');
            check('Titre extractible', title.length > 0, title || 'vide');

            const ratingClass = await page
                .$eval(`${SELECTORS.filmItem} ${SELECTORS.filmRating}`, el => el.className)
                .catch(() => '');
            check('Classe de notation présente', /n\d{2}/.test(ratingClass), ratingClass || 'absente');
        }

        const hasNextPage = !!(await page.$(SELECTORS.nextPage).catch(() => null));
        info('Pagination', hasNextPage ? 'présente' : 'page unique (normal si peu de films)');

        // ── Page critiques ───────────────────────────────────────────────────
        console.log('\n── Critiques ─────────────────────────────────────────────');
        const reviewUrl = TEST_URL.replace(/\/films\/?$/, '/critiques/films/');
        await page.goto(reviewUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

        const reviewPageOk = page.url().includes('/critiques/');
        check('Page critiques accessible', reviewPageOk, page.url());

        const reviewCount = await page.$$eval(SELECTORS.filmReviewBlock, els => els.length).catch(() => 0);
        info('Critiques trouvées', `${reviewCount} (0 = profil sans critique, non bloquant)`);

        if (reviewCount > 0) {
            const reviewText = await page
                .$eval(`${SELECTORS.filmReviewBlock} .content-txt.review-card-content`, el => el.textContent?.trim())
                .catch(() => '');
            check('Texte de critique extractible', reviewText.length > 0);
        }

    } finally {
        await browser.close();
    }

    // ── Résumé ───────────────────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(58));
    console.log(`  Résultat : ${passed} check(s) OK  /  ${failed} échec(s)\n`);

    if (failed > 0) {
        console.log('⚠️  Certains sélecteurs sont cassés.');
        console.log('   → Lance discovery.js pour redétecter les sélecteurs.');
        process.exit(1);
    }

    console.log('✅ Tous les sélecteurs fonctionnent correctement.');
    process.exit(0);
}

run().catch(err => {
    console.error('\n❌ Erreur inattendue :', err.message);
    process.exit(1);
});
