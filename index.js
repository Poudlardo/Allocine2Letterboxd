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
    
    console.log(`🎬 Starting film scraping from profile: ${profileUrl}`);
    
    while (true) {
        if (visitedUrls.has(url)) break;
        visitedUrls.add(url);

        console.log(`📄 Scraping films page ${pageNumber}: ${url}`);
        
        try {
            await page.goto(url, { 
                waitUntil: 'domcontentloaded',
                timeout: 15000 
            });
            
            await delay(1000);
            
            try {
                console.log('🔍 Waiting for film items to load...');
                await page.waitForSelector(SELECTORS.filmItem, { timeout: 5000 });
                console.log('✅ Film items found');
            } catch (e) {
                console.log(`   ⚠️ Sélecteur principal non trouvé, recherche d'alternatives...`);
                
                try {
                    console.log('🔍 Trying alternative selector...');
                    await page.waitForSelector('.card', { timeout: 3000 });
                    console.log('✅ Alternative selectors found');
                } catch (e2) {
                    console.log(`   ⚠️ Aucun film trouvé sur cette page`);
                    break;
                }
            }
            
            if (await page.$(SELECTORS.popupAcceptCookies)) {
                console.log('🍪 Accepting cookies...');
                await page.click(SELECTORS.popupAcceptCookies);
                await delay(1000);
            }
            
            await delay(1500);
            
            consecutiveErrors = 0;
        } catch (error) {
            console.log(`   ⚠️ Erreur de navigation: ${error.message}`);
            consecutiveErrors++;
            
            if (consecutiveErrors >= 2) {
                console.log(`   ❌ Trop d'erreurs consécutives, arrêt du scraping des films`);
                break;
            }
            
            pageNumber++;
            url = `${profileUrl}?page=${pageNumber}`;
            continue;
        }

        // Récupérer les films de la page - SANS $$eval
        let pageFilms = [];
        try {
            console.log('🔍 Extracting films from page...');
            
            pageFilms = await page.evaluate((selector) => {
                const elements = document.querySelectorAll(selector);
                const filmList = [];
                
                console.log(`Found ${elements.length} elements with selector: ${selector}`);
                
                for (let el of elements) {
                    try {
                        const titleEl = el.querySelector('.meta-title.meta-title-link');
                        const title = titleEl?.title?.trim() || titleEl?.textContent?.trim() || "";
                        
                        let rating = "";
                        const ratingEl = el.querySelector('.rating-mdl');
                        if (ratingEl) {
                            const match = ratingEl.className.match(/n(\d{2})/);
                            if (match) {
                                rating = `${match[1][0]}.${match[1][1]}`;
                            }
                        }
                        
                        if (title) {
                            filmList.push({ title, rating });
                            console.log(`Extracted film: ${title} with rating: ${rating}`);
                        }
                    } catch (err) {
                        console.error('Erreur extraction film:', err);
                    }
                }
                
                return filmList;
            }, SELECTORS.filmItem);
            
            console.log(`📝 Extracted ${pageFilms.length} films from page`);
            
            if (pageFilms.length === 0) {
                console.log(`   🔄 Essai avec sélecteur alternatif...`);
                
                pageFilms = await page.evaluate(() => {
                    const elements = document.querySelectorAll('.card');
                    const filmList = [];
                    
                    console.log(`Found ${elements.length} elements with alternative selector`);
                    
                    for (let el of elements) {
                        try {
                            const titleEl = el.querySelector('.meta-title-link') || 
                                           el.querySelector('[class*="title"]');
                            const title = titleEl?.title?.trim() || 
                                        titleEl?.textContent?.trim() || "";
                            
                            let rating = "";
                            const ratingEl = el.querySelector('.rating-mdl') || 
                                            el.querySelector('[class*="rating"]');
                            if (ratingEl) {
                                const match = ratingEl.className.match(/n(\d{2})/);
                                if (match) {
                                    rating = `${match[1][0]}.${match[1][1]}`;
                                }
                            }
                            
                            if (title) {
                                filmList.push({ title, rating });
                                console.log(`Alternative extracted film: ${title} with rating: ${rating}`);
                            }
                        } catch (err) {
                            console.error('Erreur extraction film alt:', err);
                        }
                    }
                    
                    return filmList;
                });
            }
            
        } catch (error) {
            console.log(`   ❌ Erreur lors de l'extraction: ${error.message}`);
        }

        films = films.concat(pageFilms);
        console.log(`   ✓ ${pageFilms.length} films trouvés sur cette page (total: ${films.length})`);

        console.log(`   🔍 Recherche du bouton page suivante...`);
        
        let nextPage = null;
        try {
            nextPage = await page.$(SELECTORS.nextPage);
            if (!nextPage) {
                nextPage = await page.$(SELECTORS.nextPageAlt);
            }
            if (!nextPage) {
                nextPage = await page.$('a[href*="?page="]');
            }
        } catch (e) {
            console.log(`   ⚠️ Erreur lors de la recherche du bouton suivant: ${e.message}`);
            break;
        }
        
        if (!nextPage) {
            console.log(`   📄 Pas de bouton page suivante trouvé - fin de la pagination`);
            break;
        }
        
        const nextHref = await page.evaluate(el => {
            return el.getAttribute('href') || el.href;
        }, nextPage).catch(() => null);
        
        if (!nextHref) {
            console.log(`   📄 Plus de pages suivantes - fin de la pagination`);
            break;
        }
        
        let finalUrl = nextHref;
        if (!nextHref.startsWith('http')) {
            try {
                const baseUrl = new URL(page.url());
                finalUrl = new URL(nextHref, baseUrl.origin).href;
            } catch (e) {
                console.log(`   ⚠️ Erreur URL: ${e.message}`);
                break;
            }
        }
        
        if (visitedUrls.has(finalUrl)) {
            console.log(`   📄 Page déjà visitée - fin de la pagination`);
            break;
        }
        
        url = finalUrl;
        pageNumber++;
        
        // Limiter à 20 pages max pour tests (100 pour production)
        if (pageNumber > 20) {
            console.log(`   ⚠️ Limite de 20 pages atteinte`);
            break;
        }
    }
    
    console.log(`🎬 Total: ${films.length} films extraits.`);
    return films;
}

async function scrapeAllReviews(page, profileUrl) {
    console.log('🎬 Starting review scraping...');
    
    const reviews = [];
    await gotoTabCritiques(page, profileUrl);
    
    let currentUrl = page.url();
    const visitedUrls = new Set();
    let pageNum = 1;

    while (true) {
        if (visitedUrls.has(currentUrl)) {
            console.log(`⚠️  URL déjà visitée, arrêt: ${currentUrl}`);
            break;
        }
        visitedUrls.add(currentUrl);

        console.log(`📝 Scraping critiques page ${pageNum}: ${currentUrl}`);
        
        try {
            console.log('🔍 Waiting for review blocks...');
            await page.waitForSelector(SELECTORS.filmReviewBlock, { timeout: 5000 });
        } catch (e) {
            console.log(`⚠️  Aucune critique trouvée sur la page ${pageNum}`);
            break;
        }
        
        // Récupérer les critiques SANS $$eval
        let pageReviews = [];
        try {
            console.log('🔍 Extracting reviews from page...');
            
            pageReviews = await page.evaluate((selector) => {
                const blocks = document.querySelectorAll(selector);
                const reviews = [];
                
                console.log(`Found ${blocks.length} review blocks`);
                
                for (let block of blocks) {
                    let filmTitle = "";
                    let reviewText = "";
                    let hasLirePlus = false;
                    let moreUrl = "";

                    try {
                        const titleEl = block.querySelector('.review-card-title a.xXx');
                        filmTitle = titleEl ? titleEl.textContent.trim() : '';
                    } catch (e) {
                        filmTitle = '';
                    }

                    try {
                        const reviewEl = block.querySelector('.content-txt.review-card-content');
                        reviewText = reviewEl ? reviewEl.textContent.trim() : '';
                    } catch (e) {
                        reviewText = '';
                    }

                    try {
                        const lirePlusEl = block.querySelector('a.xXx.blue-link.link-more');
                        if (lirePlusEl) {
                            hasLirePlus = true;
                            moreUrl = lirePlusEl.href;
                        }
                    } catch (e) {
                        hasLirePlus = false;
                    }

                    reviews.push({
                        filmTitle,
                        reviewText,
                        hasLirePlus,
                        moreUrl
                    });
                    
                    console.log(`Extracted review for: ${filmTitle}`);
                }
                
                return reviews;
            }, SELECTORS.filmReviewBlock);
        } catch (error) {
            console.log(`   ⚠️ Erreur lors de l'extraction des critiques: ${error.message}`);
        }

        if (pageReviews.length === 0) {
            console.log(`⚠️  Aucune critique trouvée sur la page ${pageNum}`);
            break;
        }

        console.log(`   ✓ ${pageReviews.length} critiques trouvées sur cette page`);

        for (let [idx, reviewData] of pageReviews.entries()) {
            let { filmTitle, reviewText, hasLirePlus, moreUrl } = reviewData;
            
            console.log(`      🎬 ${filmTitle}`);

            if (hasLirePlus && moreUrl) {
                try {
                    const originalUrl = page.url();
                    console.log(`      🔍 Clic sur "lire plus" pour: ${filmTitle}`);
                    await page.goto(moreUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                    await page.waitForSelector(SELECTORS.filmReview, { timeout: 5000 }).catch(() => {});
                    reviewText = await page.$eval(SELECTORS.filmReview, el => el.textContent.trim()).catch(() => reviewText);
                    console.log(`      ✅ Critique extraite (${reviewText.length} chars)`);
                    await page.goto(originalUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                    await page.waitForSelector(SELECTORS.filmReviewBlock, { timeout: 5000 }).catch(() => {});
                } catch (e) {
                    console.log(`      ⚠️  Erreur sur 'lire plus', texte tronqué conservé: ${e.message}`);
                }
            }

            reviews.push({
                title: filmTitle,
                review: reviewText.replace(/\n/g, "").replace(/\s+/g, " ").trim()
            });
        }

        const nextPageButton = await page.$(SELECTORS.nextPage);
        if (!nextPageButton) {
            console.log(`📄 Pas de page suivante trouvée, fin du scraping`);
            break;
        }

        const isClickable = await page.evaluate(button => {
            return button && !button.disabled && button.offsetParent !== null;
        }, nextPageButton);

        if (!isClickable) {
            console.log(`📄 Bouton page suivante non cliquable, fin du scraping`);
            break;
        }

        try {
            console.log('🖱️ Clicking next page button...');
            await nextPageButton.click();
            await delay(2000);
            
            const newUrl = page.url();
            if (newUrl === currentUrl) {
                console.log(`📄 URL inchangée après clic, fin du scraping`);
                break;
            }
            
            currentUrl = newUrl;
            pageNum++;
            
        } catch (e) {
            console.log(`❌ Erreur lors du clic sur page suivante: ${e.message}`);
            break;
        }
    }
    
    console.log(`🎬 Total reviews scraped: ${reviews.length}`);
    return reviews;
}

async function scrapeWishlist(page, profileUrl) {
    console.log('🎬 Starting wishlist scraping...');
    
    let url = profileUrl.replace(/\/films\/?$/, "/films/envie-de-voir/");
    let wishlistFilms = [];
    const visitedUrls = new Set();
    
    while (true) {
        if (visitedUrls.has(url)) break;
        visitedUrls.add(url);

        console.log(`📋 Scraping wishlist page: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        
        if (await page.$(SELECTORS.popupAcceptCookies)) {
            console.log('🍪 Accepting cookies...');
            await page.click(SELECTORS.popupAcceptCookies);
            await delay(600);
        }
        
        // Récupérer les films SANS $$eval
        const films = await page.evaluate((selector) => {
            const elements = document.querySelectorAll(selector);
            const filmList = [];
            
            console.log(`Found ${elements.length} wishlist items`);
            
            for (let el of elements) {
                const titleEl = el.querySelector('.meta-title.meta-title-link');
                const title = titleEl?.title?.trim() || "";
                
                if (title) {
                    filmList.push({ Title: title });
                    console.log(`Wishlist film: ${title}`);
                }
            }
            
            return filmList;
        }, SELECTORS.filmItem);
        
        wishlistFilms = wishlistFilms.concat(films);
        console.log(`   ✓ ${films.length} films wishlist trouvés`);

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
    }
    
    console.log(`🎬 Wishlist total: ${wishlistFilms.length} films`);
    return wishlistFilms;
}

function mergeFilmsAndReviews(films, reviews) {
    console.log('🔄 Merging films with reviews...');
    
    const revmap = Object.fromEntries(reviews.map(r => {
        const normalized = r.title.normalize('NFD').replace(/\p{Diacritic}/gu,"").toLowerCase();
        return [normalized, r.review];
    }));
    console.log(`Reviews map size: ${Object.keys(revmap).length}`);
    console.log(`Sample review keys: ${JSON.stringify([...Object.keys(revmap)].slice(0, 5))}`);
    
    let matched = 0;
    let unmatched = 0;
    
    const merged = films.map(f => {
        let baseTitle = f.title.normalize('NFD').replace(/\p{Diacritic}/gu,"").toLowerCase();
        const review = revmap[baseTitle] ?? "";
        
        if (review) {
            matched++;
        } else {
            unmatched++;
        }
        
        return {
            Title: f.title,
            Rating: f.rating,
            Review: String(review)
        };
    });
    
    console.log(`Matched: ${matched}, Unmatched: ${unmatched}`);
    console.log(`Final merged count: ${merged.length}`);
    return merged;
}

async function exportToCsv(filename, headers, data) {
    console.log(`💾 Exporting to CSV: ${filename} with ${data.length} records`);
    
    const csvWriter = createObjectCsvWriter({
        path: filename,
        header: headers.map(h => ({ id: h, title: h })),
        alwaysQuote: true
    });
    
    await csvWriter.writeRecords(data);
    console.log(`✅ File exported: ${filename}`);
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
    console.log('🎬 Allocine2Letterboxd Scraper');
    console.log('=============================');
    displayPlatformInfo();
    console.log('=============================\n');
    
    const rawUrl = await askQuestion('Copie-colle ici ton lien de profil Allociné :\n> ');
    let url = rawUrl.trim();
    
    // Normaliser l'URL (ajouter /films/ si manquant)
    url = normalizeUrl(url);
    console.log(`🔗 URL normalisée: ${url}`);
    
    if (!isValidAllocineProfileUrl(url)) {
        console.error('❌ Lien Allociné invalide !');
        process.exit(1);
    }
    
    console.log('⏳ Scraping en cours, merci de patienter...');
    
    let browser;
    try {
        browser = await launchBrowser();
        console.log('✅ Browser launched successfully');
    } catch (error) {
        console.error('❌ Impossible de lancer un navigateur:', error.message);
        console.error('💡 Suggestion: Essayez d\'installer manuellement avec:');
        console.error('   npx puppeteer browsers install chrome');
        process.exit(1);
    }
    
    let page = await browser.newPage();
    console.log('✅ New page created');

    let films = [];
    let reviews = [];
    let wishlistFilms = [];

    try {
        console.log('\n📖 === SCRAPING DES FILMS ===');
        films = await scrapeAllFilms(page, url);
        console.log(`\n✅ Scraping des films terminé. Total films: ${films.length}`);

        // Recreate page for review scraping to avoid detached frame issues
        page = await createNewPage(browser);
        
        console.log('\n📝 === SCRAPING DES CRITIQUES ===');
        try {
            reviews = await scrapeAllReviews(page, url);
            if (reviews.length) {
                console.log(`📝 ${reviews.length} critiques extraites au total.`);
            } else {
                console.log("⚠️  Aucune critique trouvée sur ce profil.");
            }
        } catch (error) {
            console.log(`⚠️  Erreur lors du scraping des critiques: ${error.message}`);
            console.log("   Continuation avec les films uniquement...");
            reviews = [];
        }

        // Recreate page for wishlist scraping
        page = await createNewPage(browser);
        
        console.log('\n📋 === SCRAPING DE LA WISHLIST ===');
        try {
            wishlistFilms = await scrapeWishlist(page, url);
            if (wishlistFilms.length) {
                console.log(`📋 ${wishlistFilms.length} films "à voir" extraits.`);
                await exportToCsv('allocine-films-a-voir.csv', ['Title'], wishlistFilms);
                console.log('✅ Export wishlist : allocine-films-a-voir.csv');
            } else {
                console.log('⚠️  Aucun film dans la wishlist.');
            }
        } catch (error) {
            console.log(`⚠️  Erreur lors du scraping de la wishlist: ${error.message}`);
        }
    } catch (error) {
        console.log(`⚠️  Erreur lors du scraping: ${error.message}`);
    }

    console.log('\n💾 === EXPORT DES DONNÉES ===');
    
    // Debug: Check what we have to export
    console.log(`Debug info: films=${films.length}, reviews=${reviews.length}`);
    
    // Always generate films CSV with 3 columns (Title, Rating, Review)
    console.log('📄 Generating films CSV with 3 columns...');
    if (films.length > 0) {
        let entries;
        if (reviews.length > 0) {
            console.log('📝 Merging films with reviews...');
            entries = mergeFilmsAndReviews(films, reviews);
        } else {
            console.log('📝 Generating films with empty review column...');
            entries = films.map(x => ({ Title: x.title, Rating: x.rating, Review: "" }));
        }
        await exportToCsv('allocine-films.csv', ['Title', 'Rating', 'Review'], entries);
        console.log('✅ Export films (3 columns) : allocine-films.csv');
    } else {
        console.log('⚠️  No films found to export.');
    }
    
    await browser.close();
    console.log('🎉 Fini !');
}

main().catch(console.error);
