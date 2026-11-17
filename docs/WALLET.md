# Page Wallet

La navigation Wallet affiche les positions Solana du compte connecté dans Phantom. La surface d’un token vaut `(quantité détenue × prix USD) / somme des valeurs USD connues`. La capitalisation du token n’intervient jamais. La recherche ne change pas le dénominateur.

## Couverture

- SOL natif et comptes SPL/Token-2022 ; plusieurs comptes du même mint sont regroupés avec des entiers atomiques exacts avant formatage.
- SOL et Wrapped SOL sont des positions distinctes, sans compter deux fois le solde natif.
- Prix externes de marché, courbes Pump vérifiées et marchés DBC détenus. Un stablecoin utilise son cours observé, sans parité supposée.
- Prix absents : quantités conservées dans la liste, valeur inconnue signalée et aucune surface inventée. Le total porte alors le nom « Valeur connue ».
- Actualisation manuelle et toutes les 30 secondes quand la page est visible. Le rafraîchissement de la carte publique est suspendu sur Wallet.
- Changement de compte : ancien portefeuille masqué immédiatement, requêtes annulées et réponses périmées ignorées. Déconnexion : portefeuille effacé.
- Lecture seule : aucune transaction, signature de paiement ou approbation de token.

## API et limites

`GET /api/wallet?owner=<adresse publique>` ; réponse `private, no-store`, sans cache partagé. Le propriétaire, les programmes des comptes et les quantités sont vérifiés. Les soldes sont finalisés, mais plusieurs lectures peuvent provenir de slots distincts ; le slot affiché est le plus ancien des soldes utilisés.

Maximum : 1 000 comptes de tokens et 250 mints positifs ; les dépassements produisent une erreur explicite, jamais un portefeuille tronqué. La page couvre les soldes SOL et tokens directement détenus ; elle ne valorise pas les positions DeFi hors wallet ni les NFT sans prix de marché pris en charge.

La disponibilité des RPC et des cotations reste nécessaire. Les erreurs sont affichées, sans substitution par des données fictives. Le blocage RPC public documenté dans VALIDATION.md n’est pas déclaré résolu par cette nouvelle page.

## Vérifications

Tests serveur : agrégation SPL/Token-2022, soldes natifs, propriétaire/programme, décimales, cours manquants, Pump, métadonnées, absence de cache et erreurs réseau. Tests navigateur de production avec fixtures explicites : répartition 75/25, recherche sans changement des poids, changement de compte pendant une requête, déconnexion, wallet vide, absence de prix, erreur RPC et affichage 320/390 px. Aucun wallet réel n’est signé par ces tests.

## Publication vérifiée

La révision `2acb3c4` a été déployée sur Cloudflare, avec CI GitHub réussie et 105 tests unitaires. Le navigateur public sans mocks confirme le menu Wallet, l’état déconnecté, l’absence de débordement mobile et d’erreur JavaScript. La route rejette un propriétaire invalide avec HTTP 400. La lecture publique du wallet fourni renvoie encore SERVICE_UNAVAILABLE : les soldes réels en production ne sont donc pas déclarés validés. Aucun fonds ni signature du propriétaire n’a été utilisé.
