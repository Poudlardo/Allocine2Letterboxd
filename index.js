import puppeteer from 'puppeteer';
import { createObjectCsvWriter } from 'csv-writer';
import readlineSync from 'readline-sync';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

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
    nextPageAlt: 'button[title="Page suivante"]',
    pagination: '.pagination-item-holder',
    popupAcceptCookies: '.jad_cmp_paywall_button'
};

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
    await page.goto(reviewUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 15000 
    });
    if (await page.$(SELECTORS.popupAcceptCookies)) {
        await page.click(SELECTORS.popupAcceptCookies);
        await delay(600);
    }
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
                await page.waitForSelector(SELECTORS.filmItem, { timeout: 5000 });
            } catch (e) {
                console.log(`   ⚠️ Sélecteur principal non trouvé, recherche d'alternatives...`);
                
                try {
                    await page.waitForSelector('.card', { timeout: 3000 });
                } catch (e2) {
                    console.log(`   ⚠️ Aucun film trouvé sur cette page`);
                    break;
                }
            }
            
            if (await page.$(SELECTORS.popupAcceptCookies)) {
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
                            if (match) {
                                rating = `${match[1][0]}.${match[1][1]}`;
                            }
                        }
                        
                        if (title) {
                            filmList.push({ title, rating });
                        }
                    } catch (err) {
                        console.error('Erreur extraction film:', err);
                    }
                }
                
                return filmList;
            }, SELECTORS.filmItem);
            
            if (pageFilms.length === 0) {
                console.log(`   🔄 Essai avec sélecteur alternatif...`);
                pageFilms = await page.evaluate(() => {
                    const elements = document.querySelectorAll('.card');
                    const filmList = [];
                    
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
        
        let nextPage = await page.$(SELECTORS.nextPage);
        if (!nextPage) {
            nextPage = await page.$(SELECTORS.nextPageAlt);
        }
        if (!nextPage) {
            nextPage = await page.$('a[href*="?page="]');
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
            const baseUrl = new URL(page.url());
            finalUrl = new URL(nextHref, baseUrl.origin).href;
        }
        
        if (visitedUrls.has(finalUrl)) {
            console.log(`   📄 Page déjà visitée - fin de la pagination`);
            break;
        }
        
        url = finalUrl;
        pageNumber++;
    }
    
    console.log(`🎬 Total: ${films.length} films extraits.`);
    return films;
}

async function scrapeAllReviews(page, profileUrl) {
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
            await page.waitForSelector(SELECTORS.filmReviewBlock, { timeout: 5000 });
        } catch (e) {
            console.log(`⚠️  Aucune critique trouvée sur la page ${pageNum}`);
            break;
        }
        
        // Récupérer les critiques SANS $$eval
        let pageReviews = [];
        try {
            pageReviews = await page.evaluate((selector) => {
                const blocks = document.querySelectorAll(selector);
                const reviews = [];
                
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
                        const lirePlusEl = block.querySelector('.blue-link.link-more');
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
                    await page.goto(moreUrl, { waitUntil: 'domcontentloaded' });
                    await page.waitForSelector(SELECTORS.filmReview, { timeout: 2500 }).catch(() => {});
                    reviewText = await page.$eval(SELECTORS.filmReview, el => el.textContent.trim()).catch(() => reviewText);
                    await page.goto(originalUrl, { waitUntil: 'domcontentloaded' });
                    await page.waitForSelector(SELECTORS.filmReviewBlock, { timeout: 3000 }).catch(() => {});
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
    
    return reviews;
}

async function scrapeWishlist(page, profileUrl) {
    let url = profileUrl.replace(/\/films\/?$/, "/films/envie-de-voir/");
    let wishlistFilms = [];
    const visitedUrls = new Set();
    
    while (true) {
        if (visitedUrls.has(url)) break;
        visitedUrls.add(url);

        console.log(`📋 Scraping wishlist page: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        if (await page.$(SELECTORS.popupAcceptCookies)) {
            await page.click(SELECTORS.popupAcceptCookies);
            await delay(600);
        }
        
        // Récupérer les films SANS $$eval
        const films = await page.evaluate((selector) => {
            const elements = document.querySelectorAll(selector);
            const filmList = [];
            
            for (let el of elements) {
                const titleEl = el.querySelector('.meta-title.meta-title-link');
                const title = titleEl?.title?.trim() || "";
                
                if (title) {
                    filmList.push({ Title: title });
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

function displayPlatformInfo() {
    const platform = os.platform();
    const arch = os.arch();
    const nodeVersion = process.version;
    
    console.log(`📊 Platform: ${platform} (${arch})`);
    console.log(`📦 Node.js: ${nodeVersion}`);
    console.log(`📁 Cache directory: ${getPuppeteerCacheDir()}`);
}

(async () => {
    console.log('🎬 Allocine2Letterboxd Scraper');
    console.log('=============================');
    displayPlatformInfo();
    console.log('=============================\n');
    
    const url = readlineSync.question('Copie-colle ici le lien de ton profil Allociné (format : https://www.allocine.fr/membre-.../films/) :\n> ');
    if (!isValidAllocineProfileUrl(url)) {
        console.error('❌ Lien Allociné invalide !');
        process.exit(1);
    }
    
    console.log('⏳ Scraping en cours, merci de patienter...');
    
    let browser;
    try {
        browser = await launchBrowser();
    } catch (error) {
        console.error('❌ Impossible de lancer un navigateur:', error.message);
        console.error('💡 Suggestion: Essayez d\'installer manuellement avec:');
        console.error('   npx puppeteer browsers install chrome');
        process.exit(1);
    }
    
    const page = await browser.newPage();

    try {
        console.log('\n📖 === SCRAPING DES FILMS ===');
        const films = await scrapeAllFilms(page, url);
        console.log(`\n✅ Scraping des films terminé.`);

        console.log('\n📝 === SCRAPING DES CRITIQUES ===');
        let reviews = [];
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
        }

        console.log('\n📋 === SCRAPING DE LA WISHLIST ===');
        let wishlistFilms = [];
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

        console.log('\n💾 === EXPORT DES DONNÉES ===');
        if (reviews.length) {
            const entries = mergeFilmsAndReviews(films, reviews);
            await exportToCsv('allocine-films-critiques.csv', ['Title', 'Rating', 'Review'], entries);
            console.log('✅ Export films+critiques : allocine-films-critiques.csv');
        } else {
            const entries = films.map(x => ({ Title: x.title, Rating: x.rating }));
            await exportToCsv('allocine-films.csv', ['Title', 'Rating'], entries);
            console.log('✅ Export films seuls : allocine-films.csv');
        }
    } catch (error) {
        console.error('❌ Erreur lors du scraping:', error);
    } finally {
        await browser.close();
        console.log('🎉 Fini !');
    }
})();