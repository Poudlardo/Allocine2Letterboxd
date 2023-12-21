import puppeteer from "puppeteer";
import fs from "fs";

const getAllPages = async () => {
 
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
  });

  const page = await browser.newPage();

  // COPIE LE LIEN VERS TON PROFIL ICI, ENTRE LES DEUX GUILLEMETS " "
  const UrlProfil = "https://www.allocine.fr/membre-Z20090805125911913557892/films/"

  await page.goto(UrlProfil, {
    waitUntil: "domcontentloaded",
  });

  let tousLesFilms = []; 

  const dernierePage = await page.evaluate(el => el.innerText.match(/\d+/), (await page.$$('.pagination-item-holder > a:last-child'))[0])

  for (let index = 1; index <= dernierePage; index++) {
    await page.goto(UrlProfil+"?page="+index, {
    waitUntil: "domcontentloaded",
  })
      tousLesFilms = tousLesFilms.concat(await extraireTitresEtNotes(page));
  }


  // modifier l'url & le click 
  let UrlCritique = UrlProfil.replace('films/','critiques/films/');

  await page.goto(UrlCritique, {
    waitUntil: "domcontentloaded",
  });

  let Critiques = []; 
  let LirePlus = [];
  // for loop -> if ("Lire Plus") { click page puis, selection du titre film + text push dans myJsonString}
  for (let index = 1; index <= dernierePage; index++) {
    
    await page.goto(UrlCritique+"?page="+index, {
    waitUntil: "domcontentloaded",
  })
    console.log(UrlCritique+"?page="+index)
    Critiques = Critiques.concat(await extraireCritiques(page))
    LirePlus = LirePlus.concat(await extraireLienLirePlus(page))
  }

  for (let i = 0; i < LirePlus.length; i++) {
    await page.goto(LirePlus[i], {
      waitUntil: "domcontentloaded",
    })
    Critiques = Critiques.concat(await extraireCritiques(page))
  }

 // après ça, unifier les critiques de film avec les films déjà scrapés dans myJsonString

  console.log('tout les films :',tousLesFilms, 'critique : ',Critiques)



  let myJsonString = JSON.stringify(tousLesFilms);
  let data = JSON.parse(myJsonString);
  let regex = new RegExp('envie-de-voir');

  if (regex.test(UrlProfil)) {
    // pour générer une liste de films à voir (watchlist)
    let csvContent = "Title\n";

    data.forEach( film => {
      csvContent += film.Title + "\n";
    })
    
    fs.writeFileSync("films-a-voir.csv", csvContent, 'utf-8')
  } else {
    // pour générer une liste de films vus
    let csvContent = "Title,Rating,Review\n";

    data.forEach( film => {
      csvContent += film.Title + `, `;
      csvContent += film.Rating + "\n";
    })
    
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
  const critiquesFilms = document.querySelectorAll(".review-card");

  Array.from(critiquesFilms).map(async (critique) => {
      const LirePlus = critique.querySelector('.review-card-review-holder > .content-txt.review-card-content > a')
  if (LirePlus == null){
        const Title = critique.querySelector('.review-card-title-bar > .review-card-title > a');
        const Titre = Title.innerText;
        const reviewContainer = critique.querySelector('.review-card-review-holder > .content-txt.review-card-content')
        const Review = reviewContainer.innerText;
        data.push({Titre, Review})
    }
    })
    return data;
  })

}

async function extraireLienLirePlus(page) {

  return page.evaluate(() => { 
      let ArrayLirePlus = [];
    // Wait and click on first result
    const critiquesFilms = document.querySelectorAll(".review-card");
  
    Array.from(critiquesFilms).map(async (critique) => {
        const LirePlus = critique.querySelector('.review-card-review-holder > .content-txt.review-card-content > a')
    if (LirePlus !== null){
          ArrayLirePlus.push(LirePlus.href)
      }
      })
      return ArrayLirePlus;
    })
  
  }
  
getAllPages();