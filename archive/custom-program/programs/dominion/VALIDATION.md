# Vérification du programme — 17 novembre 2026

- Rust hôte 1.100.0 : `cargo test -p dominion` ; 6 tests réussis, zéro échec.
- Anchor lang/spl 0.31.1, dépendances verrouillées par Cargo.lock.
- Agave build 4.4.1, platform-tools 1.57 : `cargo-build-sbf --arch v0 --manifest-path programs/dominion/Cargo.toml` ; compilation réussie, aucune erreur de stack, 13 avertissements provenant des macros Anchor (cfg et realloc déprécié).
- SHA-256 du binaire vérifié : `21aae97959ec573189dd3a231905b237ee45bdee5a7e3932df42b83106d97c15`.
- Agave validator 2.3.13, programme chargé depuis ce binaire à l'adresse de développement déclarée.
- `LOCAL_RPC_URL=http://127.0.0.1:18899 node scripts/test-localnet.mjs` : terminé avec code 0.

Les neuf vérifications de scénario local ont réussi : refus du quote gelable, refus de réinitialisation config, supply fixe et autorités révoquées, rollback sur slippage, rollback sur expiration, rejet de substitution de coffre, conservation lors achat/vente, absence de profit d'arrondi aller-retour et rollback atomique d'une création insuffisamment approvisionnée.

Le validateur 4.4.1 n'a pas démarré dans ce conteneur (io_uring indisponible), d'où l'usage du validateur 2.3.13 et SBF v0. Ce résultat valide le scénario local exécuté, pas un audit de sécurité exhaustif ni un déploiement devnet/mainnet. Aucune transaction sur réseau public n'a été effectuée pour ces tests. Les clés de tests sont éphémères.

## Migration quote Token-2022 (même date)

Le programme a été recompilé en SBF v0 (352088 octets) après ajout des InterfaceAccount pour quote. Les 6 tests Rust et les 9 scénarios SPL classiques passent à nouveau. Quatre contrôles supplémentaires passent sur le véritable validateur : quote MetadataPointer+TokenMetadata accepté avec création config+pool atomique ; mauvais programme quote rejeté ; achat/vente Token-2022 avec conservation ; quote TransferFeeConfig refusé on-chain.

La transaction atomique config+pool Token-2022 consomme 111392 compute units dans ce scénario, sous le budget client de 400000. Le mint quote est relu et ses extensions revalidées lors de chaque swap. Cette couverture ciblée n'est toujours pas un audit indépendant. Aucun déploiement ni transaction publique effectué.

Estimation rent lue sur `https://api.mainnet-beta.solana.com` via `getMinimumBalanceForRentExemption` : ProgramData de 352133 octets = 1789485880 lamports ; Program 36 octets = 833120 lamports ; total final exact-length 1.790319 SOL. Buffer de 352125 octets = 1789445240 lamports temporairement provisionnés ; frais de transactions/priorité exclus. Recalculer après toute recompilation ou changement des paramètres de déploiement.
