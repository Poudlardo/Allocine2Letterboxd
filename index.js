import puppeteer from "puppeteer";
import fs from "fs";
import readline from "readline";

// Create an interface for reading from the terminal
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Function to ask the question
function askQuestion() {
  return new Promise((resolve) => {
    rl.question('Copie-colle ici le lien de ton profil Allociné (ex : "https://www.allocine.fr/membre-Z20211228202924534667106/films/") : ', (answer) => {
      resolve(answer);
      rl.close();
      getAllPages(answer);
    });
  });
}

const getAllPages = async (answer) => {
 
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
  });

  const page = await browser.newPage();
  const UrlProfil = answer // "https://www.allocine.fr/membre-Z20211228202924534667106/films/"

  await page.goto(UrlProfil, {
    waitUntil: "domcontentloaded",
  });

  let tousLesFilms = []; 

  const dernierePage = await page.evaluate(el => el.innerText.match(/\d+/), (await page.$$('.pagination-item-holder > a:last-child'))[0])

  for (let index = 1; index <= dernierePage; index++) {
    await page.goto(UrlProfil+"?page="+index, {
    waitUntil: "domcontentloaded",
  })
      tousLesFilms.unshift(...await extraireTitresEtNotes(page));
      console.log(tousLesFilms)
  }

  const elementExists = await page.evaluate(() => {
    return document.querySelector('.roller-item:last-child').title == 'Critiques'
  });
  
  let data = [];
  if (!elementExists) {
    console.log('yes')
    let myJsonString = JSON.stringify(tousLesFilms);
    data = JSON.parse(myJsonString);
  } else {
    console.log('no!')
    data = JSON.parse(await getCritiques(page,UrlProfil,dernierePage, tousLesFilms));
  }
  

  let regex = new RegExp('envie-de-voir');
  if (regex.test(UrlProfil)) {
    // pour générer une liste de films à voir (watchlist)
    let csvContent = "Title\n";

    data.forEach( film => {
      csvContent += film.Title + "\n";
    })
    
    fs.writeFileSync("films-a-voir.csv", csvContent, 'utf-8')

  } else if (data[0].hasOwnProperty('Review')) {
    let csvContent = "Title,Rating,Review\n";

    data.forEach( film => {
      csvContent += `"${film.Title}"` + ",";
      csvContent += `"${film.Rating}"` + ",";
      csvContent += `"${film.Review}"` + "\n";
    })
    console.log("csvContent :",csvContent)
    fs.writeFileSync("films-vus.csv", csvContent, 'utf-8')

  } else {
    let csvContent = "Title,Rating\n";

    data.forEach( film => {
      csvContent += `"${film.Title}"` + ",";
      csvContent += `"${film.Rating}"` + "\n";
    })
    console.log("csvContent :",csvContent)
    fs.writeFileSync("films-vus.csv", csvContent, 'utf-8')
  }
  await browser.close();
  
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
        data.unshift({ Title, Rating });
      } else {
        data.unshift({ Title });
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
        const Rvw = reviewContainer.textContent;
        const Review = Rvw.replaceAll("\n", "");
        data.push({Titre, Review});
    }
    })
    return data;
  })

}

async function extraireLienLirePlus(page) {

  return page.evaluate(() => { 
      let ArrayLirePlus = [];

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

function unifierCritiquesEtFilms(arr1,arr2) {
  for (let i = 0; i < arr2.length; i++) {
    for (let j = 0; j < arr1.length; j++) {
      if (arr1[j].Title == arr2[i].Titre) {
        arr1[j].Review = arr2[i].Review;
      } else if (arr1[j].Review == undefined) {
        arr1[j].Review = "";
      }
    }
  }
  return arr1;
}

async function getCritiques(page,UrlProfil,dernierePage, tousLesFilms) {
    let UrlCritique = UrlProfil.replace('films/','critiques/films/');
    // console.log(UrlProfil, '+', UrlCritique)
    let Critiques = []; 
    let LirePlus = [];

    await page.goto(UrlCritique, {
      waitUntil: "domcontentloaded",
    });
  

    for (let index = 1; index <= dernierePage; index++) {
      
      await page.goto(UrlCritique+"?page="+index, {
      waitUntil: "domcontentloaded",
    })
      // console.log(UrlCritique+"?page="+index)
      Critiques = Critiques.concat(await extraireCritiques(page))
      LirePlus = LirePlus.concat(await extraireLienLirePlus(page))
    }
  
    for (let i = 0; i < LirePlus.length; i++) {
      await page.goto(LirePlus[i], {
        waitUntil: "domcontentloaded",
      })
      Critiques = Critiques.concat(await extraireCritiques(page))
    }

    let myJsonString = JSON.stringify(unifierCritiquesEtFilms(tousLesFilms, Critiques));
    return myJsonString;
}
  
askQuestion();