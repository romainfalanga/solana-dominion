# Évolution demandée le 17 novembre 2026

| ID | Résultat attendu | Responsable | État |
|---|---|---|---|
| R1 | Supprimer sous-barre frais/CA et label du héros ; carte visible dès l’arrivée | Interface | Implémenté, tests réussis |
| R2 | Logo original et déclinaisons, CA copiable à emplacement fixe | Principal / interface | Implémenté, tests réussis |
| R3 | Token de plateforme présent dans la compétition, capitalisation réelle, déduplication | Backend | Implémenté, tests réussis |
| R4 | Aucune bannière permanente après connexion Phantom | Principal | Vérifié : aucun message après connexion |
| R5 | Règles pour utilisateurs crypto, sans statistiques ; supprimer page classement mais conserver tableau accueil | Interface | Implémenté, tests réussis |
| R6 | Lancement avec achat initial en token de plateforme ; montant détermine tokens reçus / part de supply | Architecture / principal | DBC : tests réels locaux et simulation mainnet réussis |
| R7 | Remplacement du token via paymentMint uniquement, config historique cohérente | Principal | Vérifié : politiques historiques et nouvelle configuration automatique |
| R8 | Tests fonctionnels, visuels et blockchain sans dépense automatique ; déploiement vérifié | Principal | Code déployé ; validation publique bloquée par les RPC anonymes |

## Architecture retenue et vérifiée

Le mécanisme SPL précédent attribuait 100 % au créateur contre un paiement fixe : il a été remplacé par une courbe utilisant le token de plateforme comme quote. Solution retenue : réutiliser un protocole déjà déployé (Meteora DBC) compatible avec le mint Token-2022 fourni, sans déploiement d’un programme propriétaire. La création des comptes et les transactions exigent néanmoins du SOL du signataire. Aucune transaction réelle n’est envoyée par les tests.

La relation à la crypto de plateforme est une cotation de marché, pas une parité garantie ni une promesse de prix. La part du créateur vient d’un achat réel sur la courbe, et le reste de la supply demeure dans le protocole.

## Vérifications complémentaires

Revue indépendante : reçus expirés, conservation des anciennes quotes, préflight avant paiement de configuration, migration arrivée au seuil. Corrections réalisées et couvertes par tests. Worker : configuration ANCHOR_BROWSER pour éviter une branche Node au chargement. Déploiement Cloudflare réussi pour 4bf6836, CI GitHub web et navigateur réussie, 92 tests automatisés. Le test navigateur public sans mocks reste bloqué : Publicnode renvoie 429 et le RPC officiel renvoie 403 depuis le Worker. La présence du token de plateforme sur la carte publique et le devis réel du formulaire ne sont donc pas encore validés. Un accès RPC propre au projet a été demandé ; aucune création mainnet signée ni dépense de fonds du propriétaire n’a été effectuée.
