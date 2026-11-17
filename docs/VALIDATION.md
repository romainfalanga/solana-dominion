# Validation DBC — 17 novembre 2026

## Programme réel, sans fonds publics dépensés

`scripts/test-dbc-local.mjs` utilise les mêmes builders TypeScript que Phantom. Un validateur local exécute les binaires mainnet lus depuis les comptes programme DBC, Metaplex et DAMMv2. Tous les wallets et fonds du test sont locaux et éphémères.

Scénarios exécutés avec succès : configuration partagée, quote Token-2022 avec métadonnées, achat initial, allocation inférieure à la supply totale, autorités révoquées, paiement réel dans le pool, achat suivant, vente, rollback du pool et du mint si solde insuffisant. Les transactions finalisées et comptes publics sont enregistrés dans `tests/fixtures/dbc-launch.json`, sans clés privées.

Résultat de la politique par défaut : 1 000 unités quote achètent 90 163 113,142667 tokens, soit 9,0163113143 % de la supply. C’est un résultat de test de cette courbe, pas un rendement ou une garantie de prix. Paquets : configuration avec mémo 868 octets ; pool et achat 1 004 octets, sous la limite Solana 1 232.

Avec `--migration` : achat partiel atteignant le seuil, migration permissionless effective, compte pool DAMMv2 vérifié et deuxième migration refusée. Paquet 1 139 octets. Le validateur local finance aussi l’autorité publique du protocole, dont le solde mainnet a été constaté à 68,824494740 SOL lors de la vérification ; ce financement local reproduit le compte protocolaire existant, pas une réserve demandée à l’opérateur Dominion.

## Simulation mainnet

`scripts/simulate-dbc-mainnet.mjs` simule configuration + pool + achat de **1 CHOULE** contre le programme mainnet : `simulationError:null`, 192 320 unités de calcul, paquet 1 205 octets. La simulation utilise des métadonnées raccourcies ; le parcours utilisateur conserve deux transactions initiales pour ses métadonnées et son mémo complet. Aucun broadcast, aucune clé privée du propriétaire, aucune dépense réelle. `sigVerify:false` vérifie l’exécution, pas l’autorisation Phantom.

## Application

89 tests automatisés réussis : calcul économique, règles de compte, configurations, transactions incertaines, reçus expirés, preuves de lancement, politique historique, valorisation, token plateforme, rotation et conditions de migration. Les tests du registre utilisent les fixtures réelles et SQLite avec les migrations D1.

Tests UI avec lectures simulées : carte prioritaire, logo, CA copiable, absence des barres et de la page classement retirées, règles sans statistiques, devis d’achat initial, rejet des réponses périmées, minimum reçu inchangé pour achat/vente, quotes historiques, bouton migration, mobile 390/320 pixels sans débordement.

## Limites de ces preuves

Aucune création réelle signée par le propriétaire n’a été effectuée. Aucun audit externe n’est revendiqué. La disponibilité RPC/DexScreener et l’indexation du marché migré restent externes. Après migration, l’application dirige vers un marché externe ; elle ne construit pas les swaps DAMMv2 elle-même.

## Interface de production

Le bundle réel a passé le test Playwright avec le SDK DBC réel et un RPC de lecture sur fixture : estimation de 1 000 unités de quote, part de supply, deux signatures initiales, blocage sans Phantom, carte immédiate, logo, règles sans statistiques, absence de page classement et de sous-barre, écrans 390 et 320 px sans débordement. Aucun envoi de transaction. Le Worker compilé a également répondu HTTP 200 dans Miniflare avec D1 éphémère.

## Token de paiement Pump avant graduation

Le mint CHOULE est encore sur une courbe Pump et DexScreener ne fournit pas de paire pour ce mint. Le serveur vérifie le PDA, le programme propriétaire, le discriminateur, le layout, la quote SOL, les réserves et l’absence de graduation, puis convertit le prix virtuel via une paire WSOL/USDC liquide. Fixture mainnet publique conservée, sans clé privée. La capitalisation utilise l’offre actuelle du mint ; elle est notionnelle et ne mesure pas la liquidité disponible. Sans cours SOL/USD vérifiable, aucun prix USD n’est inventé.

## Limitation du RPC public

Le contrôle en production a identifié des réponses HTTP 429 à getMultipleAccounts sur Publicnode. Le serveur bascule ces lectures vers le RPC officiel mainnet, vérifie son genesis et conserve les paramètres de finalité/minContextSlot. Le délai Retry-After est respecté par fournisseur et méthode ; les endpoints privés et personnalisés ne sont pas redirigés. Les méthodes d’envoi de transaction sont refusées par ce lecteur serveur.

Pour les petits lots de 1 à 3 comptes limités sur getMultipleAccounts, le lecteur utilise getAccountInfo avec deux lectures simultanées maximum. Les valeurs nulles, l’ordre, les options et les slots réels sont conservés ; un contexte antérieur au minimum demandé est refusé.
