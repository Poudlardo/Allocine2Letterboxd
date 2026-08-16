# Allocine2Letterboxd

Exporte ta liste de films vus, notés et critiqués sur AlloCiné vers un fichier CSV prêt à importer sur Letterboxd. La wishlist (films à voir) est également exportée.

## Avant 

- Rends-toi sur [Allociné](https://mon.allocine.fr/mes-films/envie-de-voir/) → Profil → garde bien le lien en URL (similaire à https://www.allocine.fr/membre-Z20220820103049710645480/)

## Joue cette commande

**macOS / Linux**
```bash
curl -fsSL https://raw.githubusercontent.com/Poudlardo/Allocine2Letterboxd/vibe/rust-version-a5b8bf/rust-version/install.sh | bash
```

**Windows**
```powershell
irm https://raw.githubusercontent.com/Poudlardo/Allocine2Letterboxd/vibe/rust-version-a5b8bf/rust-version/install.ps1 | iex
```
---

Une fois terminé, les fichiers CSV apparaissent dans ton dossier courant :

| Fichier | Contenu | Importer sur |
|---|---|---|
| `allocine-films.csv` *(ou `allocine-films-part1.csv`, `part2.csv`, ...)* | Films vus, notes, critiques | [Letterboxd — Films vus](https://letterboxd.com/import/) |
| `allocine-films-a-voir.csv` | Wishlist | [Letterboxd — Watchlist](https://letterboxd.com/watchlist/) |

> Si tu as plus de 2500 films, le fichier est découpé en plusieurs parties (`part1`, `part2`, ...). Importe chaque partie séparément sur Letterboxd.

Tu peux les importer directement sur Letterboxd !

---

## Un problème ?

[Ouvre un ticket](https://github.com/Poudlardo/Allocine2Letterboxd/issues/new/choose) en décrivant le problème avec une capture d'écran de ton terminal.
