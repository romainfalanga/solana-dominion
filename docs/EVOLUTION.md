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
| R8 | Tests fonctionnels, visuels et blockchain sans dépense automatique ; déploiement vérifié | Principal | En cours de validation finale |

## Architecture retenue et vérifiée

Le mécanisme SPL précédent attribuait 100 % au créateur contre un paiement fixe : il ne répond pas à R6 et doit être remplacé par une courbe utilisant le token de plateforme comme quote. Solution retenue : réutiliser un protocole déjà déployé (Meteora DBC) compatible avec le mint Token-2022 fourni, sans déploiement d’un programme propriétaire. La création des comptes et les transactions exigent néanmoins du SOL du signataire. Aucune transaction réelle n’est envoyée par les tests.

La relation à la crypto de plateforme est une cotation de marché, pas une parité garantie ni une promesse de prix. La part du créateur doit venir d’un achat réel sur la courbe, et le reste de la supply rester dans le protocole. Ne pas simuler ce comportement avec un transfert de frais à la trésorerie.

## Vérifications complémentaires

Revue indépendante : reçus expirés, conservation des anciennes quotes, préflight avant paiement de configuration, migration arrivée au seuil. Corrections réalisées et couvertes par tests. Worker : configuration ANCHOR_BROWSER pour éviter une branche Node au chargement. Déploiement/publication encore à contrôler avant clôture.
