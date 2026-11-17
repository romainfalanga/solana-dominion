# Configuration et utilisation

## Remplacer le token de test

Ouvrir https://github.com/romainfalanga/solana-dominion/blob/main/config/platform.json ; modifier uniquement `paymentMint`, puis enregistrer sur `main`. Attendre le build Cloudflare réussi. Le site vérifie la nouvelle adresse et détecte symbole/décimales automatiquement. Un mint inexistant, gelable ou possédant une extension de transfert incompatible est refusé : aucune adresse invalide ne peut être rendue fonctionnelle par un simple remplacement.

Les anciens tokens créés restent enregistrés. Les transactions correspondant à une ancienne configuration exposée peuvent être enregistrées après le changement d’adresse grâce à l’historique.

## Créer un token

Ouvrir le site dans un navigateur avec Phantom, ou le navigateur intégré de Phantom mobile. Connecter le wallet, saisir nom et symbole, consulter le coût, puis signer. Le créateur reçoit1milliard de tokens, sans gel ni émission supplémentaire possible. Nom et symbole sont propres au registre Dominion et au mémo ; il n’y a pas de métadonnées Metaplex automatiquement publiées.

La création demande le paiement applicatif affiché (par défaut1CHOULE) et les frais SOL du réseau et des comptes créés. Quand le créateur est aussi le destinataire configuré, le paiement CHOULE revient sur son propre compte. L’opérateur n’a aucun programme personnalisé à financer.

Le mint de paiement de test fourni est `31CZR8AgCjGsbkjJGUznY99hiKTQkX6J2zxiwN9Mpump`, dont le symbole on-chain est CHOULE. Pas de phrase de récupération ni de clé privée à transmettre.

## Carte et marchés

La création d’un token n’ajoute pas automatiquement de liquidité. Le token apparaît dans la liste ; un territoire lui est attribué quand un prix de marché externe est disponible. Le lien « Voir le marché externe » ouvre DexScreener et ne garantit pas une cotation existante.

## Administration

`CREATION_ENABLED` dans cloudflare.config.ts suspend les nouvelles créations côté interface/API. Aucun smart contract personnalisé à mettre à jour. Le registre D1 utilise la migration `migrations/0001_registry.sql`.

GitHub main déclenche Workers Builds : tests puis build, déploiement normal sans --force. Les modifications documentaires seules ne redéploient pas. Le token Workers Builds existant reste enregistré dans Cloudflare, aucun secret n’est copié dans GitHub.

En cas de confirmation incertaine, actualiser et vérifier la signature dans Explorer ; ne pas recréer le token. L’inscription peut attendre la finalisation Solana (plusieurs secondes). Un reçu local permet la reprise sans nouveau paiement.
