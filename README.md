# Allocine2Letterboxd

Exporte ta liste de films vus, notés et critiqués sur AlloCiné vers un fichier CSV prêt à importer sur Letterboxd. La wishlist (films à voir) est également exportée.

<p align="center">
<img src="https://raw.githubusercontent.com/Poudlardo/Allocine2Letterboxd/main/csv%20converter.png" width="350" />
</p>

## Avant 

- Rends-toi sur ton profil AlloCiné → bouton **Partager** → copie le lien
- Colle le lien dans le terminal quand il te le demande
- Attends la fin du scraping — une barre de progression s'affiche pour chaque étape

## Joue cette commande

**Sur macOS / Linux**
```bash
curl -fsSL https://raw.githubusercontent.com/Poudlardo/Allocine2Letterboxd/main/install.sh | bash
```

**Sur Windows**
```powershell
irm https://raw.githubusercontent.com/Poudlardo/Allocine2Letterboxd/main/install.ps1 | iex
```
---

Une fois terminé, deux fichiers apparaissent dans le dossier `Allocine2Letterboxd` :

| Fichier | Contenu | Importer sur |
|---|---|---|
| `allocine-films.csv` | Films vus, notes, critiques | [Letterboxd — Films vus](https://letterboxd.com/import/) |
| `allocine-films-a-voir.csv` | Wishlist | [Letterboxd — Watchlist](https://letterboxd.com/watchlist/) |

Tu peux les importer directement sur Letterboxd !

---

## Un problème ?

[Ouvre un ticket](https://github.com/Poudlardo/Allocine2Letterboxd/issues/new/choose) en décrivant le problème avec une capture d'écran de ton terminal.
