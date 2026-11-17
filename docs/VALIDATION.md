# État vérifié — 17 novembre 2026

| Exigence | Résultat | Preuve / limite |
|---|---|---|
| R1 Plan et architecture | Réalisé | PLAN.md, revue des invariants et limite de manipulation économique explicite |
| R2 Carte proportionnelle pleine | Vérifié | Tests surfaces sans recouvrement, proportions, trois tailles, exclusion zéro ; parcours navigateur |
| R3 Créer des tokens / échanger | Vérifié localement | Programme SBF compilé ; neuf scénarios sur vrai validator local, dont création, achat/vente et rollback |
| R4 Phantom | Implémenté, essai wallet réel restant | SDK + connexion UI ; absence de Phantom testée ; signatures réelles devnet nécessitent wallet utilisateur et déploiement |
| R5 Mint configurable | Vérifié par tests API | QUOTE_MINT/QUOTE_SYMBOL, réseau, ownership, freeze ; ancien monde non migré |
| R6 Cloudflare | Publié en démonstration | Worker solana-dominion, API/config en demo ; aucun actif réel |
| R7 GitHub | Vérifié | Code poussé sur main ; CI GitHub web/browser/rust réussie, run 44076474495 |
| R8 Liaison GitHub→Cloudflare | Vérifié | Push sur main → build f2456eaa-48d3-4bcc-bea2-f8a09c985f70 réussi ; commande normale sans --force |
| R9 Tests et sécurité | Réalisés dans périmètre décrit | 22 tests TypeScript/API, 6 tests Rust, 9 contrôles local-validator ; aucun audit externe |
| R10 Économie mainnet | Non prête | Prix spot manipulable en faible liquidité ; gouvernance/indexation/admission à définir et vérifier |

## Commandes effectivement passées

- `npm test` : 22 tests.
- `npm run build` : types, build client et Worker réussis.
- `npm run deploy -- --dry-run` : Build Output v1 accepté, upload ~704 KiB / gzip ~160 KiB pour le Worker.
- `cargo test --workspace --locked` : 6 tests (voir programs/dominion/VALIDATION.md).
- `cargo build-sbf --arch v0 --manifest-path programs/dominion/Cargo.toml` : binaire compilé.
- `node scripts/test-localnet.mjs` : neuf scénarios contre un validateur Solana réel local ; détails et SHA du binaire dans le dossier programme.
- Playwright : desktop et mobile 390 px, création cap zéro, achat ajoutant territoire, vente, recherche sans modification des poids, reset, erreur Phantom absent, fermeture Escape, zéro erreur JS.

## Mise en ligne

https://solana-dominion.romainfalanga83.workers.dev

Le déploiement initial utilise l’API du connecteur Cloudflare et les Static Assets. La commande `npm run deploy` est préparée pour Workers Builds avec authentification Cloudflare. Le secret RPC n’est pas nécessaire en mode démonstration. Aucun token d’accès, phrase de récupération ni keypair ne fait partie du code livré.

La démonstration sauvegarde le monde dans localStorage par navigateur ; elle n’est pas multijoueur. Le mode blockchain utilise les mêmes comptes Solana pour tous les joueurs. Pas de faux cours externes, statistiques 24 h inventées ni progression après fermeture.

## Contrôle après publication

Le même script Playwright a été exécuté sur l’URL Cloudflare publique avec succès (desktop/mobile, création/achat/vente de simulation, reset, erreur Phantom, zéro erreur JS). `/api/config` renvoie `mode: demo` et `tradingEnabled: false` ; `/api/health` répond HTTP 200. Les en-têtes de sécurité ont été vérifiés.

## Dépendances

`npm audit --omit=dev` signale 9 entrées transitives (3 high, 6 moderate, 0 critical), notamment bigint-buffer via SPL et jayson/stream-json/uuid via web3.js. Aucune rétrogradation SPL 0.1.8 ni migration majeure automatique n’a été appliquée pour masquer ces résultats. Les versions sont verrouillées ; les chemins réellement embarqués font l’objet d’une revue décrite dans ../SECURITY.md. La dette de dépendances doit être traitée avant mainnet ; un audit npm ne constitue pas un audit blockchain.

## GitHub et déploiement automatique vérifiés

Le commit applicatif `8258270aa510a892a136e000d27e20be49e46c6c` est publié sur GitHub. La CI [44078102385](https://github.com/romainfalanga/solana-dominion/actions/runs/44078102385) réussit pour web, browser et rust. Le push a déclenché le build Cloudflare `f2456eaa-48d3-4bcc-bea2-f8a09c985f70`, terminé avec succès via `npm run deploy` sans forçage.

La reprise de la publication initialement faite par API a nécessité une bascule unique expressément autorisée par le propriétaire (build `3f7005df-2d6e-4092-bc14-9ec8841f7b67`). L’option forcée a été retirée immédiatement après la création de ce build. Le déclencheur actuel ne la contient pas. Les modifications documentaires seules sont exclues des déploiements Cloudflare.
