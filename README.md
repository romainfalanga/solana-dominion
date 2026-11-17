# Dominion

Launchpad et carte de compétition sur Solana : https://solana-dominion.romainfalanga83.workers.dev

## Token de plateforme

Modifier uniquement `paymentMint` dans [`config/platform.json`](config/platform.json), puis enregistrer sur `main`. GitHub teste et Cloudflare déploie. Le mint, le symbole, les décimales et le programme SPL sont vérifiés sur Solana. Le token de plateforme rejoint automatiquement la compétition, avec sa capitalisation réelle.

Les anciens marchés conservent leur quote et leur politique d’origine : changer le token de plateforme ne convertit pas les réserves existantes et ne bloque pas leurs ventes.

## Lancement et échanges

Le programme existant **Meteora Dynamic Bonding Curve** crée le token et son marché contre le token de plateforme. Le créateur choisit un achat initial ; il reçoit la quantité achetée, jamais toute la supply par défaut. La supply initiale est de 1 milliard, avec 6 décimales, sans autorité de mint supplémentaire ni de gel.

Paramètres de départ : capitalisation initiale de 10 000 unités de quote, seuil de capitalisation de migration de 1 000 000 unités de quote, frais de swap constants de 1 %. Ces paramètres sont dans `launch` ; ils définissent une courbe, pas une garantie de prix ou une parité. Aucun forfait de création en quote n’est ajouté. Les frais de protocole sont inclus dans le devis. Les comptes, les frais Metaplex et les transactions nécessitent du SOL du signataire.

La première utilisation d’une quote/politique crée une configuration partagée puis un pool avec achat initial : deux signatures Phantom. Les lancements suivants réutilisent la configuration : une signature. Le solde quote et un budget SOL conservateur sont vérifiés avant la première signature. Les reçus de confirmation incertaine sont conservés avant diffusion ; une reprise ne doit pas repayer la configuration.

Achats et ventes intégrés avant migration, minimum reçu fixé depuis le devis affiché. À l’approche du seuil, un achat peut être partiel : le montant saisi est un maximum. À la fin de la courbe, une migration permissionless vers DAMMv2 est proposée, avec liquidité verrouillée ; les échanges du marché migré sont ensuite accessibles sur le marché externe.

## Carte

La surface représente `market cap du token / somme des market caps`. Pour une courbe active : prix du token en quote × cours USD de la quote × offre actuelle. Le token de plateforme et les marchés migrés utilisent un cours externe avec liquidité. Absence de valorisation vérifiable : zéro surface, présence maintenue dans la liste. Une recherche ne change pas le dénominateur.

## Identité

Logo : [`public/brand/dominion-token.png`](public/brand/dominion-token.png), intégré au site et au favicon. Métadonnées prêtes pour le futur token : [`public/brand/token-metadata.json`](public/brand/token-metadata.json). Ces fichiers ne modifient pas les métadonnées immuables du token CHOULE existant.

## Développement et preuves

```sh
npm ci
npm test
npm run build
npm run preview
npm run test:ui
LOCAL_RPC_URL=http://127.0.0.1:19699 npm run test:dbc
```

Le test DBC exige un validateur local chargé avec les programmes DBC et Metaplex ; `--migration` nécessite également DAMMv2 et sa configuration publique. Les clés locales sont éphémères. La simulation mainnet `scripts/simulate-dbc-mainnet.mjs` n’utilise aucun secret et interdit la diffusion de transactions.

Le vieux lancement SPL à frais fixes est conservé seulement pour le registre historique et ses tests ; il n’est plus le parcours de création actif. Voir [validation](docs/VALIDATION.md), [suivi](docs/EVOLUTION.md), [mise en service](docs/MISE-EN-SERVICE.md) et [sécurité](SECURITY.md).
