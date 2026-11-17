# Mise en service

Site : https://solana-dominion.romainfalanga83.workers.dev

## Changer le token mère de gouvernance

Modifier uniquement `paymentMint` dans `config/platform.json`, puis valider et publier. Ce champ désigne désormais le token mère de gouvernance. Les scrutins déjà publiés conservent leur mint et leur snapshot d’origine. Ne pas modifier un scrutin existant lors de cette rotation.

## Ajouter un territoire et sa monnaie

Le catalogue est `config/worlds.json`. Chaque territoire garde son identifiant et son `quoteMint` après son ouverture. Le territoire d’origine utilise donc toujours son token initial, même après changement du token mère. GTA 6 attend son véritable mint : ne pas y substituer une adresse de démonstration.

Créer le memecoin séparément, déterminer ses paramètres de courbe, vérifier la compatibilité SPL et le prix, puis renseigner une nouvelle entrée dans le catalogue. Les paramètres `launch` sont exprimés en unités de ce token local, pas en dollars. Ne pas recopier automatiquement les seuils d’un autre monde. Voir [Territoires et gouvernance](TERRITOIRES-GOUVERNANCE.md).

La première création dans ce territoire initialise sa configuration Meteora DBC puis crée le pool avec l’achat initial. Phantom demande deux signatures ; les créations suivantes réutilisent la configuration. Les anciens marchés conservent réserves, monnaie et paramètres. `treasury` reçoit la part partenaire des frais du protocole.

## Logo

Le logo est servi à `/brand/dominion-token.png`. Le JSON `/brand/token-metadata.json` prépare le nom, symbole et l’image du futur token : adapter nom/symbole lors de son émission. Changer le CA dans Dominion ne modifie pas les métadonnées d’un mint déjà émis et immutable.

## Utilisation

Connecter Phantom, choisir nom et ticker, entrer l’achat initial, lire allocation et minimum reçu, confirmer. L’application vérifie les soldes avant la configuration et simule avant signature. La connexion peut être immédiate si Phantom autorise déjà le site ; aucun délai artificiel n’est ajouté.

Les confirmations incertaines conservent leur reçu. Actualiser ou reprendre l’action plutôt que la dupliquer. Une transaction absente n’est considérée expirée qu’après vérification de sa hauteur de validité sur le réseau. Une création confirmée reste récupérable même si son enregistrement tarde.

À la fin d’une courbe, « Migrer la liquidité » crée le pool DAMMv2 avec une signature et des coûts SOL. Après migration, utiliser le lien de marché externe.

## Infrastructure

D1 : appliquer les migrations numérotées du dossier `migrations/` dans l’ordre, avant le déploiement du code correspondant. Elles préservent le registre historique. Build : `npm test && npm run build` ; déploiement : `npm run deploy`, sans option force persistante. Les migrations doivent précéder le code qui utilise les colonnes correspondantes.

RPC public : quotas et disponibilité externes ; une indisponibilité doit produire un état explicite, jamais une carte fictive. Pour une charge importante, renseigner un RPC adapté via les variables Cloudflare prévues.

## Accès RPC serveur dédié

Si les RPC anonymes restent limités, créer un endpoint mainnet propre au projet (par exemple l’offre gratuite Helius), puis ajouter son URL complète dans Cloudflare : Workers & Pages → solana-dominion → Settings → Variables and Secrets → Add → type Secret → nom `SOLANA_RPC_URL`. Ne pas mettre cette URL contenant une clé dans GitHub. Le serveur vérifie le réseau avant de lire les comptes ; cet accès ne permet pas de signer avec le wallet. `PUBLIC_SOLANA_RPC_URL` reste l’URL publique utilisée par le navigateur. Après ajout, vérifier `/api/config` puis `/api/state` et le formulaire d’achat avant de considérer la validation publique terminée.
