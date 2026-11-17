# Dominion

Launchpad Solana utilisant les programmes SPL existants, sans déploiement de smart contract personnalisé.

**Site : https://solana-dominion.romainfalanga83.workers.dev**

## Remplacer le token de paiement

Dans [`config/platform.json`](config/platform.json), modifier uniquement `paymentMint`, puis enregistrer sur `main`. GitHub déclenche les tests et Cloudflare déploie. Symbole, décimales et programme SPL sont détectés depuis Solana. Les anciennes créations restent dans le registre.

Le token de test est l’adresse fournie par le propriétaire, `31CZR8AgCjGsbkjJGUznY99hiKTQkX6J2zxiwN9Mpump` (CHOULE sur chaîne). Le tarif de création est `creationFeeTokens` (1 token par défaut), reçu par `treasury`. Ces deux paramètres sont également configurables.

## Création réelle

Phantom signe une transaction atomique qui crée un mint SPL classique, attribue un milliard de tokens au créateur, révoque l’émission, transfère le paiement configuré et inscrit un mémo signé. En cas d’échec, aucune création ni aucun paiement applicatif n’est conservé ; les frais réseau d’une transaction échouée peuvent néanmoins être facturés par Solana.

Le créateur paie ses frais réseau et comptes Solana. L’opérateur n’a pas à financer le déploiement d’un programme. Aucun fonds n’est détenu par le serveur et aucune clé privée n’y est requise.

Le serveur vérifie la transaction finalisée avant inscription D1. Nom et symbole sont enregistrés dans le mémo et le registre Dominion ; le token n’a pas de compte de métadonnées Metaplex, donc les wallets externes peuvent afficher son adresse plutôt que son nom.

## Territoires et prix

Prix USD de la paire Solana la plus liquide disponible sur DexScreener × supply actuelle vérifiée sur Solana. Aucun prix inventé, aucune réserve interne. Sans marché coté, capitalisation zéro et présence dans la liste d’attente. Les échanges/liquidités se font sur les marchés externes ; créer un token ici ne lui crée pas automatiquement un marché ou une liquidité. La recherche ne change pas le dénominateur global de la carte.

## Développement

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

`dev` montre une simulation locale explicite ; le site de production utilise l’API mainnet et le registre D1. Pour tester la transaction sans dépenser de SOL réel : démarrer un validateur local standard puis `LOCAL_RPC_URL=http://127.0.0.1:8899 npm run test:standard`.

La CI teste le code et le navigateur avec des réponses de lecture simulées. Les scénarios du SDK de création sont également exécutés sur un validateur local. Aucune transaction mainnet n’est envoyée automatiquement par les tests.

Voir [mise en service](docs/MISE-EN-SERVICE.md), [validation](docs/VALIDATION.md) et [sécurité](SECURITY.md).
