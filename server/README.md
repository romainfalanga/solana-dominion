# Registre de créations SPL et territoires

Cette version ne déploie aucun programme Solana propriétaire. Le navigateur construit une transaction signée dans Phantom utilisant uniquement les programmes System, SPL Token, Associated Token Account, SPL Token-2022 pour le paiement si nécessaire, et Memo. Le serveur ne possède aucune clé de signature et n’envoie aucune transaction.

## Configuration unique

`config/platform.json` définit `paymentMint`, `treasury`, `creationFeeTokens` et `cluster`. Les décimales et le programme du mint de paiement sont lus réellement sur Solana ; le montant atomique est dérivé du montant humain. Le symbole provient des métadonnées JSON parsed du mint. Sans symbole vérifiable, l’interface reçoit une adresse abrégée, jamais un nom inventé.

Le serveur accepte les mints SPL classiques et les mints Token-2022 limités aux extensions MetadataPointer et TokenMetadata, sans autorité de gel. La validation est partagée avec le navigateur dans `src/lib/quoteMint.ts`.

Une version est calculée à partir du SHA-256 du JSON ordonné `{cluster,paymentMint,treasury,creationFeeAtomic,quoteTokenProgram}`, tronqué à 16 caractères hexadécimaux. Avant d’exposer cette version, l’API la conserve dans `configurations`. Les reçus de transactions utilisant une ancienne configuration publiée restent enregistrables après un changement de token de paiement. Une collision de version avec des valeurs différentes provoque une erreur.

Variables Cloudflare : `CREATION_ENABLED=true` active le parcours, `SOLANA_RPC_URL` contient éventuellement un RPC serveur privé, `PUBLIC_SOLANA_RPC_URL` un RPC explicitement public pour le navigateur. Le binding D1 `DB` est requis. Aucune URL RPC privée ne figure dans les réponses ni les messages d’erreur. `ASSETS` sert l’interface. Utiliser `nodejs_compat` pour les dépendances Solana.

## Routes

- `GET /api/state` retourne `{config,snapshot}` ensemble ; aucune démonstration automatique en cas d’échec. `programId` vaut null, les échanges intégrés sont désactivés et `creationEnabled` reflète l’activation explicite.
- `GET /api/config` et `GET /api/territories` restent disponibles séparément.
- `POST /api/launches` accepte uniquement `{"signature":"…"}`. Corps JSON borné à 5 Kio et refus des origines de navigateur différentes. Aucune métadonnée envoyée directement par le client n’est enregistrée.
- `GET /api/health` vérifie le service HTTP, pas la disponibilité de Solana ou D1.

Les lectures sont mises en cache 15 secondes dans le cache local au datacenter Cloudflare. La clé contient la configuration et son activation. Après enregistrement, le cache des territoires est invalidé dans le datacenter courant. Les réponses navigateur portent `no-store`. Aucun proxy RPC arbitraire n’est exposé.

## Vérification des créations

L’API relit la transaction `jsonParsed` avec le commitment **finalized**. Si elle n’est pas encore disponible, elle répond HTTP 409 `TRANSACTION_PENDING` avec `Retry-After: 4`. Le client doit réessayer la même signature, sans payer une nouvelle création.

La vérification impose :

1. Transaction réussie, signature retournée correspondante, créateur payeur et signataire, nouveau mint également signataire.
2. Création System d’un nouveau compte de mint de 82 octets appartenant au programme SPL classique, dans cette même transaction.
3. `initializeMint2` avec 6 décimales, autorité initiale du créateur et aucune autorité de gel.
4. `mintTo` de 1 000 000 000 tokens vers l’ATA du créateur, puis révocation de l’autorité de mint. Le solde initial final de cette transaction confirme cette attribution.
5. `transferChecked` du montant exact de frais dans la monnaie et vers l’ATA de trésorerie de la configuration publiée. Le delta des soldes de la trésorerie doit confirmer la réception, ce qui rejette un remboursement dissimulé dans la même transaction. Un créateur qui est lui-même la trésorerie réalise un auto-transfert.
6. Un seul reçu Memo signé par la transaction, avec application, version, configuration, mint, nom et symbole conformes.
7. État actuel du mint : classique, initialisé, 6 décimales, autorités de mint et de gel absentes, offre au plus égale à l’offre initiale. Des burns postérieurs ne bloquent pas un enregistrement retardé ; l’état initial reste prouvé par la transaction finalisée.

D1 impose l’unicité du mint et de la signature par réseau. La même signature est idempotente, y compris après rotation du token de paiement. Une désactivation administrative de la création suspend les nouveaux enregistrements ; les reçus peuvent être réessayés après réactivation.

## Valorisation des territoires

Le registre conserve toutes les générations de token de paiement, dans le réseau courant. L’offre actuelle de chaque token créé est relue dans son mint Solana finalisé ; les burns réduisent donc sa valorisation.

Les cotations viennent de l’API publique [DexScreener](https://docs.dexscreener.com/api/reference), endpoint `/tokens/v1/solana/{tokenAddresses}`, par groupes de 30 adresses. Le serveur choisit, pour chaque mint, la paire où il est **baseToken**, avec le plus de liquidité USD déclarée. Le prix est en USD. Les champs externes `marketCap` et `fdv` ne sont pas utilisés.

**Valorisation affichée = prix USD × offre actuelle non brûlée.** Ce n’est pas une expertise indépendante de l’offre circulante ni une promesse de montant réalisable à la vente. Les tokens verrouillés ou détenus par le créateur ne sont pas déduits. Une cotation absente ou sans liquidité positive donne un prix et une surface nuls ; le token reste dans la liste. Une panne du fournisseur produit une erreur explicite, pas un prix inventé ni un retour à la démonstration. Cette version ne crée pas automatiquement un pool de liquidité.

Limites : 1 000 tokens par réseau avant refus explicite, jamais de troncature silencieuse du dénominateur. Les offres sont lues par groupes de 100 comptes ; chaque groupe a son propre slot avec `minContextSlot` monotone, pas un snapshot global historique atomique. Les cotations externes ont leur propre temporalité. Les petits pools et le prix spot restent manipulables. Avant forte fréquentation, prévoir un indexeur et un cache coordonné, une limitation de débit et la surveillance des RPC/DexScreener.

## Validation

`tests/fixtures/standard-launch.json` provient d’une véritable transaction SDK réussie sur validateur local, finalisée, sans secret. Les tests HTTP utilisent cette structure réelle puis altèrent les preuves pour vérifier les rejets : frais erronés ou remboursés, absence de création du mint, autorités, offre, configuration inconnue, mauvaise origine, attente de finalisation, idempotence et rotation de paiement. Les tests emploient un faux D1 et un faux transport RPC ; ils ne constituent pas un audit externe ni une transaction mainnet de validation.
