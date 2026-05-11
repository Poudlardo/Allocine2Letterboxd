# Allocine2Letterboxd

Exporte ta liste de films vus, notés et critiqués sur AlloCiné vers un fichier CSV prêt à importer sur Letterboxd. La wishlist (films à voir) est également exportée.

<p align="center">
<img src="https://raw.githubusercontent.com/Poudlardo/Allocine2Letterboxd/main/csv%20converter.png" width="350" />
</p>

## Avant 

- Rends-toi sur [Allociné](https://mon.allocine.fr/mes-films/envie-de-voir/) → Profil → garde bien le lien en URL (similaire à https://www.allocine.fr/membre-Z20220820103049710645480/)

## Joue cette commande

**macOS / Linux**
```bash
curl -fsSL https://raw.githubusercontent.com/Poudlardo/Allocine2Letterboxd/main/install.sh | bash
```
> \[!NOTE]
> En cas d'erreur sur Ubuntu Server, installer ces dépendances peut résoudre le problème :
>
> ```bash
> sudo apt-get install -y libgtk-3-0 libatk1.0-0 libatk-bridge2.0-0 libnss3 libgbm1 libxss1 libdbus-glib-1-2 libasound2 2>/dev/null  | \
> sudo apt-get install -y libgtk-3-0 libatk1.0-0 libatk-bridge2.0-0 libnss3 libgbm1 libxss1 libdbus-glib-1-2 libasound2t64
> ```

**Windows**
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
