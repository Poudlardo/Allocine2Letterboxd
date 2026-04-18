#!/usr/bin/env node
// Script de découverte des sélecteurs CSS pour Allociné
// Usage: node discovery.js <url-du-profil-allocine>

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node discovery.js <url-du-profil-allocine>');
  process.exit(1);
}

(async () => {
  console.log(`🔍 Découverte des sélecteurs pour: ${url}`);
  
  const browser = await puppeteer.launch({ 
    headless: true, 
    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
  });
  const page = await browser.newPage();
  
  try {
    // 1. Test sur la page films
    console.log('\n📄 === Page films ===');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    const filmCandidates = {
      filmItem: [
        '.card.entity-card-simple.userprofile-entity-card-simple',
        '.card.entity-card',
        '.entity-card',
        '.card'
      ],
      filmTitle: [
        '.meta-title.meta-title-link',
        '.meta-title-link',
        'h3.meta-title',
        'h4.meta-title',
        '.title'
      ],
      filmRating: [
        '.rating-mdl',
        '[class*="rating"]',
        '.rating',
        '.score'
      ],
      nextPage: [
        '.button.button-md.button-primary-full.button-right',
        'button[title="Page suivante"]',
        'a[rel="next"]',
        '.pagination-next',
        '.next-page'
      ]
    };

    const discovered = {};
    
    for (const [key, selectors] of Object.entries(filmCandidates)) {
      let found = null;
      for (const sel of selectors) {
        try {
          const el = await page.$(sel);
          if (el) {
            found = sel;
            console.log(`  ✅ ${key}: "${sel}" trouvé`);
            break;
          }
        } catch (e) {
          // ignore
        }
      }
      if (!found) {
        console.log(`  ❌ ${key}: aucun sélecteur trouvé`);
      }
      discovered[key] = found;
    }

    // 2. Test sur la page critiques
    console.log('\n📝 === Page critiques ===');
    const critiqueUrl = url.replace(/\/films\/?$/, '/critiques/films/');
    console.log(`   URL critiques: ${critiqueUrl}`);
    
    await page.goto(critiqueUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Trouver le conteneur de critique (parent)
    const reviewBlockCandidates = [
      '.review-card',
      '[class*="review-card"]',
      '.review-item',
      'div[class*="review"]',
      'article[class*="review"]',
      '.card.entity-card-review',
      '.entity-card-review'
    ];
    
    let reviewBlockSel = null;
    console.log('\n   🔍 Recherche du conteneur de critique:');
    for (const sel of reviewBlockCandidates) {
      const els = await page.$$(sel);
      if (els.length > 0) {
        reviewBlockSel = sel;
        console.log(`   ✅ ${sel} (${els.length} éléments)`);
        break;
      }
    }
    
    if (!reviewBlockSel) {
      console.log('   ❌ Aucun conteneur de critique trouvé');
    }
    discovered.filmReviewBlock = reviewBlockSel;
    
    // Trouver le titre de la critique dans le block
    if (reviewBlockSel) {
      const firstBlock = await page.$(reviewBlockSel);
      if (firstBlock) {
        const titleCandidates = [
          '.review-card-title a.xXx',
          '.review-card-title a',
          'a.xXx',
          '.meta-title.meta-title-link',
          'h3 a',
          'h4 a',
          '.title a'
        ];
        
        let titleSel = null;
        console.log('\n   🔍 Recherche du titre dans le block:');
        for (const sel of titleCandidates) {
          const el = await firstBlock.$(sel);
          if (el) {
            titleSel = sel;
            const text = await page.evaluate(n => n.textContent.trim(), el);
            console.log(`   ✅ ${sel} => "${text}"`);
            break;
          }
        }
        
        if (!titleSel) {
          console.log('   ❌ Aucun titre trouvé dans le block');
        }
        discovered.filmTitleInReview = titleSel;
        
        // Trouver le texte de la critique
        const reviewTextCandidates = [
          '.content-txt.review-card-content',
          '.review-content',
          '[class*="review-content"]',
          '.review-text',
          '.content-txt',
          '[class*="content-txt"]'
        ];
        
        let reviewTextSel = null;
        console.log('\n   🔍 Recherche du texte de critique:');
        for (const sel of reviewTextCandidates) {
          const el = await firstBlock.$(sel);
          if (el) {
            reviewTextSel = sel;
            const text = await page.evaluate(n => n.textContent.trim(), el);
            console.log(`   ✅ ${sel} => "${text.substring(0, 50)}..."`);
            break;
          }
        }
        
        if (!reviewTextSel) {
          console.log('   ❌ Aucun texte de critique trouvé');
        }
        discovered.filmReview = reviewTextSel;
        
        // Trouver le lien "lire plus"
        const lirePlusCandidates = [
          'a.xXx.blue-link.link-more',
          'a.xXx',
          'a.link-more',
          'a.blue-link'
        ];
        
        let lirePlusSel = null;
        console.log('\n   🔍 Recherche du lien "lire plus":');
        for (const sel of lirePlusCandidates) {
          const el = await firstBlock.$(sel);
          if (el) {
            lirePlusSel = sel;
            const href = await page.evaluate(n => n.href, el);
            console.log(`   ✅ ${sel} => ${href}`);
            break;
          }
        }
        
        if (!lirePlusSel) {
          console.log('   ❌ Aucun lien "lire plus" trouvé');
        }
        discovered.lirePlus = lirePlusSel;
      }
    }
    
    discovered.nextPage = discovered.nextPage; // Already set from film page

    // 3. Try to extract a sample title for verification
    let sampleTitle = null;
    if (discovered.filmTitle) {
      try {
        const el = await page.$(discovered.filmTitle);
        if (el) {
          sampleTitle = await page.evaluate(n => n.textContent.trim(), el);
        }
      } catch (e) {
        // ignore
      }
    }

    const result = {
      discovered,
      sampleTitle
    };

    const output = JSON.stringify(result, null, 2);
    const outputPath = path.join(process.cwd(), 'selectors.json');
    fs.writeFileSync(outputPath, output);
    
    console.log('\n✅ Découverte terminée.');
    console.log('📄 Sélecteurs sauvegardés dans: selectors.json');
    if (sampleTitle) {
      console.log(`🎬 Titre exemple trouvé: "${sampleTitle}"`);
    }
    
  } catch (err) {
    console.error('\n❌ Erreur lors de la découverte:', err.message);
  } finally {
    await browser.close();
  }
})();
