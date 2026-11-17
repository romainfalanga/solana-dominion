# Architecture active : aucun programme personnalisé

L’opérateur ne déploie aucun smart contract et ne constitue aucune réserve de liquidité. La plateforme utilise les programmes System, SPL Token, Token-2022 (paiement), Associated Token et Memo déjà présents sur Solana.

## Configuration

`config/platform.json` contient `paymentMint` : c’est la seule adresse à remplacer quand le token final est lancé. Le symbole, les décimales et le programme SPL sont obtenus de Solana. Le coût de création en unités du token est `creationFeeTokens` ; le wallet destinataire est `treasury`. La version de configuration est enregistrée pour permettre la récupération d’une transaction en cours lors d’une rotation du token de paiement.

## Parcours réel

1. Phantom se connecte. Le formulaire affiche le token exact, le coût applicatif et les frais SOL à la charge du créateur.
2. Le SDK vérifie le réseau, le mint de paiement et le solde du créateur ; construit une transaction atomique standard.
3. La transaction crée le mint (6 décimales), l’ATA du créateur, émet1milliard de tokens, révoque l’autorité d’émission, paie le destinataire et inscrit les métadonnées du lancement dans un mémo signé.
4. Après simulation, Phantom signe ; aucun serveur ne possède de clé de wallet. Une signature incertaine est conservée pour éviter une nouvelle création payante.
5. L’API relit la transaction finalisée et vérifie les instructions, autorités, montants, comptes et mémo avant d’inscrire le token dans D1. L’enregistrement est idempotent.
6. La carte lit les seuls tokens enregistrés, leur supply réelle et leurs prix de marchés externes disponibles. Elle ne montre pas de cours inventé.

## Capitalisation

Le prix est celui de la paire Solana dont la liquidité USD est la plus élevée parmi les réponses DexScreener. La capitalisation est le prix multiplié par la supply actuelle (burns pris en compte). La supply peut inclure des tokens détenus mais non échangés ; cette métrique ne prétend pas mesurer le flottant économique.

Aucun marché n’est créé automatiquement. Sans cotation, le token est listé en attente avec zéro surface. Avec au moins un prix positif, l’intégralité du rectangle est répartie proportionnellement. Les petits marchés peuvent présenter des prix manipulables ; le territoire n’est pas une valeur réalisable ni un conseil d’achat.

## Infrastructure

Worker Cloudflare, Static Assets, registre D1, cache court. Pas d’indexeur permanent, RPC privé facultatif, pas de service payant ajouté pour déployer un programme. Les quotas et éventuels coûts d’usage Cloudflare/RPC restent ceux des services utilisés ; aucune gratuité illimitée n’est promise.

L’ancienne architecture Anchor est archivée et inactive. Ses budgets de déploiement et réserves ne s’appliquent pas à cette version.
