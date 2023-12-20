import puppeteer from "puppeteer";
import fs from "fs";

const getAllPages = async () => {
 
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
  });

  const page = await browser.newPage();

  // COPIE LE LIEN VERS TON PROFIL ICI, ENTRE LES DEUX GUILLEMETS " "
  const UrlProfil = "https://www.allocine.fr/membre-Z20220820103049710645480/films/"

  await page.goto(UrlProfil, {
    waitUntil: "domcontentloaded",
  });

  let tousLesFilms = []; 

  const dernierePage = await page.evaluate(el => el.innerText.match(/\d+/), (await page.$$('.pagination-item-holder > a:last-child'))[0])
  console.log(dernierePage)
  for (let index = 1; index <= dernierePage; index++) {
    await page.goto(UrlProfil+"?page="+index, {
    waitUntil: "domcontentloaded",
  })
      tousLesFilms = tousLesFilms.concat(await extraireTitresEtNotes(page));

  }

  let myJsonString = JSON.stringify(tousLesFilms);

  // modifier l'url & le click 
  let UrlCritique = UrlProfil.replace('films/','critiques/films/');
  console.log(UrlCritique)

  await page.goto(UrlCritique, {
    waitUntil: "domcontentloaded",
  });

  let Critiques = []; 
  // for loop -> if ("Lire Plus") { click page puis, selection du titre film + text push dans myJsonString}
  for (let index = 1; index <= dernierePage; index++) {
    
    await page.goto(UrlCritique+"?page="+index, {
    waitUntil: "domcontentloaded",
  })
    Critiques = Critiques.concat(await extraireCritiques(page))
  }

 // après ça, unifier les critiques de film avec les films déjà scrapés dans myJsonString

  let data = JSON.parse(myJsonString);
  let regex = new RegExp('envie-de-voir');

  if (regex.test(UrlProfil)) {
    // pour générer une liste de films à voir (watchlist)
    let csvContent = "Title\n";

    data.forEach( film => {
      csvContent += film.Title + "\n";
    })
    
    console.log('@success', csvContent);
    fs.writeFileSync("films-a-voir.csv", csvContent, 'utf-8')
  } else {
    // pour générer une liste de films vus
    let csvContent = "Title,Rating\n";

    data.forEach( film => {
      csvContent += film.Title + `, `;
      csvContent += film.Rating + "\n";
    })
    
    console.log('@success', csvContent);
    fs.writeFileSync("films-vus.csv", csvContent, 'utf-8')
  }


  };

async function extraireTitresEtNotes(page) {

  return page.evaluate(() => {

    let data = [];
    const filmsList = document.querySelectorAll(".thumbnail");

    Array.from(filmsList).map((film) => {
      const Title = film.querySelector(".thumbnail-img").alt;
      if(film.querySelector(".rating-mdl")) {
        const rawNote = film.querySelector(".rating-mdl").className.slice(12,14)
        const Rating = rawNote.substring(0,1)+"."+rawNote.substring(1,2)
        data.push({ Title, Rating });
      } else {
        data.push({ Title });
      }

    });
    return data;
  });
}

async function extraireCritiques(page) {

  return page.evaluate(() => { 
    let data = [];
  // Wait and click on first result
  const critiquesFilms = document.querySelectorAll(".review-card-content");

  Array.from(critiquesFilms).map((critique) => {
      const LirePlus = critique.querySelector('a');
      if (LirePlus) {
        // await page.click(LirePlus); // cliquer sur 'Lire Plus' pour afficher une nouvelle page
        const Title = document.querySelector('review-card-title > a').innerHTML;
        const Review = critique.innerText;
        data.push({Title, Review})
      } else {
        const Title = document.querySelector('review-card-title > a').innerHTML;
        const Review = critique.innerText;
        data.push({Title, Review})
      }
    })
  return data;
  })



}


getAllPages();