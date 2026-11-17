# API des territoires et courbes Meteora DBC

Les nouvelles créations utilisent le programme Meteora Dynamic Bonding Curve existant sur Solana, sans programme propriétaire. Le navigateur construit les transactions et Phantom les signe. Le serveur ne détient aucune clé et n’envoie aucune transaction. Les anciennes créations SPL restent dans le registre et conservent leur vérificateur historique.

## Configuration et historique

`config/platform.json` définit le mint de paiement, la trésorerie, le réseau et les paramètres de courbe : capitalisations initiale et de migration exprimées en tokens de paiement, frais de trading en points de base. Le nouveau parcours DBC n’applique aucun forfait de création (`creationFeeAtomic: "0"`). Les anciens frais sont conservés uniquement dans les configurations historiques nécessaires à la vérification de reçus SPL déjà signés.

Le RPC doit retourner le hash genesis complet du réseau attendu. Le mint de paiement est lu réellement : programme, décimales et symbole issu des métadonnées. Sans symbole disponible, une adresse abrégée remplace le nom. Les mints SPL classiques et Token-2022 limités à MetadataPointer et TokenMetadata sont acceptés, sans autorité de gel. La validation est partagée avec le navigateur.

`curveVersion` est un SHA-256 tronqué à 16 caractères hexadécimaux des paramètres canoniques, comprenant les octets de l’instruction Meteora et les identités de paiement et de trésorerie. `configVersion` inclut cette version et l’adresse éventuelle de configuration DBC. Les configurations exposées sont mémorisées dans D1 avant réponse. La première configuration DBC canonique enregistrée pour un réseau, un mint et une version est retenue. Une rotation de paiement conserve les anciennes créations et leur configuration de marché propre, afin de permettre leurs échanges avec leur monnaie d’origine.

Variables : `CREATION_ENABLED=true` active les parcours, `SOLANA_RPC_URL` peut contenir un RPC privé, `PUBLIC_SOLANA_RPC_URL` est explicitement public. Le binding D1 `DB` est obligatoire ; `ASSETS` sert l’interface. La compatibilité `nodejs_compat` est requise. Aucun RPC privé n’est exposé dans les réponses ou erreurs.

## Routes et preuves

- `GET /api/state` retourne ensemble `{config,snapshot}`, sans démonstration de secours. Sans configuration DBC enregistrée, `dbcConfig` est null et les échanges de la nouvelle courbe sont désactivés.
- `GET /api/config` et `GET /api/territories` restent disponibles séparément.
- `POST /api/curve-config` et `POST /api/launches` acceptent uniquement une signature de transaction ; corps JSON limité à 5 Kio et origine de navigateur identique obligatoire.
- `GET /api/metadata/:mint` expose le nom et le symbole prouvés par la transaction enregistrée ; avant enregistrement, la route retourne 404.
- `GET /api/health` identifie le service `meteora-dbc` version 0.3.0 ; ce n’est pas une sonde de disponibilité RPC/D1.

Les transactions sont relues avec le commitment **finalized**. Une transaction pas encore disponible produit HTTP 409 `TRANSACTION_PENDING`, `Retry-After: 4`. Réessayer sa signature ne nécessite aucune nouvelle transaction ni paiement.

Pour l’initialisation de configuration, le serveur vérifie le reçu Memo et sa configuration publiée, le signataire, les comptes de l’instruction `createConfig2`, les octets exacts des paramètres canoniques, le propriétaire du compte finalisé et ses paramètres décodés. La politique fixe un milliard de tokens avec six décimales, sans allocation initiale gratuite au créateur, sans vesting, avec autorités supprimées, migration DAMM v2 et liquidité partenaire entièrement verrouillée de façon permanente.

Pour un lancement, il vérifie une configuration DBC enregistrée, l’initialisation du pool et un achat dans la même transaction réussie. Les adresses de pool, d’autorité et de vaults sont dérivées ; créateur, mint signataire, programmes SPL, sens d’échange, comptes de paiement et montant positif doivent correspondre. Les soldes finaux prouvent une réception de tokens par le créateur au moins égale au minimum signé et un paiement au vault de quote. L’état finalisé du pool, de sa configuration et du mint est relu. L’offre actuelle peut être inférieure à l’offre initiale après des burns, mais les autorités de mint et de gel doivent être absentes. Le nom et le symbole viennent de l’instruction signée, jamais de champs libres du POST.

Le vérificateur SPL historique conserve ses preuves de création de mint, attribution initiale, révocation, paiement exact et delta de trésorerie, Memo et historique de politique. D1 impose l’unicité des signatures, mints et pools par réseau. Les reçus sont idempotents.

## Territoires, prix et migration

Le registre contient toutes les générations du réseau courant. Le mint de paiement actuel participe toujours une seule fois à la compétition, même sans création enregistrée. Une rotation retire l’ancien token plateforme s’il n’est pas lui-même une création enregistrée.

Avant migration, le prix d’un token DBC vient du `sqrtPrice` réel du pool, converti selon les décimales puis multiplié par le prix USD de sa monnaie de paiement. Les anciens marchés conservent cette monnaie d’origine. Après migration, le serveur utilise uniquement une cotation externe du token ; il ne conserve pas artificiellement le dernier prix de courbe. `migrationReady` exige un pool non migré, des réserves quote au seuil du protocole et `migrationProgress === 2`. Un marché migré fournit un lien Jupiter construit avec ses deux mints.

DexScreener est interrogé sur `/tokens/v1/solana/{tokenAddresses}` par groupes de 30. La paire où le mint est `baseToken` avec la plus grande liquidité USD positive fournit le prix. Les capitalisations et FDV externes ne sont pas utilisées. Une cotation absente donne une valorisation nulle ; une panne du fournisseur échoue explicitement.

**Capitalisation affichée = prix spot USD × offre actuelle non brûlée.** L’offre est relue sur Solana, y compris pour le token plateforme Token-2022. Les soldes verrouillés ne sont pas déduits : ce n’est ni une mesure indépendante de l’offre circulante ni une promesse de valeur réalisable à la vente. Tous les territoires partagent le même dénominateur.

## Cache, limites et validation

Les lectures sont mises en cache pendant 15 secondes au datacenter Cloudflare ; les écritures invalident le cache local et les navigateurs reçoivent `no-store`. Les clés comprennent la configuration et son activation. Aucun proxy RPC arbitraire n’est proposé.

Le registre refuse au-delà de 1 000 créations par réseau, sans troncature du dénominateur. Les comptes sont lus par groupes de 100 avec `minContextSlot` monotone : il ne s’agit pas d’un snapshot historique global atomique. Les cotations externes ont leur propre temporalité et les petits marchés restent manipulables. Un indexeur, un cache coordonné et une limitation de débit seront nécessaires avant forte fréquentation. Meteora et les RPC restent des dépendances externes.

Les fixtures `standard-launch.json` et `dbc-launch.json` proviennent de véritables transactions SDK finalisées sur validateur local. Le scénario DBC utilise les binaires des programmes existants et vérifie configuration, lancement avec achat, achats et ventes suivants, et annulation atomique d’une transaction échouée. Les tests HTTP réutilisent ces preuves avec SQLite/D1 et RPC simulés, puis altèrent les conditions pour vérifier les rejets. Les tests de marché couvrent absence de prix, offre réelle, rotation, migration et conservation de la politique historique. Ces vérifications ne constituent ni un audit externe ni une transaction mainnet de validation.
