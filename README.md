# Allocine2Letterboxd

Script qui permet d'importer sur Letterboxd sa liste de films vus, notés et critiqués sur Allociné, ainsi que sa liste des films à voir (watchlist). Tous les films, leur notes, et leurs éventuelles critiques écrites seront sauvegardés dans un fichier .csv à importer sur Letterboxd

<p align="center">
<img src="https://raw.githubusercontent.com/Poudlardo/Allocine2Letterboxd/main/csv%20converter.png" width="350" />
</p>


## Prérequis [Il faut installer les programmes ci-dessous avant de lancer le script]

- [Git](https://git-scm.com/downloads)
- [Node.js](https://nodejs.org/en/download/)
- Editeur de code (ex: [VS Code](https://code.visualstudio.com/Download))

## Utilisation du script 

1. Ouvrir un terminal et copier cette ligne de commande à l'endroit où vous souhaitez télécharger le dossier du script
```
git clone https://github.com/Poudlardo/Allocine2Letterboxd.git
cd /Allocine2Letterboxd  
npm install  
node index.js
```

2. Se rendre sur votre profil [Allocine](https://mon.allocine.fr/mes-films/envie-de-voir/) > Boutton 'Partager' > Copier le lien (de type : [https://www.allocine.fr/membre-Z20220820103049710645480/films/](https://www.allocine.fr/membre-Z20220820103049710645480/films/))

3. Entrez le lien sur le terminal une fois la question posée, et attendre la fin du script.

4. Après quelques secondes, le fichier `films-vus.csv` (ou `films-à-voir.csv` pour la liste de film à voir) est généré dans le dossier /Allocine2Letterboxd. Se rendre sur la [page d'import Letterboxd](https://letterboxd.com/import/) des films vus, ou la [page d'import des films à voir](https://letterboxd.com/watchlist/), pour charger le fichier sur son profil.
