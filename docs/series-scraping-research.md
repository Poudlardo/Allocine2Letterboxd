# Recherche : scraping des séries sur AlloCiné

Investigation du scraping des pages de profil membre « séries » d'AlloCiné, pour étendre
`allocine2letterboxd` au-delà des films. Réalisé sur la branche `feat/series-support`.

URLs de profil utilisées comme exemples valides (membre `Z20030318104639813779116`) :

- Séries notées : `https://www.allocine.fr/membre-Z20030318104639813779116/series/`
- Critiques de séries : `https://www.allocine.fr/membre-Z20030318104639813779116/critiques/series/`

## TL;DR

- Les pages de profil **séries** sont **structurellement identiques** aux pages **films**.
  Mêmes classes CSS, même pagination, mêmes blocs `review-card`. Le code existant peut être
  réutilisé presque tel quel.
- La **seule** différence fonctionnelle par type de contenu est l'URL de la fiche référencée
  (`/series/ficheserie_gen_cserie=NNN.html` vs `/film/fichefilm_gen_cfilm=NNN.html`) et la
  classe racine (`allocine__userprofile_*_series_*` vs `..._movies_*`).
- **Point d'attention majeur (cassé aussi pour les films)** : AlloCiné a migré vers un schéma
  d'**obfuscation base64 des liens**. Le titre et le « Lire plus » ne sont plus des `<a href>`
  mais des `<span class="ACr…(base64)…">` **sans attribut `href`**. Le sélecteur actuel
  `a[href*='/film-']` et le `l.value().attr("href")` sur `.blue-link.link-more`
  ne matchent donc **plus rien** (vérifié : 0 `href` contenant `/film-` ou `/serie-`).
  → Voir §3.
- AlloCiné **ne distingue pas** mini-séries et séries par un type/genre dédié. Tout est
  `TVSeries` (`og:type = video.tv_show`). La mini-série se reconnaît uniquement à
  `numberOfSeasons == 1` (JSON-LD) et au terme éditorial « mini-série » dans les textes.
  → Voir §2.
- **Côté Letterboxd** : les miniséries sont supportées *par héritage de TMDB*, les séries
  récurrentes **non** (annoncées, pas livrées). Importer une série récurrente via CSV ne
  créera pas de fiche. → Voir §5.

---

## 1. Pages de profil : séries vs films

### 1.1 Page « séries notées » (`/membre-XXX/series/`)

Structure **identique** à `/membre-XXX/films/` (comparaison HTML brut, 36 cartes par page).

| Élément | Sélecteur CSS | Films | Séries |
|---|---|---|---|
| Carte d'entité (titre + note) | `.card.entity-card-simple.userprofile-entity-card-simple` | ✅ | ✅ |
| Titre | `.meta-title.meta-title-link` (attr `title` ou texte) | ✅ | ✅ |
| Note (étoiles) | `.rating-mdl.nXX.stareval-stars` | ✅ | ✅ |
| Conteneur section | `.section.section-wrap` | ✅ | ✅ |
| Pagination | `.pagination-item-holder` (boutons `button item`) | ✅ | ✅ |
| Classe racine (body) | `allocine allocine__userprofile_*_seen_list` | `…_movies_seen_list` | `…_series_seen_list` |

Extraction de la note : regex `n(\d{2})` sur la classe `.rating-mdl` (déjà utilisé pour les
films), converti en `X.Y` (ex. `n45` → `4.5`).

### 1.2 Page « critiques de séries » (`/membre-XXX/critiques/series/`)

Structure **identique** à `/membre-XXX/critiques/films/` (36 blocs `review-card` par page).

| Élément | Sélecteur CSS | Films | Séries |
|---|---|---|---|
| Bloc critique | `.review-card` (réel : `div.hred.review-card.cf[id="review_NNN"]`) | ✅ | ✅ |
| Titre de la critique | `.review-card-title` | ✅ | ✅ |
| Sous-titre (saison) | `.review-card-second-title` → `(A propos de la saison N)` | ❌ (films) | ✅ (séries) |
| Conteneur texte | `.content-txt.review-card-content` | ✅ | ✅ |
| Lien « Lire plus » | `.blue-link.link-more` | ✅ (span, **sans href**) | ✅ (span, **sans href**) |
| Note | `.rating-mdl.nXX.stareval-stars` + `.stareval-note` (texte `X,Y`) | ✅ | ✅ |
| Date | `.review-card-meta-date.light` → `Publiée le …` | ✅ | ✅ |
| Section | `.section.section-wrap.reviews-section` | ✅ | ✅ |
| Pagination | `.pagination.cf` / `.pagination-item-holder` | ✅ | ✅ |
| Classe racine (body) | `allocine__userprofile_review_*_list` | `…_review_movies_list` | `…_review_series_list` |

**Nouveauté côté séries** : `.review-card-second-title` contient `(A propos de la saison N)`
quand la critique porte sur une saison précise (3 occurrences sur la page d'exemple).
Spécifique aux séries — absent des critiques de films. À conserver comme métadonnée
facultative (ex. suffixe de titre `Battlestar Galactica (Saison 4)`).

### 1.3 Différences d'URL

| Type | URL fiche | URL critique complète (« Lire plus ») |
|---|---|---|
| Film | `/film/fichefilm_gen_cfilm=NNN.html` | `/membre-XXX/critiques/film-NNN/` |
| Série | `/series/ficheserie_gen_cserie=NNN.html` | `/membre-XXX/critiques/serie-NNN/` ou `/membre-XXX/critiques/serie/season-NNN/` |

Toutes ces URLs sont aujourd'hui **encodées en base64 dans la classe** du span (voir §3).

---

## 2. Mini-séries vs séries (côté AlloCiné)

**Réponse courte : AlloCiné ne différencie pas les mini-séries des séries par un type ou un
genre dédié.** La distinction est implicite.

Preuves (sources primaires) :

- **`og:type`** sur la fiche série : `video.tv_show` (uniforme, aucun sous-type mini-série).
- **JSON-LD schema.org** sur la fiche série : `@type: TVSeries`, avec `numberOfSeasons` et
  `numberOfEpisodes`. Pas de `@type: MiniSeries`.
  - Ex. Battlestar Galactica (`cserie=261`) : `numberOfSeasons: 5`, `numberOfEpisodes: 79`.
- **Genres de séries** (`https://www.allocine.fr/series-tv/`) : Action, Animation, Aventure,
  Biopic, … Feuilleton, … **aucun genre « Mini-série »**. « Mini-série » n'est pas un genre.
- Le terme **« mini-série »** n'apparaît que dans les **textes éditoriaux** (synopsis, news,
  critiques) : ex. « Sci Fi Channel lance une mini-série » (synopsis Battlestar),
  « cette mini-série Netflix est numéro 1 mondial » (news). Jamais comme champ structuré.

**Heuristique recommandée pour distinguer** (si nécessaire, ex. pour Letterboxd qui traite
séparément les miniséries) :

1. **`numberOfSeasons == 1`** dans le JSON-LD de la fiche → mini-série probable.
2. Combiner avec un faible `numberOfEpisodes` (typiquement ≤ 10) et/ou la présence du terme
   « mini-série » dans la `og:description`.
3. Attention : une série annulée après 1 saison n'est pas une mini-série ; le statut
   « terminée » (`Statut` / `en cours`) aide à lever l'ambiguïté mais reste éditorial.

Pour le scope `allocine2letterboxd`, la distinction mini-série/série **n'est probablement pas
nécessaire au scraping** : AlloCiné les liste indifféremment dans `/series/` et
`/critiques/series/`. C'est Letterboxd qui, à l'import, peut les traiter séparément via ses
propres listes (ex. [Top 250 Miniseries](https://letterboxd.com/official/list/top-250-miniseries/)).

---

## 3. Obfuscation base64 des liens (impact films ET séries)

Découvert en comparant le HTML brut actuel au code existant. **Ce point affecte déjà le
scraping des films** — pas seulement les séries.

### 3.1 Le schéma

Sur les pages de profil, les éléments cliquables (titre, « Lire plus », thumbnail) ne sont
plus des `<a href="…">` mais des `<span class="ACr…(base64)…">` **sans attribut `href`** :

```html
<!-- Titre de critique (série) -->
<span class="ACrL3NACrlcmllcy9maWNoZXNlcmllX2dlbl9jc2VyaWU9MjYxLmh0bWw= …">Battlestar Galactica</span>

<!-- « Lire plus » (série) -->
<span class="ACrL21ACrlbWJyZS1aMjAwMzAzMTgxMDQ2Mzk4MTM3NzkxMTYvY3JpdGlxdWVzL3NlcmllLTI2MS8= blue-link link-more">Lire plus</span>

<!-- « Lire plus » (film) -->
<span class="ACrL21ACrlbWJyZS1aMjAwMzAzMTgxMDQ2Mzk4MTM3NzkxMTYvY3JpdGlxdWVzL2ZpbG0tMzI2NDY1Lw== blue-link link-more">Lire plus</span>
```

### 3.2 Décodage

- Retirer les **6 premiers caractères** (`ACrL21` pour les critiques, `ACrL3N` pour les
  fiches ; le préfixe varie selon le chemin).
- Le reste est du **base64 standard**.
- Le résultat débute par 3 octets binaires « poubelle » (`\x00*…`) à ignorer, puis vient
  l'URL relative.

Exemples décodés (préfixe binaire ignoré) :

| Classe (extraite) | URL décodée |
|---|---|
| `ACrL21…/critiques/serie-261/…` | `/membre-Z20030318104639813779116/critiques/serie-261/` |
| `ACrL21…/critiques/serie/season-54355/…` | `/membre-XXX/critiques/serie/season-54355/` (saison précise) |
| `ACrL3N…ficheserie…=261.html` | `/series/ficheserie_gen_cserie=261.html` |
| `ACrL21…/critiques/film-326465/…` | `/membre-XXX/critiques/film-326465/` |

### 3.3 Impact sur le code actuel (`src/main.rs`)

Dans `Selectors::new()` :

```rust
review_lire_plus: Selector::parse(".blue-link.link-more").unwrap(),
review_title:     Selector::parse("a[href*='/film-']").unwrap(),
```

- `review_title` (`a[href*='/film-']`) : **0 match** aujourd'hui (vérifié : aucune balise `<a>`
  avec `href` contenant `/film-` ou `/serie-`). Le code tombe sur le fallback `.review-card-title`
  → le titre est quand même récupéré (via le texte du span). OK pour le titre.
- `review_lire_plus` + `.attr("href")` : retourne `None` (pas d'`href`) → `more_url = None` →
  le scraper garde le **texte tronqué** sans aller chercher la critique complète. **Le « Lire plus »
  ne fonctionne plus**, pour les films comme pour les séries.

### 3.4 Recommandations

Pour restaurer le « Lire plus » (films ET séries) et préparer les séries :

1. **Décoder la classe base64** des spans `.blue-link.link-more` :
   - extraire la sous-chaîne après `ACr`, base64-décoder, ignorer le préfixe binaire,
   - reconstruire l'URL absolue via `resolve_url(...)` (déjà présent).
2. Rendre `review_title` agnostique au type : utiliser `.review-card-title` comme sélecteur
   principal (texte), pas `a[href*='/film-']`. Le type (film/série) se déduit de l'URL source
   (`/critiques/series/` vs `/critiques/films/`), pas du lien interne.
3. Factoriser les scrapers films/séries : un seul `scrape_*` paramétré par le segment d'URL
   (`films` vs `series`) — la structure HTML est identique.

---

## 4. Plan d'implémentation suggéré

Ordre de dépendance, du plus simple au plus impliqué.

1. **Générique** : paramétrer le segment (`films`/`series`) dans `scrape_films` et
   `scrape_reviews`. L'URL de base devient `membre-{id}/{segment}/` et
   `membre-{id}/critiques/{segment}/`. Le `member_id` est déjà extrait via
   `Regex::new(r"membre-([A-Z0-9]+)")`.
2. **Titre critique** : remplacer le sélecteur `a[href*='/film-']` par `.review-card-title`
   (texte) comme source principale. Conserver `.review-card-second-title` comme suffixe
   saison optionnel pour les séries.
3. **« Lire plus »** : décoder la classe base64 (§3.4) pour récupérer l'URL de critique
   complète. Bénéfice immédiat pour les films aussi.
4. **Wishlist séries** : `membre-{id}/series/envie-de-voir/` (symétrique au films, à vérifier
   sur un profil ayant une watchlist de séries — l'exemple fourni n'en avait pas, la page
   `/series/` listait directement les séries notées).
5. **Export CSV** : produire `allocine-series.csv` (+ découpage 2500 lignes comme les films).
   Letterboxd accepte l'import via le même format `Title,Rating10,Review`.
6. **Mini-séries** : pas de traitement spécial au scraping. Optionnel, à l'export, préfixer
   ou tagger via JSON-LD `numberOfSeasons==1` si on veut distinguer pour Letterboxd.

### Vérifications à faire sur d'autres profils

- Profil avec une **watchlist de séries** (`/series/envie-de-voir/`) pour confirmer le
  sélecteur (l'exemple fourni n'en avait pas).
- Profil avec **plusieurs pages** de séries pour valider la pagination (l'exemple a 404
  séries notées / 383 critiques → ~12 pages de séries notées).
- Le préfixe d'obfuscation `ACrL21`/`ACrL3N` semble constant par type de chemin ; à confirmer
  sur d'autres profils (il pourrait varier).

---

## 5. Côté Letterboxd : miniséries oui, séries récurrentes pas encore

Question : comment Letterboxd a-t-il intégré les **mini-séries** mais pas les **séries**,
et comment se compose son catalogue TV ? Réponse courte : c'est un **héritage de TMDB**
plutôt qu'une décision produit assumée, et la bascule vers les séries récurrentes est
annoncée mais **pas encore livrée**.

### 5.1 L'état officiel actuel (source : aide Letterboxd)

D'après la page d'aide officielle *« Do you support TV shows? »*
(letterboxd.zendesk.com) :

> « No, we do not support ‘returning’ TV shows at this time, but we are working on this
> as a future platform extension. For historic reasons, we support a small selection of
> television content that was originally allowed by TMDB in its Movies section (limited or
> miniseries, TV movies) as well as some notable exceptions like *Black Mirror* episodes
> and shows that were initially marketed as limited series but subsequently given second
> seasons (like *Big Little Lies*). »

Donc :
- **Séries récurrentes** (multi-saisons) : **non supportées** aujourd'hui. En cours
  (« future platform extension »), annoncé à plusieurs reprises mais pas livré.
- **Miniséries** (et téléfilms) : supportées **pour des raisons historiques** liées à TMDB.
- Letterboxd se réserve le droit de retirer le contenu TV à tout moment ; une critique
  retirée reste disponible dans l'export de compte (Settings).

### 5.2 Pourquoi les miniséries mais pas les séries : le rôle de TMDB

Letterboxd tire son catalogue de **TMDB** (The Movie Database). Historiquement, TMDB
rangeait certaines miniséries et téléfilms dans sa section **Movies** ; Letterboxd les a donc
importés comme des films. TMDB a ensuite **déplacé ce contenu vers une section TV dédiée**.
Conséquence : sur Letterboxd, certaines entrées pointent désormais vers des fiches TV TMDB
(pour continuer à recevoir les mises à jour) tout en restant présentes comme « films ».

Résumé : **les miniséries sont là par accident hérité de l'ancien modèle TMDB**, pas par
une politique TV délibérée. Les séries récurrentes n'ont jamais été dans la section Movies de
TMDB, donc jamais importées par Letterboxd. Le support des séries récurrentes exige un
vrai développement produit (en cours).

### 5.3 Comment se compose le catalogue « miniséries » de Letterboxd

Letterboxd maintient une liste officielle **Top 250 Miniseries**
(letterboxd.com/official/list/top-250-miniseries/). Règles d'éligibilité (extraites de la
liste) :

- Seuil minimum de **1 000 notes** membres.
- Les miniséries doivent être **importées de la section TV de TMDB** pour être éligibles.
- Sont **exclues** : films de cinéma, séries renouvelées (multi-saisons), séries
  documentaires, vidéos web auto-publiées.

La distinction minisérie vs série sur Letterboxd repose donc sur le **critère « une seule
saison / non renouvelée »** — exactement la même logique que sur AlloCiné
(`numberOfSeasons == 1`). Exemples cités dans les commentaires de la liste : *Vinland Saga*,
*Frieren*, *Apothecary Diaries* sont **exclues** car multi-saisons ; *Beef* a été retirée
après l'annonce d'une saison 2.

Le catalogue se met à jour manuellement (liste curatée par un membre, « slinkyman »,
mise à jour mensuelle), pas automatiquement. Le tag « tv » / « miniseries » est appliqué
côté Letterboxd ; TMDB fournit la donnée source (type, saisons, etc.).

### 5.4 Implications pour allocine2letterboxd

- **Importer des séries récurrentes sur Letterboxd via CSV ne créera pas de fiche** : si la
  série n'existe pas déjà dans le catalogue Letterboxd (i.e. pas une minisérie héritée de TMDB),
  la ligne d'import sera ignorée ou attachée à rien. Letterboxd ne crée pas d'entrées à partir
  d'un import ; il ne fait que matcher sur son catalogue existant.
- **Les miniséries** ont de bonnes chances d'être matchées si elles figurent déjà dans le
  catalogue (ex. *Chernobyl*, *Band of Brothers*, *Twin Peaks: The Return*, *When They See
  Us* sont dans le Top 250 Miniseries). Les séries françaises moins exposées ont peu de chance
  d'y être.
- **Recommandation** : à l'export, séparer les séries potentiellement matchables
  (miniséries : 1 saison, titre reconnu internationalement) des séries récurrentes qui
  n'aboutiront pas. Eventuellement produire un CSV « miniséries » et un CSV « séries »,
  voire avertir l'utilisateur que les séries récurrentes ne s'importeront pas tant que
  Letterboxd n'aura pas livré le support TV.
- Le **timing** importe : si Letterboxd livre le support des séries récurrentes (annoncé
  « fin 2026 » selon certaines discussions, mais non officiellement daté), l'outil gagnera à
  être prêt à exporter dès l'ouverture, avec un format compatible (TMDB-driven).

### 5.5 Sources primaires (Letterboxd)

- Page d'aide officielle *« Do you support TV shows? »* :
  https://letterboxd.zendesk.com/hc/en-us/articles/15269096507407-Do-you-support-TV-shows
- Liste officielle *Top 250 Miniseries* (+ règles d'éligibilité) :
  https://letterboxd.com/official/list/top-250-miniseries/
- Annonces/discussions sur l'arrivée des séries (récurrentes) : discussions r/Letterboxd
  (tweet officiel « Series will be coming later this year » ; fil « All series and
  miniseries coming this year ») — à prendre avec réserve, rien d'officiellement daté par
  Letterboxd à ce jour.

---

## Sources primaires (AlloCiné)

- HTML brut récupéré (membre `Z20030318104639813779116`) le 2026-08-18 :
  - `/series/` (séries notées, 404 au total)
  - `/critiques/series/` (383 critiques)
  - `/films/` et `/critiques/films/` (pour comparaison)
  - `/series/ficheserie_gen_cserie=261.html` (Battlestar Galactica)
- Classes/sélecteurs extraits par analyse du HTML brut (voir commits de cette branche).
- JSON-LD `TVSeries` + `og:type = video.tv_show` confirmés sur la fiche Battlestar.
- Liste des genres de séries : `https://www.allocine.fr/series-tv/` (aucun « Mini-série »).
