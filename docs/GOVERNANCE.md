# Gouvernance hebdomadaire V1

Le token mère actif vient uniquement de `config/platform.json` (`paymentMint`). Aucun scrutin ni poids n'est inventé : le catalogue initial est vide. Un remplacement du mint mère concerne les prochains snapshots ; les anciens rounds conservent mint, réseau, domaine, règles et poids historiques.

## Préparer réellement un scrutin

1. Appliquer `migrations/0003_governance.sql` à la même base D1 que le registre. Vérifier le domaine HTTPS de `config/governance.json`, le réseau, et les candidats choisis publiquement. Le calendrier est lundi 00:00 UTC → lundi suivant 00:00 UTC, sans fermeture anticipée.
2. Créer un fichier opérateur JSON (hors données privées) :
   ```json
   {"id":"2026-w49","themeLabel":"Thème de la semaine","opensAt":"2026-11-30T00:00:00.000Z","quorumBps":2000,"candidates":[{"id":"gta6","label":"GTA6"},{"id":"space","label":"Espace"}],"excludedOwners":[]}
   ```
   Les valeurs économiques et le quorum sont des choix publics à approuver ; cet exemple ne les active pas. Les propositions des utilisateurs sont des suggestions pour un prochain scrutin. L'opérateur prépare et fige la liste avant ouverture : elles ne s'ajoutent jamais au vote en cours.
3. Définir `SOLANA_RPC_URL` dans l'environnement local (ne pas publier d'identifiants). Depuis le dépôt :
   ```sh
   node scripts/prepare-governance-round.mjs work/round-template.json work/round-reviewed.json
   ```
   Le fournisseur doit autoriser `getProgramAccounts` complet, `withContext`, `getBlockTime` et les lectures ordinaires. Le collecteur vérifie le genesis, le mint à offre fixe sans gel, le programme SPL/Token2022 et les extensions compatibles. Une seule réponse GPA finalisée contient tous les comptes du mint : pas de pagination ni calcul par soldes actuels lors du vote. Un compte malformé ou une réponse incomplète provoque l'arrêt ; la somme de tous les comptes doit égaler l'offre lue (un burn concurrent impose de refaire la capture). Le slot, son blockTime et collectedAt précèdent l'ouverture. Le fichier de sortie n'est jamais écrasé.
4. Vérifier indépendamment slot, poids, total, exclusions et candidats. La trésorerie, les propriétaires PDA/non-oncurve, les comptes gelés et les propriétaires explicitement exclus n'obtiennent pas de poids. Les comptes SPL initialisés détenus par le même propriétaire sont agrégés exactement, y compris hors ATA. Aucun droit LP/dépositaire n'est reconstruit : une réserve détenue par une adresse oncurve doit être exclue explicitement. La propriété des tokens, pas le délégué de transfert, donne le vote. Les comptes Token2022 à extensions de compte autres qu'ImmutableOwner sont refusés conservativement.
5. Ajouter l'objet généré, intact, à `config/governance.json.rounds`, dans l'ordre chronologique. Exécuter `npx vitest run tests/governance.test.ts` puis les vérifications habituelles ; faire relire le diff et publier avant l'ouverture. Ne jamais modifier un round publié, même s'il n'a encore aucun bulletin. Une correction implique un nouvel identifiant et une communication explicite, jamais la réécriture d'un résultat.

## Vote et audit

`GET /api/governance` expose règles, empreintes, totaux BigInt en chaînes et état. `GET /api/governance/audit?roundId=ID` expose le snapshot, règles, bulletins et propositions signés pour recalcul indépendant. Les messages JSON canoniques sont produits par `src/governanceTypes.ts`, encodés UTF-8, signés avec Phantom `signMessage`, puis transmis en base58. Signature liée à domaine, réseau, mint, action, identifiant, empreintes, propriétaire, choix et fenêtre. Pas de transaction, frais SOL ni transfert pour voter.

Les poids proviennent exclusivement du snapshot ; un transfert ultérieur ne les transfère pas. D1 impose une seule voix immuable et une suggestion par propriétaire/round, avec réessai idempotent. Un choix contradictoire est rejeté. Quorum : poids exprimé / poids éligible ; égalité ou quorum manquant signifie aucun gagnant. Le classement avant fermeture n'est pas un résultat final. La clôture ne crée ni ne finance de token : une opération distincte signée et financée doit enregistrer le futur monde.

Le collecteur RPC et l'intégrité du déploiement/D1 demeurent des hypothèses de confiance : le manifeste signé par hash n'est pas une preuve cryptographique de l'état Solana. Les signatures des bulletins sont vérifiées à l'entrée ; les totaux lisent ensuite D1 comme stockage de confiance. Le téléchargement d'audit permet de revérifier chaque signature et de repérer des altérations. Pas de promesse anti-emprunt avant snapshot ni d'identité unique par personne.

## Bornes et évolution

V1 : 52 rounds maximum, 25 000 lignes de poids cumulées, configuration JSON de 2 Mo maximum, 20 candidats/round. Le collecteur valide ces limites sur la configuration finale et refuse tout dépassement sans troncature. Le flux public résume les 500 premières suggestions de chaque round ; l'audit contient toutes les suggestions. Avant dépassement, migrer les snapshots/archives vers des objets immuables R2 adressés par hash, garder les engagements minimaux dans le déploiement, et paginer les audits. Ne pas supprimer silencieusement l'historique pour contourner les limites.
