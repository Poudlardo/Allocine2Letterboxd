import puppeteer from "puppeteer";
import fs from "fs";

const getAllPages = async () => {
 
   // Start a Puppeteer session with:
  // - a visible browser (`headless: false` - easier to debug because you'll see the browser in action)
  // - no default viewport (`defaultViewport: null` - website page will in full width and height)
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
  });

  // Open a new page
  const page = await browser.newPage();

  // On this new page:
  // - open the "http://quotes.toscrape.com/" website
  // - wait until the dom content is loaded (HTML is ready)
  await page.goto("https://www.allocine.fr/membre-Z20220820103049710645480/films/", {
    waitUntil: "domcontentloaded",
  });

  let tousLesFilms = []; // variable to hold collection of all book titles and prices

  const lastPage = await page.evaluate(el => el.innerText.match(/\d+/), (await page.$$('.pagination-item-holder > a:last-child'))[0])
  console.log(lastPage)
  for (let index = 1; index <= lastPage; index++) {
    await page.goto("https://www.allocine.fr/membre-Z20220820103049710645480/films/?page="+index, {
    waitUntil: "domcontentloaded",
  })
      tousLesFilms = tousLesFilms.concat(await extraireTitresEtNotes(page));

  }

  let csvContent = "Title\tYear\tRating\n";

  let myJsonString = JSON.stringify(tousLesFilms);
  let data = JSON.parse(myJsonString);
  
  data.forEach( film => {
    csvContent += film.Title + `\t`;
    csvContent += film.Year + `\t`;
    csvContent += film.Rating + "\n";
  })
  
  console.log('@success', csvContent);
  fs.writeFileSync("mesfilms.csv", csvContent)

  };

async function extraireTitresEtNotes(page) {

  return page.evaluate(() => {
    // Fetch the first element with class "quote"
    let data = [];
    const filmsList = document.querySelectorAll(".thumbnail");

    Array.from(filmsList).map((film) => {
    // Fetch the sub-elements from the previously fetched quote element
    // Get the displayed text and return it (`.innerText`)
    const Title = film.querySelector(".thumbnail-img").alt;
    const rawNote = film.querySelector(".rating-mdl").className.slice(12,14)
    const Rating = rawNote.substring(0,1)+"."+rawNote.substring(1,2)
    const Year = "";
    data.push({ Title, Rating });
    });
    return data;
  });
}

getAllPages();