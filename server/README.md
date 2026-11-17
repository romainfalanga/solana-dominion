# API Cloudflare

API en lecture seule, sans base de données, sans clés de signature et sans relais arbitraire de transactions.

- `GET /api/config` : configuration publique, décimales réelles du token de paiement, activation explicite des échanges. En mode réel, vérifie le genesis hash du réseau, le programme exécutable et le mint SPL classique sans autorité de gel. Le RPC privé ne figure jamais dans la réponse.
- `GET /api/territories` : comptes Pool appartenant au programme, filtrés par discriminateur et monnaie de paiement. Vérification du PDA et des deux ATA ; lecture conjointe de chaque mint et des deux réserves ; autorité de mint et de gel absentes ; offre courante lue dans le mint pour tenir compte des burns. Prix = réserve quote / réserve base, après normalisation des décimales. Capitalisation circulante = prix × (offre courante − réserve base).
- `GET /api/health` : santé HTTP uniquement ; ne certifie pas la disponibilité de Solana.

Les réponses réelles de config et territoires sont mises en cache 10 secondes dans le Cache API Cloudflare. Cette API est locale à chaque datacenter, pas un verrou distribué global. Les paramètres de requête ne changent pas le monde et ne fragmentent pas le cache. Les navigateurs reçoivent `no-store` pour éviter une configuration périmée après changement de monde.

Le RPC utilise `confirmed`. Le programme, les mints et les réserves sont la source de vérité, jamais une valorisation envoyée par un navigateur. Chaque groupe contient au plus 33 marchés (99 comptes). Les trois comptes d'un marché partagent le même snapshot bancaire ; plusieurs groupes peuvent correspondre à des slots différents. `minContextSlot` empêche une lecture antérieure au groupe précédent ; `snapshot.slot` expose le plus ancien slot des réserves retournées. Cela ne fournit pas un snapshot historique global atomique. Pour l'obtenir à grande échelle, prévoir un indexeur qui reconstruit l'état à une frontière de slot finalisée.

Le premier déploiement limite un monde à 250 marchés. Au-delà, l'API refuse le résultat au lieu de tronquer le dénominateur et de produire de mauvaises proportions. Les réponses RPC sont bornées à 2 Mo et chaque requête à 8 secondes. Avant une ouverture publique importante : indexeur, limitation de débit au niveau Cloudflare, RPC dimensionné, surveillance. La valorisation au prix spot n'est pas une estimation de la somme réalisable en vendant toute l'offre ; les achats, ventes et donations aux réserves peuvent modifier le prix.

Variables :

| Variable | Rôle |
| --- | --- |
| `PLATFORM_MODE` | `demo` (défaut), `devnet`, `mainnet-beta` |
| `QUOTE_MINT` | Mint SPL du monde ; aucune adresse par défaut en mode réel |
| `QUOTE_SYMBOL` | Symbole d'affichage, `DOM` par défaut |
| `PROGRAM_ID` | Adresse du programme déjà déployé sur le réseau choisi |
| `SOLANA_RPC_URL` | RPC serveur HTTPS ; configurer comme secret s'il contient une clé |
| `PUBLIC_SOLANA_RPC_URL` | RPC navigateur HTTPS explicitement public ; défaut RPC officiel du réseau |
| `TRADING_ENABLED` | `true` pour proposer des transactions, sinon lecture seule |
| `MAINNET_ACK` | `AUDITED_AND_APPROVED` en plus de `TRADING_ENABLED=true` pour mainnet ; ce marqueur ne remplace pas un audit |

Bindings : `ASSETS` facultatif pour servir les fichiers de l'interface. Compatibilité Worker : `nodejs_compat` pour les dépendances Solana. Les logs d'erreur n'incluent pas les messages bruts du fournisseur RPC, car ils peuvent contenir son URL privée.

Tests : `npx vitest run tests/server.test.ts`. Ce sont des tests Node avec RPC simulé ; la validation du runtime Cloudflare et les tests devnet doivent également être exécutés avant ouverture réelle.
