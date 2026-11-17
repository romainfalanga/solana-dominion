# Validation de la version sans programme personnalisé

La version active utilise les programmes SPL existants. Le code Anchor et ses anciens budgets sont archivés dans `archive/custom-program` et ne sont pas déployés.

## Transactions

Le script `scripts/test-standard-launch.mjs` utilise le même builder TypeScript que le navigateur, sur un validateur Solana local standard. Vérifications : émission fixe au créateur, suppression des autorités, paiement exact Token-2022, mémo signé, limites d’entrée, rollback intégral si paiement insuffisant, taille maximale du paquet inférieure à1232octets. La fixture issue de la transaction locale finalisée est enregistrée dans `tests/fixtures/standard-launch.json`, sans clé privée.

Une simulation a aussi été exécutée contre le RPC mainnet avec le wallet public du propriétaire et le token CHOULE réel. Résultat : `simulationError:null`,93967unités de calcul. **Aucune transaction n’a été envoyée, aucune signature utilisateur n’a été obtenue, aucun fonds n’a été dépensé.** La simulation avec vérification de signatures désactivée teste l’exécution des instructions, pas l’autorisation du wallet.

## Application et registre

Tests de la validation des mints et extensions, des transactions incertaines, du calcul des territoires et du registre de créations. Le vérificateur reçoit uniquement une signature et relit la transaction finalisée ; il ne fait pas confiance à un nom/montant envoyé par le navigateur.

Le navigateur est testé avec l’API de lecture simulée : état vide sans fausses capitalisations, coût exact et frais SOL affichés, blocage sans Phantom, capitalisations USD, liens externes, mobile et absence d’erreurs JavaScript. Aucun test automatisé ne signe avec le wallet réel.

## Limites

Pas de cotation/liquidité automatique. Les tokens non cotés ont zéro surface. Nom/symbole existent dans le mémo/registre, pas dans un compte Metaplex. Les données prix sont celles d’un service externe et peuvent être manipulées sur les marchés peu liquides. Les quotas Cloudflare/RPC s’appliquent. Aucun audit externe n’est revendiqué.
