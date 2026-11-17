# Sécurité et limites

Cette livraison est une démonstration et une base devnet. Le programme n’a pas reçu d’audit externe. Les tests locaux réussis ne prouvent ni l’absence de failles ni la résistance économique d’une compétition réelle.

## Revue des dépendances — 17 novembre 2026

`npm audit --omit=dev` : 9 entrées transitives, dont 3 élevées et 6 modérées. Elles ne sont pas masquées par une rétrogradation ni par des overrides majeurs non vérifiés.

- **bigint-buffer** (GHSA-3gc7-fjrx-p6mg) : le navigateur embarque la conversion JavaScript, sans chargeur natif. Le Worker contient le chargeur et son fallback JS, mais aucun addon `.node` n’est livré ni exécutable dans Workers ; le débordement C identifié ne s’applique pas à cet artefact. En revanche Node local dispose effectivement du module natif. Les appels SPL actuels utilisent des champs u64 de 8 octets ; aucune garantie n’est donnée pour d’autres usages ou futurs scripts.
- **stream-json** : absent des bundles examinés. Le chemin web3 utilisé est `jayson/lib/client/browser`, fondé sur `JSON.parse`, pas les filtres stream-json concernés.
- **uuid** : le chemin jayson utilise `v4()` sans buffer utilisateur. Les avis concernent les variantes v3/v5/v6 avec buffer fourni ; aucun tel appel n’a été trouvé dans les chemins examinés.

Preuves : bundles issus de `.cloudflare/output/v1/`, sources installées de bigint-buffer, web3 et jayson. Cette analyse de portée n’est pas un correctif des dépendances. Avant mainnet, migrer vers une chaîne SDK maintenue sans ces alertes puis refaire les tests complets des transactions et du runtime. Ne pas appliquer automatiquement le downgrade SPL proposé par npm audit.

## Limites fonctionnelles et économiques

Le prix spot d’un pool très peu liquide permet une capitalisation apparente très élevée ; voir docs/PLAN.md. Aucune résistance au wash trading, aucun oracle/TWAP ni classement anti-manipulation ne sont revendiqués. Les réserves initiales ne sont pas récupérables par une fonction de retrait LP. La supply hors vault est une approximation de la circulation.

## Clés et transactions

Aucun secret utilisateur n’est stocké par le serveur. Les signatures passent par Phantom. Les clés éphémères de mint servent uniquement à créer un compte et ne possèdent plus l’autorité mint après la création. Les clés de programme/upgrade ne doivent jamais être committées. Le verrou UI TRADING_ENABLED n’est pas une pause on-chain.

En cas de confirmation incertaine, vérifier la signature retournée sur Explorer avant toute nouvelle tentative. Ne jamais demander à un utilisateur sa phrase de récupération.

## Mise à jour de l’outillage

Vitest a été migré vers 5.1.0 après détection des alertes critiques tinypool et de l’ancienne chaîne mocker. Les 22 tests et le build passent. L’audit complet après migration signale désormais 0 critical, 3 high et 6 moderate, correspondant aux dépendances Solana déjà analysées ci-dessus.
