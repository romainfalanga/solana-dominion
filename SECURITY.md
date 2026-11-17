# Sécurité et limites

L’application utilise Meteora DBC, DAMMv2, Metaplex et les programmes SPL existants. Aucun audit externe de l’application n’est revendiqué. Les tests et simulations ne prouvent pas l’absence de failles ni la sécurité future des programmes externes.

## Contrôle des transactions

Phantom est le seul signataire du wallet. Le message signé est comparé au message préparé. Le minimum reçu affiché est transmis à la transaction, sans remplacement par un nouveau devis implicite. Les clés éphémères de création ne sont pas conservées sur le serveur.

Le registre n’accepte que les transactions finalisées dont les comptes, programmes, politiques, autorités et soldes sont vérifiés. Configuration partagée et lancement sont deux étapes distinctes ; leurs reçus sont conservés avant diffusion. Une transaction échouée peut néanmoins consommer des frais réseau. Les comptes de configuration créés sont durables même si le créateur annule ensuite le lancement.

Les fonds de marché sont détenus par les programmes Solana, pas par D1. Les LP de migration sont verrouillées ; la trésorerie partenaire reçoit des frais selon la configuration. La rotation de quote ne modifie pas les réserves ou politiques des anciens marchés.

## Dépendances, 17 novembre 2026

Après ajout du SDK Meteora 2.0.0, `npm audit --omit=dev` signale 13 entrées transitives : 6 élevées, 7 modérées, aucune critique. Les entrées parents peuvent répéter une même vulnérabilité sous-jacente. Aucun downgrade majeur non vérifié n’a été appliqué.

- `bigint-buffer` : avis de débordement du module natif C. Les bundles navigateur et Workers utilisent JavaScript sans addon natif livré. Node local peut charger l’addon ; les scripts limitent leurs entrées et les champs SPL lus sont bornés.
- `toml` via Anchor : avis de pollution de prototype et déni de service du parseur. L’application n’accepte ni ne parse de TOML utilisateur ; la configuration publique est du JSON. Cette limitation d’exposition ne corrige pas la dépendance.
- Les autres avis transitifs (notamment chaîne web3) doivent être réévalués lors des mises à jour. Les SDK sont verrouillés par package-lock ; ne pas remplacer leurs versions sans rejouer les transactions et le Worker.

## Prix et limites opérationnelles

La carte utilise des prix spot et l’offre totale non brûlée, pas une supply circulante auditée. Les marchés peu liquides peuvent être manipulés. La quote n’est ni une parité garantie ni une réserve assurée. Le token plateforme participe au même dénominateur.

Les RPC et DexScreener sont externes. Les lectures sont finalisées mais les lots peuvent venir de slots successifs. Les prix externes et les comptes ne constituent pas un snapshot atomique commun. Une absence de cotation conduit à zéro surface. Le registre est limité à 1 000 lancements dans cette version et refuse un résultat tronqué.
