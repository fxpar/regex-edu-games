# Regex Arcade 3D

Apprendre les expressions régulières en jouant : une salle d'arcade néon en 3D (Three.js) dont chaque borne est un mini-jeu.
Une notion par niveau, un cours d'une carte, des vies à gérer.

100 % côté client : HTML, CSS et JavaScript (modules ES), sans étape de build ni serveur applicatif.
Déployable tel quel sur GitHub Pages.

## Lancer en local

Les modules ES et le `fetch` du JSON ne fonctionnent pas en `file://` : il faut un petit serveur web.

```bash
python -m http.server 8765
```

Puis ouvrir <http://localhost:8765>. Le dossier peut aussi être servi par UwAmp, ou par n'importe quel serveur statique.

Ajouter `?unlock=all` à l'adresse débloque toutes les escadrilles pour la session, sans l'enregistrer. C'est pratique en classe ou pour tester.

## Déployer sur GitHub Pages

1. Pousser le dépôt sur GitHub.
2. Dans *Settings → Pages*, choisir *Deploy from a branch*, branche `main`, dossier `/ (root)`.
3. Le jeu est servi à `https://<compte>.github.io/regex-edu-games/`.

Three.js est chargé depuis jsDelivr via un `importmap`, il n'y a rien à installer.

## Les mini-jeux

| Borne | État | Principe |
|---|---|---|
| **Mach-Regex : Jet Interceptor** | jouable | Le cockpit affiche une regex ; on tire sur les mots qui correspondent, on épargne les autres. |
| Regex Forge | en développement | Remplacements (`\1`, sauts de ligne…). |
| Cellar Scan | en développement | — |

### Mach-Regex : règles

- **28 niveaux en 6 escadrilles** (Alpha → Foxtrot), une notion par niveau : des littéraux jusqu'au regard arrière `(?<=…)`. Terminer une escadrille débloque la suivante.
- **Mode du niveau**, affiché dans le cockpit :
  - **MOT ENTIER** : le mot doit correspondre du premier au dernier caractère (comme `^(?:regex)$`) ;
  - **CONTIENT** : il suffit qu'une partie du mot corresponde (utilisé pour les ancres `^ $` et `\b`).
- **Tirer sur une cible** (mot qui correspond) : des points, plus s'il est loin.
- **Toucher un piège** (mot qui ne correspond pas) : −1 vie, et la raison s'affiche (« trop de lettres pour le point »…).
- **Laisser passer une cible** : −1 vie. Laisser passer un piège : +25 points et la raison s'affiche.
- **Difficulté progressive** : d'un niveau à l'autre, plus de drones, plus rapides, et moins de cibles parmi eux (de 60 % à 35 %). Dans un même niveau, les cibles arrivent plutôt au début et les pièges plutôt à la fin, de plus en plus vite et parfois par deux.
- **Cours** : la fiche (2 lignes, la regex, un exemple qui correspond, un piège) s'affiche au début de chaque niveau. Elle est libre pendant 30 s, puis chaque consultation coûte 1 vie (bloquée à la dernière vie).
- **Vies** : 5 par escadrille ; un niveau sans faute en rend une. À 0, l'escadrille recommence depuis son premier niveau.
- **Bilan** : à la fin de chaque niveau, la liste des erreurs avec leur explication.

### Commandes

| Action | Souris | Clavier | Écran tactile |
|---|---|---|---|
| Viser | survoler un drone | `←` `→` | — |
| Tirer | cliquer sur le drone (ou sa ligne du radar) | `Espace` ou `Entrée` | toucher le drone ou sa ligne du radar |
| Pause | bouton ❚❚ | `Échap` | bouton ❚❚ |
| Cours | bouton **COURS** | `Échap` pendant les 30 s gratuites | bouton **COURS** |

## Structure

```
index.html            écrans (hub, escadrilles, jeu), HUD, modale
css/style.css         thème néon, HUD, version mobile (< 760 px)
data/missions.json    configuration, mini-jeux, escadrilles et niveaux
js/main.js            chargement, rendu partagé, navigation entre écrans
js/missions.js        préparation des niveaux, correspondance, vagues et difficulté
js/hub.js             salle d'arcade 3D et bornes cliquables
js/jet-game.js        mini-jeu Jet Interceptor : boucle, visée, drones, missiles, vies, chrono
js/regex-engine.js    compilation des regex, surlignage, coloration syntaxique
js/ui.js              modale, toasts, fiche de cours, mémo
js/textures.js        textures dessinées sur canvas (étiquettes, réticule, écrans)
js/audio.js           effets sonores et musique synthétisés (WebAudio)
js/storage.js         progression dans localStorage
tests/validate-missions.mjs   vérification automatique des niveaux
```

## Ajouter ou modifier un niveau

Les niveaux sont dans `data/missions.json`, regroupés par escadrille :

```json
{
  "id": "1-2",
  "notion": "Le point .",
  "regex": "p..e",
  "flags": "",
  "mode": "entier",
  "cours": ["Le point . remplace exactement UN caractère.", "p..e : un p, deux caractères, puis un e."],
  "exemple": { "mot": "pâte", "explication": "p, puis â et t, puis e." },
  "cibles": ["page", "pile", "…"],
  "pieges": [{ "mot": "pages", "raison": "5 lettres : un caractère de trop" }]
}
```

- `mode` : `entier` ou `contient` ; `flags` est facultatif (par exemple `"i"`).
- Au moins 12 cibles et 12 pièges, 16 caractères au plus ; chaque piège a une `raison` courte.
- Le jeu en tire une vague au hasard à chaque partie. La difficulté se calcule d'après la place du niveau ; un objet `"difficulte"` peut la forcer (`drones`, `targetRatio`, `travel`, `spawnEvery`, `doubleChance`).

Après une modification, lancer la vérification : chaque cible doit correspondre, chaque piège être refusé.

```bash
node tests/validate-missions.mjs
```

## Moteur de regex

Le jeu utilise les regex JavaScript. Attention : sans drapeau `u`, `\w` et `\b` ne connaissent que les lettres sans accent (é n'est pas un `\w`), ce que plusieurs niveaux exploitent.

## Licence

MIT — voir [LICENSE](LICENSE).
