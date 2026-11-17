# Dominion — plan et décisions d’architecture

## Objectif
Un launchpad Solana où les marchés partagent un rectangle intégral. La surface de chaque token est sa capitalisation en circulation divisée par la somme des capitalisations du même monde. Un monde correspond à un mint de paiement unique et un réseau Solana.

## Périmètre de la version
- Interface française responsive : carte, classement, recherche, détail, création, achat/vente, règles.
- Démonstration locale explicite, persistée dans le navigateur ; aucune simulation présentée comme donnée blockchain.
- Connexion Phantom et transactions non custodiales : seule la signature du wallet autorise les transferts.
- Programme Anchor SPL classique : création atomique du mint, supply fixe de 1 milliard (6 décimales), réserves détenues par PDA, autorité mint révoquée, aucune autorité de gel.
- Marché constant product sans frais applicatifs V1. Les frais et loyers Solana restent dus en SOL.
- Aucun retrait de liquidité par créateur/admin ; le dépôt de création est un engagement permanent. Aucune allocation gratuite au créateur. Un token créé sans acheteur apparaît dans la liste mais possède 0 territoire.
- Cloudflare Workers + Static Assets, API lecture seule, source canonique Solana, cache partagé 10 secondes. Pas de base SQL, de serveur permanent ni de websocket par visiteur au démarrage.
- Code GitHub privé et build reproductible. Mainnet désactivé par défaut.

## Modèle mathématique
En unités atomiques : `sortie = floor(réserveSortie × entrée / (réserveEntrée + entrée))`.
Tous les transferts utilisent u64, les produits Rust u128 et les calculs client BigInt. Le produit des réserves ne décroît pas par arrondi. Glissement via `min_out`, expiration à 120 secondes côté client, maximum 300 secondes côté programme.

La capitalisation affichée est `quoteReserve × (mint.supply − baseReserve) / baseReserve / 10^quoteDecimals`. La supply vient du mint actuel : les burns sont pris en compte. Il ne s’agit pas de FDV. Les tokens détenus hors vault sont considérés en circulation, y compris ceux de créateurs ou comptes inactifs ; ce n’est pas une estimation fine du flottant.

Le treemap squarifié respecte exactement les proportions avant rasterisation, sans surface minimale artificielle ni espace entre les régions. La recherche ne filtre jamais le dénominateur. Un token à zéro n’a pas de région ; si tout vaut zéro, écran vide explicatif. Les pixels rendent les très petites régions invisibles ; elles restent accessibles dans le classement.

## Prix et résistance économique
Le prix V1 est le prix marginal des réserves internes, pas un oracle externe, une moyenne temporelle ni une somme retirable. Une faible liquidité permet de gonfler la capitalisation à faible coût. Exemple : seed 0,000001 quote puis achat 1 quote peut produire environ 1 000 001 quote de capitalisation spot pour ~1 quote de réserve. C’est une limite économique majeure du modèle spot, pas un rendement.

La réserve quote est affichée et les règles l’expliquent. Avant une compétition mainnet : définir conditions d’admission/liquidité on-chain, source et fenêtre de prix résistante aux manipulations (TWAP), gérer les transferts directs vers vault, tests adversariaux économiques et revue indépendante. Un seuil de liquidité seul ne suffit pas. Aucun prix USD n’est inventé : toute valorisation est en token quote.

## Données et coûts
L’API vérifie genesis du réseau, programme exécutable, propriétaires SPL, mints, PDA, vaults ATA et supply. RPC secret côté Worker, endpoint public distinct côté wallet. Pas de proxy RPC générique exploitable par le public. Snapshots bornés à 250 pools et 2 Mo par réponse RPC, timeout 8 s. Au-delà, erreur explicite plutôt qu’une carte avec dénominateur tronqué.

Rafraîchissement 15 secondes en onglet visible, cache CDN 10 secondes : données différées, pas temps réel atomique. Les comptes d’un lot sont lus au même slot ; les lots distincts peuvent différer. Avant croissance : indexeur événements WebSocket/Geyser avec rattrapage des slots finalisés, stockage de snapshots, réconciliation périodique, mesure du coût fournisseur RPC. Aucun prix forfaitaire/« gratuit illimité » promis.

## Configuration du token de plateforme
Modifier `QUOTE_MINT`, `QUOTE_SYMBOL` et `PLATFORM_MODE` dans `cloudflare.config.ts` puis redéployer. Les décimales sont vérifiées automatiquement sur chaîne. `PROGRAM_ID` identifie le programme réellement déployé ; `TRADING_ENABLED` reste false tant que le monde n’est pas prêt. Le mint quote doit être SPL classique sans autorité de gel. Les extensions Token-2022 (taxes/transfert hooks) ne sont pas supportées.

Un changement de quote ouvre un autre monde. Les anciens marchés ne changent ni réserve ni devise ; conserver leur configuration et une version déployée pour leur accès. Il n’existe pas de migration magique de liquidité. Ajouter un sélecteur de mondes historiques avant rotation en production. L’adresse est publique ; les clés et seeds restent hors GitHub et du navigateur serveur.

## Sécurité et validation
- Contrainte on-chain de tous les comptes et des programmes CPI.
- Pas de clé de trésorerie au serveur ; simulation puis signature Phantom ; vérification de confirmation et message incluant signature en cas d’état incertain.
- Minimum reçu lié aux réserves du devis affiché ; rafraîchissement demandé si marché a bougé au-delà du seuil.
- Tests arithmétiques/proportions, tests API avec RPC simulés, tests natifs Rust, compilation SBF, tests de transactions local-validator, tests navigateur desktop/mobile.
- Programme non audité ; aucune affirmation de sécurité absolue. Mainnet nécessite une revue de code et économique, une politique d’upgrade/multisig, un budget RPC et un essai devnet avec Phantom.

## Déploiement par étapes
1. Architecture et interfaces communes ; coder composants séparés.
2. Intégrer et vérifier ; publier démonstration sans fonds.
3. Créer/pousser dépôt privé et brancher Workers Builds quand droits GitHub disponibles.
4. Déployer programme devnet avec clés de déploiement gérées par le propriétaire, créer mint de test et provisionner wallet de test ; configurer le monde devnet.
5. Tester création/achat/vente dans Phantom et vérifier comptes Explorer.
6. Mainnet uniquement après traitement des limites ci-dessus, aucun basculement automatique.
