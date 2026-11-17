# Sécurité et limites

Cette livraison utilise les programmes SPL existants sur mainnet, sans smart contract personnalisé. Aucun audit externe de l’application n’est revendiqué. Les tests locaux et simulations ne prouvent pas l’absence de failles.

## Revue des dépendances — 17 novembre 2026

`npm audit --omit=dev` : 9 entrées transitives, dont 3 élevées et 6 modérées. Elles ne sont pas masquées par une rétrogradation ni par des overrides majeurs non vérifiés.

- **bigint-buffer** (GHSA-3gc7-fjrx-p6mg) : le navigateur embarque la conversion JavaScript, sans chargeur natif. Le Worker contient le chargeur et son fallback JS, mais aucun addon `.node` n’est livré ni exécutable dans Workers ; le débordement C identifié ne s’applique pas à cet artefact. En revanche Node local dispose effectivement du module natif. Les appels SPL actuels utilisent des champs u64 de 8 octets ; aucune garantie n’est donnée pour d’autres usages ou futurs scripts.
- **stream-json** : absent des bundles examinés. Le chemin web3 utilisé est `jayson/lib/client/browser`, fondé sur `JSON.parse`, pas les filtres stream-json concernés.
- **uuid** : le chemin jayson utilise `v4()` sans buffer utilisateur. Les avis concernent les variantes v3/v5/v6 avec buffer fourni ; aucun tel appel n’a été trouvé dans les chemins examinés.

Preuves : bundles issus de `.cloudflare/output/v1/`, sources installées de bigint-buffer, web3 et jayson. Cette analyse de portée n’est pas un correctif des dépendances. Avant mainnet, migrer vers une chaîne SDK maintenue sans ces alertes puis refaire les tests complets des transactions et du runtime. Ne pas appliquer automatiquement le downgrade SPL proposé par npm audit.

## Modèle actuel

Le créateur signe une transaction standard atomique. Aucun serveur ne détient sa clé privée. La base D1 accepte uniquement les créations dont la transaction finalisée est vérifiée, incluant le paiement, le mint, les autorités et le mémo. Les inscriptions sont idempotentes ; un changement de token de paiement conserve l’historique des configurations.

La carte n’invente pas de prix : sans cotation externe le territoire est nul. Le prix d’un marché peu liquide peut être manipulé. Aucun programme de trading ni réserve interne ne sont déployés.

## Confirmation et frais

Une signature est conservée avant diffusion. Si la confirmation est incertaine, actualiser et consulter Explorer plutôt que recréer le token. En cas d’échec on-chain, la création et le paiement applicatif sont annulés ensemble, mais Solana peut conserver les frais réseau. Les clés de mint temporaires ne sont pas des autorités après révocation.

Vitest 5.1.0 remplace l’ancienne version de tests affectée par les alertes tinypool ; les risques transitifs SDK détaillés plus haut restent documentés.
