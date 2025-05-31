import puppeteer from 'puppeteer';
import { createObjectCsvWriter } from 'csv-writer';
import readlineSync from 'readline-sync';

const SELECTORS = {
    filmItem: '.card.entity-card-simple.userprofile-entity-card-simple',
    filmTitle: '.meta-title.meta-title-link',
    filmRating: '.rating-mdl .stareval-note',
    tabReview: 'a[title="Critiques"]',
    filmReview: '.content-txt.review-card-content',
    filmReviewLirePlus: '.xXx.blue-link.link-more', // bouton lire plus sur la critique
    filmTitleOnReview: '.xXx',
    nextPage: '.xXx.button.button-md.button-primary-full.button-right',
    popupAcceptCookies: '.jad_cmp_paywall_button'
};

// ========== SCRAPING FONCTIONS ==========

async function scrapeAllFilms(page, profileUrl) {
    let films = [];
    let pageNum = 1;
    let url = profileUrl;
    while (true) {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        // Popup cookies
        if (await page.$(SELECTORS.popupAcceptCookies)) {
            await page.click(SELECTORS.popupAcceptCookies);
            await page.waitForTimeout(800);
        }
        // Films sur cette page
        const pageFilms = await page.$$eval(SELECTORS.filmItem, els =>
            els.map(el => {
                const title = el.querySelector('.meta-title.meta-title-link')?.textContent.trim() ?? "";
                // Récupération du rating via la classe "rating-mdl nXX"
                let rating = "";
                const mdl = el.querySelector('.rating-mdl');
                if (mdl) {
                    const match = mdl.className.match(/n(\d{2})/);
                    if (match) {
                        rating = `${match[1][0]}.${match[1][1]}`; // ex: 40 => 4.0, 35 => 3.5
                    }
                }
                return { title, rating };
            })
        );
        films = films.concat(pageFilms);
        // Pagination ?
        const nextPage = await page.$(SELECTORS.nextPage);
        if (nextPage) {
            url = await page.$eval(SELECTORS.nextPage, el => el.href);
            pageNum++;
        } else break;
    }
    return films;
}


async function scrapeAllReviews(page, profileUrl) {
    // Va dans l'onglet "Critiques"
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
    if (await page.$(SELECTORS.popupAcceptCookies)) {
        await page.click(SELECTORS.popupAcceptCookies);
        await page.waitForTimeout(800);
    }
    // Clique sur l'onglet Critiques si dispo
    const tabReview = await page.$(SELECTORS.tabReview);
    if (!tabReview) return [];
    await Promise.all([
        tabReview.click(),
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    ]);
    let reviews = [];
    let url = page.url();

    while (true) {
        await page.waitForSelector(SELECTORS.filmReview, { timeout: 4000 }).catch(() => {});
        // Scrape toutes les reviews de la page
        const pageReviews = await page.$$eval('.user-review-card', (cards) =>
            cards.map(card => ({
                title: card.querySelector('.user-review-card__meta__title')?.textContent.trim() ?? "",
                shortReview: card.querySelector('.user-review-card__content__text')?.textContent.trim() ?? "",
                hasLirePlus: !!card.querySelector('.user-review-card__content__link'),
                lirePlusHref: card.querySelector('.user-review-card__content__link')?.href || null
            }))
        );

        // Pour chaque review : si "Lire plus...", aller extraire toute la critique
        for (let reviewData of pageReviews) {
            let fullReview = reviewData.shortReview;
            if (reviewData.hasLirePlus && reviewData.lirePlusHref) {
                // Scrape texte complet en ouvrant nouvelle page
                const reviewPage = await page.browser().newPage();
                await reviewPage.goto(reviewData.lirePlusHref, { waitUntil: 'domcontentloaded' });
                try {
                    await reviewPage.waitForSelector('.review-card__review-content', { timeout: 5000 });
                    fullReview = await reviewPage.$eval('.review-card__review-content', el => el.textContent.trim());
                } catch {
                    // fallback en cas d'erreur
                }
                await reviewPage.close();
            }
            reviews.push({ title: reviewData.title, review: fullReview });
        }

        // Page suivante de critiques ?
        const nextPage = await page.$(SELECTORS.nextPage);
        if (nextPage) {
            url = await page.$eval(SELECTORS.nextPage, el => el.href);
            await page.goto(url, { waitUntil: 'domcontentloaded' });
        } else break;
    }
    return reviews;
}

// Fusionne films+notes avec critiques par titre (exact)
function mergeFilmsAndReviews(films, reviews) {
    return films.map(film => {
        const match = reviews.find(r => r.title === film.title);
        return {
            Title: film.title,
            Rating: film.rating,
            Review: match ? match.review : ""
        };
    });
}

async function exportToCsv(filename, headers, data) {
    const csvWriter = createObjectCsvWriter({
        path: filename,
        header: headers.map(h => ({ id: h, title: h })),
        alwaysQuote: true
    });
    await csvWriter.writeRecords(data);
}

function isValidAllocineProfileUrl(url) {
    return /^https:\/\/www\.allocine\.fr\/membre-\w+\/films\/?$/i.test(url);
}

// ========== MAIN ==========
(async () => {
    const url = readlineSync.question('\nCopie-colle ici le lien de ton profil Allociné (format : https://www.allocine.fr/membre-.../films/) :\n> ');
    if (!isValidAllocineProfileUrl(url)) {
        console.error('❌ Lien Allociné invalide !');
        process.exit(1);
    }

    console.log('⏳ Scraping en cours, merci de patienter...');

    const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
    const page = await browser.newPage();

    // 1. Films & notes
    const films = await scrapeAllFilms(page, url);
    console.log(`🎬 ${films.length} films extraits.`);

    // 2. Critiques complètes
    const reviews = await scrapeAllReviews(page, url);
    if (reviews.length) {
        console.log(`📝 ${reviews.length} critiques extraites.`);
    } else {
        console.log("⚠️  Aucune critique trouvée sur ce profil.");
    }

    // 3. Fusion et CSV
    if (reviews.length) {
        const entries = mergeFilmsAndReviews(films, reviews);
        await exportToCsv('allocine-films-critiques.csv', ['Title', 'Rating', 'Review'], entries);
        console.log('✅ Export : allocine-films-critiques.csv');
    } else {
        const entries = films.map(x => ({ Title: x.title, Rating: x.rating }));
        await exportToCsv('allocine-films.csv', ['Title', 'Rating'], entries);
        console.log('✅ Export : allocine-films.csv');
    }

    await browser.close();
    console.log('🎉 Fini !');
})();
