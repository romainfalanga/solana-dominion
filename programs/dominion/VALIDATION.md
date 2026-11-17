# Vérification du programme — 17 novembre 2026

- Rust hôte 1.100.0 : `cargo test -p dominion` ; 6 tests réussis, zéro échec.
- Anchor lang/spl 0.31.1, dépendances verrouillées par Cargo.lock.
- Agave build 4.4.1, platform-tools 1.57 : `cargo-build-sbf --arch v0 --manifest-path programs/dominion/Cargo.toml` ; compilation réussie, aucune erreur de stack, 13 avertissements provenant des macros Anchor (cfg et realloc déprécié).
- SHA-256 du binaire vérifié : `c0cc2ee0169dbb395e842ee58197c4a31a8f27238d0b1f6aec51acf4847455bb`.
- Agave validator 2.3.13, programme chargé depuis ce binaire à l'adresse de développement déclarée.
- `LOCAL_RPC_URL=http://127.0.0.1:18899 node scripts/test-localnet.mjs` : terminé avec code 0.

Les neuf vérifications de scénario local ont réussi : refus du quote gelable, refus de réinitialisation config, supply fixe et autorités révoquées, rollback sur slippage, rollback sur expiration, rejet de substitution de coffre, conservation lors achat/vente, absence de profit d'arrondi aller-retour et rollback atomique d'une création insuffisamment approvisionnée.

Le validateur 4.4.1 n'a pas démarré dans ce conteneur (io_uring indisponible), d'où l'usage du validateur 2.3.13 et SBF v0. Ce résultat valide le scénario local exécuté, pas un audit de sécurité exhaustif ni un déploiement devnet/mainnet. Aucune transaction sur réseau public n'a été effectuée pour ces tests. Les clés de tests sont éphémères.
