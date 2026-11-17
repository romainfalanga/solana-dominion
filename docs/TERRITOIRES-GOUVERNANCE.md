# Territoires permanents et gouvernance

## Décisions produit

- Le token mère donne un droit de vote proportionnel au solde fixé pour chaque scrutin.
- Une nouvelle méta est choisie chaque semaine. Les territoires précédents restent ouverts, y compris aux nouvelles créations.
- Chaque territoire possède un memecoin distinct, achetable sur les marchés qui disposent de sa liquidité. L’achat avec le token mère n’est pas imposé.
- Les projets locaux sont créés et échangés contre le token de leur territoire.
- Le token officiel local participe à la carte. La surface est la capitalisation divisée par le total valorisable du territoire, pas par celui de tous les mondes.
- Wallet conserve la vue des avoirs directs du propriétaire, tous territoires confondus.

## Configuration et invariants

`config/platform.json` conserve l’adresse du token mère dans `paymentMint`. Ce champ ne doit pas être utilisé pour faire tourner les tokens hebdomadaires.

`config/worlds.json` constitue le catalogue versionné. Le monde d’origine garde son mint existant ; GTA 6 reste en attente tant que son mint et sa politique économique n’ont pas été validés. Chaque nouveau monde utilise un identifiant et un mint uniques. Ne jamais changer le mint d’un monde déjà ouvert ni réutiliser son identifiant.

Les seuils de courbe s’expriment en unités du token local, pas en dollars. Ils doivent être déterminés pour chaque lancement. L’ouverture d’un nouveau monde ne convertit ni réserves, ni prix, ni monnaie de paiement des anciens marchés.

Le thème GTA 6 est communautaire et n’implique aucune affiliation à Rockstar.

## Activation d’un territoire

1. Clôturer le scrutin et vérifier son résultat ainsi que le manifeste des poids.
2. Créer le memecoin sur une plateforme compatible, avec les signatures du propriétaire. Cette opération reste distincte du vote et engage les frais normaux du réseau/protocole.
3. Ajouter son mint et sa politique de courbe au catalogue. Vérifier réseau, programme SPL, extensions, autorités, liquidité et source de prix.
4. Valider compilation, tests et parcours de création avant de passer le monde à ouvert.
5. Conserver le résultat du scrutin et la référence au mint officiel ; les réessais ne doivent pas produire de deuxième territoire pour la même semaine.

Aucune clé privée n’est conservée par Dominion. Aucun calendrier ne signe automatiquement à la place de Phantom. Un territoire sans mint reste en attente, sans faux cours ni faux achat.

## Gouvernance et limites

Un vote hors chaîne signé n’est pas une transaction Solana et ne lance pas automatiquement un token. Les résultats et manifestes publiés permettent une vérification ; la collecte du snapshot et l’exécution du résultat restent administrées. Ce modèle ne doit pas être présenté comme une exécution entièrement décentralisée.

Le relevé doit provenir d’une seule réponse cohérente à un slot finalisé. Des soldes lus successivement ou `minContextSlot` ne constituent pas un historique au même slot. Un indexeur ou une lecture complète compatible est nécessaire ; une réponse tronquée ou paginée sans cohérence doit interrompre la préparation.

Les détenteurs en wallet sont agrégés par propriétaire. Les réserves des programmes et la trésorerie sont exclues explicitement. Les détenteurs indirects via plateformes dépositaires ne sont pas automatiquement identifiables. Emprunter des tokens avant le snapshot reste possible ; le modèle ne prétend pas empêcher ce comportement.

Aucun scrutin réel ne doit s’ouvrir avec des poids de démonstration. L’absence de snapshot valide doit être visible et empêcher le vote.

## Suivi de réalisation

| Exigence | Critère | État |
|---|---|---|
| R1 Catalogue permanent | Origine ouverte, GTA 6 en attente, identifiants et quotes distincts | Implémenté, tests réussis |
| R2 Marchés isolés | Carte, créations et reçus utilisent le monde correct | Implémenté, tests réussis |
| R3 Interface | Sélection des mondes, gouvernance, Wallet préservé | Implémenté, tests réussis |
| R4 Vote pondéré | Snapshot cohérent, signature, vote unique, poids entiers | Implémenté, tests réussis |
| R5 Exploitation | Préparation des rounds, activation manuelle vérifiée, aucun mint fictif | Implémenté, tests réussis |
| R6 Livraison | Tests, contrôle indépendant, déploiement normal et lecture publique | Tests locaux réussis ; publication à vérifier |

## Validation de cette livraison

133 tests unitaires et intégration passent ; compilation production réussie. Trois parcours navigateur passent : launchpad existant, Wallet, mondes et gouvernance (consentement, message lié au scrutin/domaine/mint, domaine tiers refusé, course de changement de monde, mobile 320 px). Les migrations ont été vérifiées sur SQLite réel avec données historiques et contraintes d’unicité, puis appliquées dans D1 sans suppression de données.

Une revue indépendante a conduit à ajouter la résolution des prix des tokens locaux issus de courbes DBC, ainsi que le registre immuable des scrutins en D1 et des lectures groupées. Aucun scrutin réel, mint GTA 6 ni transaction mainnet signée n’a été créé pendant cette validation. Le fonctionnement opérateur des snapshots est documenté dans [GOVERNANCE.md](GOVERNANCE.md).
