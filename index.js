import puppeteer from 'puppeteer';
import { createObjectCsvWriter } from 'csv-writer';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';

let SELECTORS = {
    filmItem: '.card.entity-card-simple.userprofile-entity-card-simple',
    filmTitle: '.meta-title.meta-title-link',
    filmRating: '.rating-mdl',
    tabReview: 'span.roller-item[title="Critiques"]',
    filmReviewBlock: '.review-card',
    filmReview: '.content-txt.review-card-content',
    filmReviewLirePlus: '.blue-link.link-more',
    filmTitleOnReview: 'a.xXx',
    filmTitleInReview: '.review-card-title a.xXx',
    nextPage: '.button.button-md.button-primary-full.button-right',
    nextPageAlt: 'button[title="Page suivante"]',
    pagination: '.pagination-item-holder',
    popupAcceptCookies: '.jad_cmp_paywall_button'
};

// Charger les sélecteurs depuis selectors.json si le fichier existe
try {
    const cfgPath = path.resolve(process.cwd(), 'selectors.json');
    if (fs.existsSync(cfgPath)) {
        const data = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        const discovered = data?.discovered || data;
        if (discovered) {
            Object.assign(SELECTORS, discovered);
            console.log('📄 Sélecteurs chargés depuis selectors.json');
        }
    }
} catch (e) {
    console.log('⚠️  Impossible de charger selectors.json, utilisation des sélecteurs par défaut');
}

// Helper function to wait for a specific duration
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function renderProgressBar(current, total, suffix = '') {
    const width = 36;
    const pct = total > 0 ? Math.min(current / total, 1) : 0;
    const filled = Math.round(pct * width);
    const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
    const pctStr = Math.round(pct * 100).toString().padStart(3);
    process.stdout.write(`\r  [${bar}] ${pctStr}% (${current}/${total})${suffix ? ' — ' + suffix : ''}   `);
}

async function getTotalPages(page) {
    try {
        return await page.evaluate(() => {
            const links = [...document.querySelectorAll('a[href]')];
            const nums = links
                .map(a => { const m = (a.getAttribute('href') || '').match(/[?&]page=(\d+)/); return m ? parseInt(m[1]) : 0; })
                .filter(n => n > 0);
            return nums.length > 0 ? Math.max(...nums) : 1;
        });
    } catch { return 1; }
}

// Get Puppeteer cache directory in an OS-agnostic way
function getPuppeteerCacheDir() {
    const platform = os.platform();
    const homeDir = os.homedir();
    
    if (platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
        return path.join(localAppData, 'puppeteer');
    } else if (platform === 'darwin') {
        return path.join(homeDir, 'Library', 'Caches', 'puppeteer');
    } else {
        return path.join(homeDir, '.cache', 'puppeteer');
    }
}

// Direct navigation to critiques page (without relying on the tab selector)
async function navigateToCritiquesDirect(page, profileUrl) {
    const reviewUrl = profileUrl.replace(/\/films\/?$/, '/critiques/films/');
    console.log(`🔗 Direct critiques URL: ${reviewUrl}`);
    await page.goto(reviewUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    if (await page.$(SELECTORS.popupAcceptCookies)) {
        await page.click(SELECTORS.popupAcceptCookies);
        await delay(600);
    }
    await page.waitForSelector(SELECTORS.filmReviewBlock, { timeout: 8000 }).catch(() => {
        console.log(`   ℹ️ Aucune critique trouvée pour ce profil`);
    });
}

// Function to check if browser is installed in Puppeteer cache
function isBrowserInstalled(browserName) {
    const cacheDir = getPuppeteerCacheDir();
    
    if (!fs.existsSync(cacheDir)) {
        return false;
    }
    
    try {
        const browserFolders = fs.readdirSync(cacheDir);
        return browserFolders.some(folder => 
            folder.toLowerCase().includes(browserName.toLowerCase())
        );
    } catch (error) {
        console.log(`⚠️  Could not read cache directory: ${error.message}`);
        return false;
    }
}

// Function to install browser
async function installBrowser(browserName) {
    console.log(`📦 Installing ${browserName} for Puppeteer...`);
    try {
        const command = `npx puppeteer browsers install ${browserName}`;
        const options = { 
            stdio: 'inherit',
            shell: true,
            env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: 'false' }
        };
        
        execSync(command, options);
        console.log(`✅ ${browserName} installed successfully!`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to install ${browserName}:`, error.message);
        return false;
    }
}

// Function to launch browser with automatic installation
async function launchBrowser() {
    const commonArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
    ];
    
    console.log('🦊 Checking Firefox availability...');
    
    if (!isBrowserInstalled('firefox')) {
        console.log('📥 Firefox not found in cache, installing...');
        const firefoxInstalled = await installBrowser('firefox');
        
        if (firefoxInstalled) {
            try {
                const browser = await puppeteer.launch({
                    browser: 'firefox',
                    headless: true,
                    args: commonArgs
                });
                console.log('✅ Firefox launched successfully');
                return browser;
            } catch (error) {
                console.log('⚠️  Firefox launch failed:', error.message);
            }
        }
    } else {
        try {
            const browser = await puppeteer.launch({
                browser: 'firefox',
                headless: true,
                args: commonArgs
            });
            console.log('✅ Firefox launched successfully');
            return browser;
        } catch (error) {
            console.log('⚠️  Firefox launch failed:', error.message);
        }
    }
    
    console.log('🔵 Switching to Chrome...');
    
    if (!isBrowserInstalled('chrome')) {
        console.log('📥 Chrome not found in cache, installing...');
        const chromeInstalled = await installBrowser('chrome');
        
        if (!chromeInstalled) {
            throw new Error('Failed to install any browser. Please check your internet connection and permissions.');
        }
    }
    
    try {
        const browser = await puppeteer.launch({
            headless: 'new',
            args: commonArgs
        });
        console.log('✅ Chrome launched successfully');
        return browser;
    } catch (error) {
        try {
            const browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox']
            });
            console.log('✅ Chrome launched successfully (minimal args)');
            return browser;
        } catch (fallbackError) {
            throw new Error(`Failed to launch Chrome: ${error.message}`);
        }
    }
}

async function gotoTabCritiques(page, url) {
    const reviewUrl = url.replace(/\/films\/?$/, '/critiques/films/');
    console.log(`📝 Navigating to reviews tab: ${reviewUrl}`);
    
    await page.goto(reviewUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 15000 
    });
    
    if (await page.$(SELECTORS.popupAcceptCookies)) {
        console.log('🍪 Accepting cookies...');
        await page.click(SELECTORS.popupAcceptCookies);
        await delay(600);
    }
    
    console.log('🔍 Waiting for review blocks to load...');
    await page.waitForSelector(SELECTORS.filmReviewBlock, { timeout: 8000 }).catch(() => {
        console.log(`   ℹ️ Aucune critique trouvée pour ce profil`);
    });
}

async function scrapeAllFilms(page, profileUrl) {
    let films = [];
    let url = profileUrl;
    const visitedUrls = new Set();
    let pageNumber = 1;
    let consecutiveErrors = 0;
    let totalPages = null;

    console.log('🎬 Scraping des films...');

    while (true) {
        if (visitedUrls.has(url)) break;
        visitedUrls.add(url);

        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await delay(1000);

            try {
                await page.waitForSelector(SELECTORS.filmItem, { timeout: 5000 });
            } catch (e) {
                try {
                    await page.waitForSelector('.card', { timeout: 3000 });
                } catch (e2) {
                    process.stdout.write('\n');
                    console.log(`   ⚠️ Aucun film trouvé sur la page ${pageNumber}`);
                    break;
                }
            }

            if (await page.$(SELECTORS.popupAcceptCookies)) {
                await page.click(SELECTORS.popupAcceptCookies);
                await delay(1000);
            }

            if (totalPages === null) {
                totalPages = await getTotalPages(page);
                process.stdout.write(`  📊 ${totalPages} page(s) de films détectée(s)\n`);
            }

            await delay(1500);
            consecutiveErrors = 0;
        } catch (error) {
            process.stdout.write('\n');
            console.log(`   ⚠️ Erreur de navigation (page ${pageNumber}): ${error.message}`);
            consecutiveErrors++;
            if (consecutiveErrors >= 2) {
                console.log(`   ❌ Trop d'erreurs consécutives, arrêt`);
                break;
            }
            pageNumber++;
            url = `${profileUrl}?page=${pageNumber}`;
            continue;
        }

        let pageFilms = [];
        try {
            pageFilms = await page.evaluate((selector) => {
                const elements = document.querySelectorAll(selector);
                const filmList = [];
                for (let el of elements) {
                    try {
                        const titleEl = el.querySelector('.meta-title.meta-title-link');
                        const title = titleEl?.title?.trim() || titleEl?.textContent?.trim() || "";
                        let rating = "";
                        const ratingEl = el.querySelector('.rating-mdl');
                        if (ratingEl) {
                            const match = ratingEl.className.match(/n(\d{2})/);
                            if (match) rating = `${match[1][0]}.${match[1][1]}`;
                        }
                        if (title) filmList.push({ title, rating });
                    } catch (err) {}
                }
                return filmList;
            }, SELECTORS.filmItem);

            if (pageFilms.length === 0) {
                pageFilms = await page.evaluate(() => {
                    const elements = document.querySelectorAll('.card');
                    const filmList = [];
                    for (let el of elements) {
                        try {
                            const titleEl = el.querySelector('.meta-title-link') || el.querySelector('[class*="title"]');
                            const title = titleEl?.title?.trim() || titleEl?.textContent?.trim() || "";
                            let rating = "";
                            const ratingEl = el.querySelector('.rating-mdl') || el.querySelector('[class*="rating"]');
                            if (ratingEl) {
                                const match = ratingEl.className.match(/n(\d{2})/);
                                if (match) rating = `${match[1][0]}.${match[1][1]}`;
                            }
                            if (title) filmList.push({ title, rating });
                        } catch (err) {}
                    }
                    return filmList;
                });
            }
        } catch (error) {
            process.stdout.write('\n');
            console.log(`   ❌ Erreur extraction page ${pageNumber}: ${error.message}`);
        }

        films = films.concat(pageFilms);
        renderProgressBar(pageNumber, totalPages ?? pageNumber, `${films.length} film(s)`);

        let nextPage = null;
        try {
            nextPage = await page.$(SELECTORS.nextPage);
            if (!nextPage) nextPage = await page.$(SELECTORS.nextPageAlt);
            if (!nextPage) nextPage = await page.$('a[href*="?page="]');
        } catch (e) {
            break;
        }

        if (!nextPage) break;

        const nextHref = await page.evaluate(el => el.getAttribute('href') || el.href, nextPage).catch(() => null);
        if (!nextHref) break;

        let finalUrl = nextHref;
        if (!nextHref.startsWith('http')) {
            try {
                const baseUrl = new URL(page.url());
                finalUrl = new URL(nextHref, baseUrl.origin).href;
            } catch (e) {
                break;
            }
        }

        if (visitedUrls.has(finalUrl)) break;

        url = finalUrl;
        pageNumber++;

        if (pageNumber > 20) {
            process.stdout.write('\n');
            console.log(`   ⚠️ Limite de 20 pages atteinte`);
            break;
        }
    }

    process.stdout.write('\n');
    console.log(`✅ ${films.length} films extraits au total`);
    return films;
}

async function scrapeAllReviews(page, profileUrl) {
    console.log('\n📝 Scraping des critiques...');

    const reviews = [];
    await gotoTabCritiques(page, profileUrl);

    let currentUrl = page.url();
    const visitedUrls = new Set();
    let pageNum = 1;
    let totalPages = null;

    while (true) {
        if (visitedUrls.has(currentUrl)) break;
        visitedUrls.add(currentUrl);

        try {
            await page.waitForSelector(SELECTORS.filmReviewBlock, { timeout: 5000 });
        } catch (e) {
            if (pageNum === 1) process.stdout.write('  ℹ️  Aucune critique trouvée sur ce profil\n');
            break;
        }

        if (totalPages === null) {
            totalPages = await getTotalPages(page);
            process.stdout.write(`  📊 ${totalPages} page(s) de critiques détectée(s)\n`);
        }

        let pageReviews = [];
        try {
            pageReviews = await page.evaluate((selector) => {
                const blocks = document.querySelectorAll(selector);
                const reviews = [];
                for (let block of blocks) {
                    let filmTitle = "", reviewText = "", hasLirePlus = false, moreUrl = "";
                    try { const el = block.querySelector('.review-card-title a.xXx'); filmTitle = el ? el.textContent.trim() : ''; } catch (e) {}
                    try { const el = block.querySelector('.content-txt.review-card-content'); reviewText = el ? el.textContent.trim() : ''; } catch (e) {}
                    try { const el = block.querySelector('a.xXx.blue-link.link-more'); if (el) { hasLirePlus = true; moreUrl = el.href; } } catch (e) {}
                    reviews.push({ filmTitle, reviewText, hasLirePlus, moreUrl });
                }
                return reviews;
            }, SELECTORS.filmReviewBlock);
        } catch (error) {
            process.stdout.write('\n');
            console.log(`   ⚠️ Erreur extraction critiques page ${pageNum}: ${error.message}`);
        }

        if (pageReviews.length === 0) break;

        for (let reviewData of pageReviews) {
            let { filmTitle, reviewText, hasLirePlus, moreUrl } = reviewData;

            if (hasLirePlus && moreUrl) {
                try {
                    const originalUrl = page.url();
                    await page.goto(moreUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                    await page.waitForSelector(SELECTORS.filmReview, { timeout: 5000 }).catch(() => {});
                    reviewText = await page.$eval(SELECTORS.filmReview, el => el.textContent.trim()).catch(() => reviewText);
                    await page.goto(originalUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                    await page.waitForSelector(SELECTORS.filmReviewBlock, { timeout: 5000 }).catch(() => {});
                } catch (e) {
                    process.stdout.write('\n');
                    console.log(`   ⚠️ "Lire plus" échoué pour "${filmTitle}": ${e.message}`);
                }
            }

            reviews.push({
                title: filmTitle,
                review: reviewText.replace(/\n/g, "").replace(/\s+/g, " ").trim()
            });
        }

        renderProgressBar(pageNum, totalPages ?? pageNum, `${reviews.length} critique(s)`);

        const nextPageButton = await page.$(SELECTORS.nextPage);
        if (!nextPageButton) break;

        const nextHref = await page.evaluate(el => el.getAttribute('href') || el.href, nextPageButton).catch(() => null);
        if (!nextHref) break;

        let nextUrl = nextHref;
        if (!nextHref.startsWith('http')) {
            try {
                const baseUrl = new URL(page.url());
                nextUrl = new URL(nextHref, baseUrl.origin).href;
            } catch (e) { break; }
        }

        if (visitedUrls.has(nextUrl)) break;
        currentUrl = nextUrl;
        pageNum++;

        try {
            await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await delay(800);
        } catch (e) {
            process.stdout.write('\n');
            console.log(`   ❌ Erreur pagination critiques: ${e.message}`);
            break;
        }
    }

    process.stdout.write('\n');
    console.log(`✅ ${reviews.length} critiques extraites au total`);
    return reviews;
}

async function scrapeWishlist(page, profileUrl) {
    console.log('\n📋 Scraping de la wishlist...');

    let url = profileUrl.replace(/\/films\/?$/, "/films/envie-de-voir/");
    let wishlistFilms = [];
    const visitedUrls = new Set();
    let pageNum = 1;
    let totalPages = null;

    while (true) {
        if (visitedUrls.has(url)) break;
        visitedUrls.add(url);

        await page.goto(url, { waitUntil: 'domcontentloaded' });

        if (await page.$(SELECTORS.popupAcceptCookies)) {
            await page.click(SELECTORS.popupAcceptCookies);
            await delay(600);
        }

        if (totalPages === null) {
            totalPages = await getTotalPages(page);
            process.stdout.write(`  📊 ${totalPages} page(s) de wishlist détectée(s)\n`);
        }

        const films = await page.evaluate((selector) => {
            const elements = document.querySelectorAll(selector);
            const filmList = [];
            for (let el of elements) {
                const titleEl = el.querySelector('.meta-title.meta-title-link');
                const title = titleEl?.title?.trim() || "";
                if (title) filmList.push({ Title: title });
            }
            return filmList;
        }, SELECTORS.filmItem);

        wishlistFilms = wishlistFilms.concat(films);
        renderProgressBar(pageNum, totalPages ?? pageNum, `${wishlistFilms.length} film(s)`);

        const nextPage = await page.$(SELECTORS.nextPage);
        if (!nextPage) break;
        const nextHref = await page.evaluate(el => el.getAttribute('href') || el.href, nextPage);

        let finalUrl = nextHref;
        if (nextHref && !nextHref.startsWith('http')) {
            const baseUrl = new URL(page.url());
            finalUrl = new URL(nextHref, baseUrl.origin).href;
        }

        if (!finalUrl || !finalUrl.startsWith('http') || visitedUrls.has(finalUrl)) break;
        url = finalUrl;
        pageNum++;
    }

    process.stdout.write('\n');
    console.log(`✅ ${wishlistFilms.length} films en wishlist`);
    return wishlistFilms;
}

function mergeFilmsAndReviews(films, reviews) {
    const revmap = Object.fromEntries(reviews.map(r => {
        const normalized = r.title.normalize('NFD').replace(/\p{Diacritic}/gu,"").toLowerCase();
        return [normalized, r.review];
    }));

    return films.map(f => {
        const baseTitle = f.title.normalize('NFD').replace(/\p{Diacritic}/gu,"").toLowerCase();
        return {
            Title: f.title,
            Rating: f.rating,
            Review: String(revmap[baseTitle] ?? "")
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
    return /^https:\/\/www\.allocine\.fr\/membre-\w+/i.test(url);
}

function normalizeUrl(url) {
    // Si l'URL ne contient pas /films/ à la fin, l'ajouter
    if (!url.endsWith('/films/') && !url.endsWith('/films')) {
        // Retirer tout ce qui suit /membre-XXXXX/ si présent
        let base = url.replace(/\/membre-\w+\/.*$/, '/membre-');
        // Extraire le membre ID
        const match = url.match(/\/membre-([A-Z0-9]+)/i);
        if (match) {
            base = `https://www.allocine.fr/membre-${match[1]}/`;
        }
        url = base + 'films/';
    }
    // S'assurer que l'URL se termine par /films/
    if (!url.endsWith('/films/')) {
        url = url.replace(/\/films$/, '/films/');
    }
    return url;
}

function displayPlatformInfo() {
    const platform = os.platform();
    const arch = os.arch();
    const nodeVersion = process.version;
    
    console.log(`📊 Platform: ${platform} (${arch})`);
    console.log(`📦 Node.js: ${nodeVersion}`);
    console.log(`📁 Cache directory: ${getPuppeteerCacheDir()}`);
}

async function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    return new Promise((resolve) => {
        rl.question(query, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

async function createNewPage(browser) {
    const newPage = await browser.newPage();
    console.log('🔄 Nouvelle page créée (frame détaché détecté)');
    return newPage;
}

async function main() {
    console.log('');
    console.log('  🎬  Allocine2Letterboxd');
    console.log('  ════════════════════════');
    displayPlatformInfo();
    console.log('');

    const rawUrl = await askQuestion('Lien de ton profil AlloCiné :\n> ');
    let url = rawUrl.trim();
    
    // Normaliser l'URL (ajouter /films/ si manquant)
    url = normalizeUrl(url);
    console.log(`🔗 URL normalisée: ${url}`);
    
    if (!isValidAllocineProfileUrl(url)) {
        console.error('❌ Lien Allociné invalide !');
        process.exit(1);
    }
    
    console.log('⏳ Lancement du navigateur...\n');

    let browser;
    try {
        browser = await launchBrowser();
    } catch (error) {
        console.error('❌ Impossible de lancer un navigateur:', error.message);
        console.error('   Essayez : npx puppeteer browsers install chrome');
        process.exit(1);
    }

    let page = await browser.newPage();
    let films = [];
    let reviews = [];
    let wishlistFilms = [];

    try {
        films = await scrapeAllFilms(page, url);

        page = await createNewPage(browser);
        try {
            reviews = await scrapeAllReviews(page, url);
        } catch (error) {
            process.stdout.write('\n');
            console.log(`⚠️  Erreur critiques: ${error.message} — continuation sans critiques`);
            reviews = [];
        }

        page = await createNewPage(browser);
        try {
            wishlistFilms = await scrapeWishlist(page, url);
            if (wishlistFilms.length) {
                await exportToCsv('allocine-films-a-voir.csv', ['Title'], wishlistFilms);
                console.log('💾 Wishlist exportée : allocine-films-a-voir.csv');
            }
        } catch (error) {
            console.log(`⚠️  Erreur wishlist: ${error.message}`);
        }
    } catch (error) {
        console.log(`⚠️  Erreur scraping: ${error.message}`);
    }

    console.log('');
    if (films.length > 0) {
        const entries = reviews.length > 0
            ? mergeFilmsAndReviews(films, reviews)
            : films.map(x => ({ Title: x.title, Rating: x.rating, Review: "" }));
        await exportToCsv('allocine-films.csv', ['Title', 'Rating', 'Review'], entries);
        console.log('💾 Films exportés : allocine-films.csv');
    } else {
        console.log('⚠️  Aucun film trouvé à exporter.');
    }

    await browser.close();
    console.log('\n🎉 Terminé !');
}

main().catch(console.error);
