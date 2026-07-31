# Allocine2Letterboxd

Un outil pour exporter vos films et critiques depuis AlloCiné vers Letterboxd.

## Fonctionnalités

- ✅ Scraping des films notés depuis un profil AlloCiné
- ✅ Scraping des critiques associées à chaque film
- ✅ Gestion des titres avec notes (ex: "Father,3.5" -> "Father")
- ✅ Matching intelligent entre films et critiques
- ✅ Détection et suppression des doublons
- ✅ Export au format CSV compatible avec Letterboxd
- ✅ Support des wishlists (films à voir)

## Prérequis

- Node.js (version 18 ou supérieure recommandée)
- Un navigateur compatible (Chrome, Chromium, Firefox)

### Sur Linux (Ubuntu/Debian)

Si vous utilisez Puppeteer avec Chrome/Chromium, installez les dépendances nécessaires :

```bash
sudo apt-get install -y libgtk-3-0 libatk1.0-0 libatk-bridge2.0-0 libnss3 libgbm1 libxss1 libdbus-glib-1-2 libasound2
```

## Installation

1. Cloner le dépôt :
```bash
git clone https://github.com/Poudlardo/Allocine2Letterboxd.git
cd Allocine2Letterboxd
```

2. Installer les dépendances :
```bash
npm install
```

3. Installer un navigateur pour Puppeteer (si ce n'est pas déjà fait) :
```bash
npx puppeteer browsers install chrome
```

## Utilisation

### Méthode 1 : En ligne de commande

```bash
node index.js https://www.allocine.fr/membre-VOTRE_ID/
```

### Méthode 2 : Interactive

```bash
node index.js
```

Le script vous demandera alors d'entrer l'URL de votre profil AlloCiné.

### Format de l'URL

L'URL doit être au format : `https://www.allocine.fr/membre-XXXXXX/`

Exemples valides :
- `https://www.allocine.fr/membre-ABC123/`
- `https://www.allocine.fr/membre-ABC123/films/`

## Sortie

Le script génère deux fichiers CSV :

1. **allocine-films.csv** : Contient tous vos films avec leurs notes et critiques
   - Colonnes : `Title`, `Rating`, `Review`

2. **allocine-films-a-voir.csv** (si applicable) : Contient votre wishlist
   - Colonne : `Title`

## Import vers Letterboxd

1. Allez sur [Letterboxd](https://letterboxd.com/)
2. Allez dans **Settings** > **Import Data**
3. Sélectionnez le fichier `allocine-films.csv`
4. Mappez les colonnes comme suit :
   - Title → Title
   - Rating → Rating (sur 5)
   - Review → Review

## Problèmes courants

### "Impossible de lancer un navigateur"

Installez les dépendances système ou un navigateur :

```bash
# Sur Ubuntu/Debian
sudo apt-get install -y libgtk-3-0 libatk1.0-0 libatk-bridge2.0-0 libnss3 libgbm1 libxss1 libdbus-glib-1-2 libasound2

# Ou installez Chrome
npx puppeteer browsers install chrome
```

### "Aucune critique trouvée"

Certains profils AlloCiné n'ont pas de critiques publiques. Le script continuera avec les films uniquement.

### "Trop d'erreurs consécutives"

Cela peut arriver si AlloCiné bloque les requêtes. Essayez de :
- Attendre quelques minutes
- Utiliser un proxy ou VPN
- Réduire la vitesse de scraping (modifiez les `delay` dans le code)

## Personnalisation

Vous pouvez modifier les sélecteurs CSS dans `selectors.json` ou directement dans `index.js` si la structure d'AlloCiné change.

## Contribution

Les pull requests sont les bienvenues !

## Licence

ISC
