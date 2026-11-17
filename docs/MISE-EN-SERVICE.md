# Mise en service

Site : https://solana-dominion.romainfalanga83.workers.dev

## Changer le token de plateforme

Modifier `paymentMint` dans `config/platform.json`, enregistrer sur `main`, attendre les validations et le déploiement Cloudflare. Aucun secret à renseigner. L’API lit les décimales, le symbole et le programme SPL. Les extensions incompatibles sont refusées.

La première création avec cette quote initialise sa configuration Meteora DBC puis crée le pool avec l’achat initial. Phantom demande deux signatures ; les créations suivantes réutilisent la configuration. Une nouvelle adresse de token entraîne une nouvelle configuration de courbe, financée en SOL par le premier signataire. Les anciens marchés gardent leurs réserves, leur quote et leurs paramètres ; ils ne sont pas convertis arbitrairement.

`treasury` reçoit la part partenaire des frais du protocole. Les paramètres `launch` règlent la courbe en unités de quote, pas en dollars. Leur modification crée une nouvelle politique pour les futurs lancements.

## Logo

Le logo est servi à `/brand/dominion-token.png`. Le JSON `/brand/token-metadata.json` prépare le nom, symbole et l’image du futur token : adapter nom/symbole lors de son émission. Changer le CA dans Dominion ne modifie pas les métadonnées d’un mint déjà émis et immutable.

## Utilisation

Connecter Phantom, choisir nom et ticker, entrer l’achat initial, lire allocation et minimum reçu, confirmer. L’application vérifie les soldes avant la configuration et simule avant signature. La connexion peut être immédiate si Phantom autorise déjà le site ; aucun délai artificiel n’est ajouté.

Les confirmations incertaines conservent leur reçu. Actualiser ou reprendre l’action plutôt que la dupliquer. Une transaction absente n’est considérée expirée qu’après vérification de sa hauteur de validité sur le réseau. Une création confirmée reste récupérable même si son enregistrement tarde.

À la fin d’une courbe, « Migrer la liquidité » crée le pool DAMMv2 avec une signature et des coûts SOL. Après migration, utiliser le lien de marché externe.

## Infrastructure

D1 : migrations `0001_registry.sql` puis `0002_curves.sql`. Elles préservent le registre historique. Build : `npm test && npm run build` ; déploiement : `npm run deploy`, sans option force persistante. Les migrations doivent précéder le code qui utilise les colonnes correspondantes.

RPC public : quotas et disponibilité externes ; une indisponibilité doit produire un état explicite, jamais une carte fictive. Pour une charge importante, renseigner un RPC adapté via les variables Cloudflare prévues.
