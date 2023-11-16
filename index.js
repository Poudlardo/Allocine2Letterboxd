import puppeteer from "puppeteer";
import fs from "fs";

const getAllPages = async () => {
 
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
  });

  const page = await browser.newPage();

  // COPIE LE LIEN VERS TON PROFIL ICI, ENTRE LES DEUX GUILLEMETS " "
  const UrlProfil = "https://www.allocine.fr/membre-Z20220820103049710645480/films/envie-de-voir/"

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
  let data = JSON.parse(myJsonString);
  let regex = new RegExp('envie-de-voir');

  if (regex.test(UrlProfil)) {
    let csvContent = "Title\n";

    data.forEach( film => {
      csvContent += film.Title + "\n";
    })
    
    console.log('@success', csvContent);
    fs.writeFileSync("films-a-voir.csv", csvContent, 'utf-8')
  } else {
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

getAllPages();