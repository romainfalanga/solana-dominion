# Mise en service

## Ce que Romain doit faire maintenant

La démonstration fonctionne sans token ni wallet. La création du dépôt GitHub a été refusée par l’intégration (403) : créer un dépôt privé vide `romainfalanga/solana-dominion`, puis autoriser l’intégration GitHub à y accéder. Aucun secret à envoyer dans la conversation.

## GitHub et Cloudflare

Le dépôt contient `cloudflare.config.ts`, le lockfile et la CI. Une fois le dépôt accessible, pousser `main` puis dans Cloudflare Workers & Pages → solana-dominion → Settings → Builds, connecter ce dépôt GitHub, branche `main`.

- Build : `npm ci && npm test && npm run build`
- Deploy : `npm run deploy` (équivalent `cf deploy --prebuilt --mode production`)
- Racine : `/`
- Node : 24

Le token d’accès de build doit être limité au Worker concerné lorsque possible ; utiliser le mécanisme de token Workers Builds. Ne pas réutiliser aveuglément un token appartenant à une autre application. Les push suivants doivent déclencher un build dont le résultat est contrôlé.

## Première session Solana devnet

1. Installer Phantom via https://phantom.app. Créer un wallet réservé aux tests ; conserver la phrase de récupération hors ligne et ne la communiquer à personne.
2. Activer le réseau de test devnet dans Phantom. Fournir uniquement l’adresse publique pour préparer les tests. Le site vérifie le réseau de son RPC avant chaque transaction.
3. Obtenir du SOL devnet au faucet officiel https://faucet.solana.com ; il n’a pas de valeur réelle. Le déploiement du programme consomme aussi du SOL devnet.
4. Sur le poste sécurisé de déploiement, installer Rust, Agave et Anchor 0.31.1. Générer une nouvelle clé de programme ; remplacer le `declare_id!` et Anchor.toml par sa clé publique, reconstruire et refaire les tests. L’identifiant de développement inclus est uniquement chargé par le validator local ; ne pas essayer de déployer avec un keypair qui ne correspond pas.
5. Déployer le binaire sur devnet. Conserver la clé d’upgrade sous contrôle du propriétaire ; ne pas utiliser une clé éphémère de conversation pour administrer le programme en production.
6. Créer un mint SPL de test, 6 décimales, sans freeze authority et créditer le wallet de test. Les commandes SPL habituelles sont `spl-token --url devnet create-token --decimals 6`, `create-account <MINT>`, `mint <MINT> <MONTANT>`. Vérifier les résultats sur Explorer/devnet. L’autorité mint du token de test peut être conservée pour obtenir des jetons sans valeur.
7. Renseigner les variables ci-dessous et redéployer. Tester création, achat, vente, refus de signature, montant insuffisant, expiration et changement de compte Phantom.

## Variables publiques

Dans `cloudflare.config.ts`, `worker.env`, utiliser `bindings.text(...)` :

| Variable | Devnet | Sens |
|---|---|---|
| PLATFORM_MODE | devnet | Réseau ; demo par défaut |
| QUOTE_MINT | mint du token de test | Adresse SPL classique ; décimales détectées |
| QUOTE_SYMBOL | DOM | Libellé de la monnaie |
| PROGRAM_ID | programme réellement déployé | Pas l’identifiant du test local |
| PUBLIC_SOLANA_RPC_URL | https://api.devnet.solana.com | Endpoint utilisé dans le navigateur |
| TRADING_ENABLED | true après vérification | Interrupteur UI |

`SOLANA_RPC_URL` peut être un **secret Worker** pour le fournisseur RPC serveur. Le RPC public Solana est adapté au développement mais peut limiter les requêtes. Définir un fournisseur et des limites avant fréquentation réelle.

Changer de mint crée un nouveau monde. Archiver l’ancienne configuration et garder son interface accessible : les fonds d’anciens marchés ne sont pas migrés. Une interface de sélection des anciens mondes est à ajouter avant plusieurs mondes de production.

## Avant mainnet

Traiter la manipulation de capitalisation spot et la faible liquidité, audit du programme et du SDK, tests devnet avec vrais wallets, politique d’upgrade et de gestion d’incident, gestion de trafic/indexeur, conditions de lancement. Le verrou supplémentaire `MAINNET_ACK=AUDITED_AND_APPROVED` n’effectue aucun audit : il exige une activation volontaire après ces travaux. Ne pas l’activer simplement pour contourner un message d’erreur.

Nom/symbole sont stockés dans le compte du programme ; aucune intégration Metaplex n’est incluse. Les wallets externes peuvent afficher seulement l’adresse du mint. Les tokens ne sont pas automatiquement cotés sur Raydium/Jupiter ; le marché de cette version est interne au programme Dominion.

Si le RPC public change, adapter aussi `connect-src` dans `public/_headers` au domaine HTTPS/WSS exact, sans autoriser tous les domaines. Reconstruire et redéployer.

`TRADING_ENABLED` est un verrou de l’interface, pas une pause du programme permissionless. Il n’empêche pas l’appel direct d’un programme déjà déployé. Ne pas déployer sur mainnet avant la validation correspondante.
