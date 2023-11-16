# Allocine2Letterboxd

Script qui permet d'importer sur Letterboxd sa liste de films vus et notés sur Allociné, ainsi que sa liste des films à voir (watchlist).

## Prérequis

- [Node.js](https://nodejs.org/en/download/)
- Editeur de code (ex: [VS Code](https://code.visualstudio.com/Download))

## Utilisation du script 

1. Ouvrir un terminal et copier cette ligne de commande à l'endroit où vous souhaitez télécharger le dossier du script `git clone https://github.com/Poudlardo/Allocine2Letterboxd.git`

2. Se rendre sur votre profil [Allocine](https://mon.allocine.fr/mes-films/envie-de-voir/) > Boutton 'Partager' > Copier le lien (de type : [https://www.allocine.fr/membre-Z20220820103049710645480/films/](https://www.allocine.fr/membre-Z20220820103049710645480/films/))

3. Dans le dossier /Allocine2Letterboxd, ouvrir le fichier `index.js` dans votre éditeur de code, et coller le lien de votre profil Allocine à la ligne 14 à la place de ` "TON_PROFIL" `(lien à placer entre les guillemets). Sauvegarder (CTRL + S).

4. Ouvrir le terminal à l'intérieur du dossier /Allocine2Letterboxd, et coller cette ligne de commande `nodemon index.js` et attendre la fin du défilement de données sur le terminal.

5. Après quelques secondes, le fichier `films-vus.csv` est généré dans le dossier /Allocine2Letterboxd. Se rendre sur la [page d'import Letterboxd](https://letterboxd.com/import/) pour charger le fichier sur son profil.
