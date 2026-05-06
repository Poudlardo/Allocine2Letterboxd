# Allocine2Letterboxd

Exporte ta liste de films vus, notés et critiqués sur AlloCiné vers un fichier CSV prêt à importer sur Letterboxd. La wishlist (films à voir) est également exportée.

<p align="center">
<img src="https://raw.githubusercontent.com/Poudlardo/Allocine2Letterboxd/main/csv%20converter.png" width="350" />
</p>

---

## Installation en une commande

Copie-colle la commande correspondant à ton système. Le script installe automatiquement Git et Node.js si nécessaire, puis lance l'outil.

**macOS / Linux / WSL**
```bash
curl -fsSL https://raw.githubusercontent.com/Poudlardo/Allocine2Letterboxd/main/install.sh | bash
```

**Windows PowerShell**
```powershell
irm https://raw.githubusercontent.com/Poudlardo/Allocine2Letterboxd/main/install.ps1 | iex
```

> La première exécution télécharge un navigateur headless (~70 Mo). Les suivantes sont instantanées.

---

## Utilisation

1. Lance la commande d'installation ci-dessus
2. Rends-toi sur ton profil AlloCiné → bouton **Partager** → copie le lien
3. Colle le lien dans le terminal quand il te le demande
4. Attends la fin du scraping — une barre de progression s'affiche pour chaque étape

Une fois terminé, deux fichiers sont générés dans le dossier `Allocine2Letterboxd` :

| Fichier | Contenu | Importer sur |
|---|---|---|
| `allocine-films.csv` | Films vus, notes, critiques | [Letterboxd — Films vus](https://letterboxd.com/import/) |
| `allocine-films-a-voir.csv` | Wishlist | [Letterboxd — Watchlist](https://letterboxd.com/watchlist) |

---

## Un problème ?

[Ouvre un ticket](https://github.com/Poudlardo/Allocine2Letterboxd/issues/new/choose) en décrivant le problème avec une capture d'écran de ton terminal.
