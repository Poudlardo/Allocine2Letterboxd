import puppeteer from 'puppeteer';
import { createObjectCsvWriter } from 'csv-writer';
import readlineSync from 'readline-sync';

const SELECTORS = {
    filmItem: '.card.entity-card-simple.userprofile-entity-card-simple',
    filmTitle: '.meta-title.meta-title-link',
    filmRating: '.rating-mdl',
    tabReview: 'span.roller-item[title="Critiques"]',
    filmReviewBlock: '.review-card',
    filmReview: '.content-txt.review-card-content',
    filmReviewLirePlus: '.blue-link.link-more',
    filmTitleOnReview: 'a.xXx',
    nextPage: '.button.button-md.button-primary-full.button-right',
    popupAcceptCookies: '.jad_cmp_paywall_button'
};

async function gotoTabCritiques(page, url) {
    const reviewUrl = url.replace(/\/films\/?$/, '/critiques/films/');
    await page.goto(reviewUrl, { waitUntil: 'networkidle2' });
    if (await page.$(SELECTORS.popupAcceptCookies)) {
        await page.click(SELECTORS.popupAcceptCookies);
        await page.waitForTimeout(600);
    }
    await page.waitForSelector(SELECTORS.filmReviewBlock, { timeout: 8000 });
}

async function scrapeAllFilms(page, profileUrl) {
    let films = [];
    let url = profileUrl;
    const visitedUrls = new Set();
    
    while (true) {
        if (visitedUrls.has(url)) break;
        visitedUrls.add(url);

        await page.goto(url, { waitUntil: 'domcontentloaded' });
        if (await page.$(SELECTORS.popupAcceptCookies)) {
            await page.click(SELECTORS.popupAcceptCookies);
            await page.waitForTimeout(600);
        }

        const pageFilms = await page.$$eval(SELECTORS.filmItem, els =>
            els.map(el => {
                const title = el.querySelector('.meta-title.meta-title-link')?.title?.trim() ?? "";
                let rating = "";
                const mdl = el.querySelector('.rating-mdl');
                if (mdl) {
                    const match = mdl.className.match(/n(\d{2})/);
                    if (match) rating = `${match[1][0]}.${match[1][1]}`;
                }
                return { title, rating };
            })
        );
        films = films.concat(pageFilms);

        const nextPage = await page.$(SELECTORS.nextPage);
        if (!nextPage) break;
        const nextHref = await page.evaluate(el => el.getAttribute('href'), nextPage);
        if (!nextHref || !nextHref.startsWith('http') || visitedUrls.has(nextHref)) break;
        url = nextHref;
    }
    return films;
}

async function scrapeAllReviews(page, profileUrl) {
    const reviews = [];
    await gotoTabCritiques(page, profileUrl);
    let pageNb = 1;
    const seenFirstReviews = new Set();

    while (true) {
        await page.waitForSelector(SELECTORS.filmReviewBlock, { timeout: 4000 }).catch(() => {});
        
        // Récupérer les données de tous les blocs d'un coup pour éviter les problèmes DOM
        const pageReviews = await page.$$eval(SELECTORS.filmReviewBlock, (blocks, selectors) => {
            return blocks.map(block => {
                let filmTitle = "";
                let reviewText = "";
                let hasLirePlus = false;
                let moreUrl = "";

                // Titre
                try {
                    const titleEl = block.querySelector('.review-card-title a.xXx');
                    filmTitle = titleEl ? titleEl.textContent.trim() : '';
                } catch (e) {
                    filmTitle = '';
                }

                // Texte de la critique
                try {
                    const reviewEl = block.querySelector('.content-txt.review-card-content');
                    reviewText = reviewEl ? reviewEl.textContent.trim() : '';
                } catch (e) {
                    reviewText = '';
                }

                // Vérifier s'il y a un lien "lire plus"
                try {
                    const lirePlusEl = block.querySelector('.blue-link.link-more');
                    if (lirePlusEl) {
                        hasLirePlus = true;
                        moreUrl = lirePlusEl.href;
                    }
                } catch (e) {
                    hasLirePlus = false;
                }

                return {
                    filmTitle,
                    reviewText,
                    hasLirePlus,
                    moreUrl
                };
            });
        }, SELECTORS);

        if (pageReviews.length === 0) break;

        let firstKey = pageReviews[0].reviewText;
        if (firstKey && seenFirstReviews.has(firstKey)) break;
        if (firstKey) seenFirstReviews.add(firstKey);

        console.log("Page Nb:", pageNb, "blocks found:", pageReviews.length);

        // Traiter chaque critique
        for (let [idx, reviewData] of pageReviews.entries()) {
            let { filmTitle, reviewText, hasLirePlus, moreUrl } = reviewData;
            
            console.log("Film title:", filmTitle);

            if (hasLirePlus && moreUrl) {
                try {
                    // Navigue vers la page complète
                    await page.goto(moreUrl, { waitUntil: 'domcontentloaded' });
                    await page.waitForSelector(SELECTORS.filmReview, { timeout: 2500 }).catch(() => {});
                    reviewText = await page.$eval(SELECTORS.filmReview, el => el.textContent.trim()).catch(() => reviewText);

                    // Retour à la page des critiques
                    await gotoTabCritiques(page, profileUrl);
                    // Naviguer jusqu'à la bonne page
                    for (let i = 1; i < pageNb; i++) {
                        if (await page.$(SELECTORS.nextPage)) {
                            await page.click(SELECTORS.nextPage);
                            await page.waitForSelector(SELECTORS.filmReviewBlock, { timeout: 4000 }).catch(() => {});
                        }
                    }
                } catch (e) {
                    console.log("Erreur sur 'lire plus', on garde le texte tronqué :", e.message);
                }
            }

            console.log("Review text:", reviewText.slice(0, 60));

            reviews.push({
                title: filmTitle,
                review: reviewText.replace(/\n/g, "").replace(/\s+/g, " ").trim()
            });
        }

        // Pagination
        const nextPage = await page.$(SELECTORS.nextPage);
        if (nextPage) {
            try {
                await nextPage.click();
                await page.waitForSelector(SELECTORS.filmReviewBlock, { timeout: 7000 });
                pageNb++;
            } catch (e) {
                console.log("Impossible de cliquer page suivante ou plus de pages.");
                break;
            }
        } else {
            break;
        }
    }
    return reviews;
}

async function scrapeWishlist(page, profileUrl) {
    let url = profileUrl.replace(/\/films\/?$/, "/wishlist/films/");
    let wishlistFilms = [];
    const visitedUrls = new Set();
    
    while (true) {
        if (visitedUrls.has(url)) break;
        visitedUrls.add(url);

        await page.goto(url, { waitUntil: 'domcontentloaded' });
        if (await page.$(SELECTORS.popupAcceptCookies)) {
            await page.click(SELECTORS.popupAcceptCookies);
            await page.waitForTimeout(600);
        }
        
        const films = await page.$$eval(SELECTORS.filmItem, els =>
            els.map(el => ({
                title: el.querySelector('.meta-title.meta-title-link')?.title?.trim() ?? ""
            }))
        );
        wishlistFilms = wishlistFilms.concat(films);

        const nextPage = await page.$(SELECTORS.nextPage);
        if (!nextPage) break;
        const nextHref = await page.evaluate(el => el.getAttribute('href'), nextPage);
        if (!nextHref || !nextHref.startsWith('http') || visitedUrls.has(nextHref)) break;
        url = nextHref;
    }
    return wishlistFilms;
}

function mergeFilmsAndReviews(films, reviews) {
    const revmap = Object.fromEntries(reviews.map(r => [r.title.normalize('NFD').replace(/\p{Diacritic}/gu,"").toLowerCase(), r.review]));
    return films.map(f => {
        let baseTitle = f.title.normalize('NFD').replace(/\p{Diacritic}/gu,"").toLowerCase();
        return {
            Title: f.title,
            Rating: f.rating,
            Review: revmap[baseTitle] ?? ""
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

(async () => {
    const url = readlineSync.question('\nCopie-colle ici le lien de ton profil Allociné (format : https://www.allocine.fr/membre-.../films/) :\n> ');
    if (!isValidAllocineProfileUrl(url)) {
        console.error('❌ Lien Allociné invalide !');
        process.exit(1);
    }
    
    console.log('⏳ Scraping en cours, merci de patienter...');
    const browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
    const page = await browser.newPage();

    try {
        // FILMS + critiques
        const films = await scrapeAllFilms(page, url);
        console.log(`🎬 ${films.length} films extraits.`);

        const reviews = await scrapeAllReviews(page, url);
        if (reviews.length) {
            console.log(`📝 ${reviews.length} critiques extraites.`);
        } else {
            console.log("⚠️  Aucune critique trouvée sur ce profil.");
        }
        console.log("Nb reviews:", reviews.length);

        // WISHLIST / à voir
        const wishlistFilms = await scrapeWishlist(page, url);
        if (wishlistFilms.length) {
            console.log(`📋 ${wishlistFilms.length} films "à voir" extraits.`);
            await exportToCsv('allocine-wishlist.csv', ['Title'], wishlistFilms);
        }

        // EXPORT principaux
        if (reviews.length) {
            const entries = mergeFilmsAndReviews(films, reviews);
            await exportToCsv('allocine-films-critiques.csv', ['Title', 'Rating', 'Review'], entries);
            console.log('✅ Export : allocine-films-critiques.csv');
        } else {
            const entries = films.map(x => ({ Title: x.title, Rating: x.rating }));
            await exportToCsv('allocine-films.csv', ['Title', 'Rating'], entries);
            console.log('✅ Export : allocine-films.csv');
        }
    } catch (error) {
        console.error('❌ Erreur lors du scraping:', error);
    } finally {
        await browser.close();
        console.log('🎉 Fini !');
    }
})();
