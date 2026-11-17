# Architecture active : courbes Meteora DBC

## Objectifs et découpage

Le suivi détaillé des demandes et vérifications est dans [EVOLUTION.md](EVOLUTION.md). L’interface donne la priorité à la carte ; la liste des tokens reste sur la même page. Un logo unique identifie Dominion et le token de plateforme. Le CA actif est copiable à côté de la carte. Les règles s’adressent aux utilisateurs crypto.

## Programme et économie

Réutiliser Meteora DBC déjà déployé permet une quote personnalisée Token-2022 compatible avec CHOULE, sans déployer un programme propriétaire. Raydium LaunchLab impose une configuration globale de quote administrée et ne convenait pas au remplacement permissionless demandé.

- Supply fixe : 1 milliard, 6 décimales ; aucun premine créateur.
- Achat initial en quote ; solde et budget SOL vérifiés avant toute configuration.
- Configuration partagée immuable par quote/politique/trésorerie ; première création en deux transactions, puis une transaction atomique pool + achat.
- Achats et ventes sur la courbe, devis SDK, minimum reçu conservé jusqu’à la transaction signée.
- Fin de courbe : migration permissionless vers DAMMv2 ; liquidité permanente verrouillée. Les marchés migrés sont accessibles par lien externe.

## Données et vérification

Le serveur accepte des signatures publiques, vérifie la finalisation, le programme, les instructions, les comptes, la politique, les soldes et les autorités. D1 conserve l’historique des configurations et les marchés. Les anciennes quotes restent utilisables après rotation. Les montants ne sont pas acceptés sur la foi du navigateur.

Le token plateforme rejoint le registre de lecture sans inscription artificielle. Capitalisations en USD : prix de courbe × cours de quote × offre actuelle ; pour la plateforme et les marchés migrés, cours externe liquide. Les proportions incluent tous les tokens valorisables, sans effet de la recherche sur le dénominateur.

## Déploiement et coûts

Cloudflare Worker + D1, build automatique GitHub. SDK DBC chargé à la demande dans le navigateur. Cache de lecture 15 secondes, RPC en lots et cours groupés par 30 adresses. Aucun serveur ne signe ni ne détient les fonds. Les coûts Solana restent à la charge du signataire ; aucun financement de programme propriétaire n’est demandé.

## Sources techniques

- https://docs.meteora.ag/developer-guide/guides/dbc/overview
- https://github.com/MeteoraAg/docs/blob/main/core-products/dbc/launch-configurations.mdx
- https://github.com/MeteoraAg/dynamic-bonding-curve-sdk
- https://github.com/raydium-io/raydium-docs-v1/blob/main/products/launchlab/global-config.mdx
