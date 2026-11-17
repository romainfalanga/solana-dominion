# Programme Dominion

Anchor 0.31.1 ; SPL Token classique ; réserves constant-product réelles ; aucun frais protocole dans cette version. Les tokens créés ont 6 décimales et une émission initiale fixe de 1 milliard. Le programme révoque immédiatement mint authority et n'établit aucune freeze authority.

## Économie

La création transfère le seed quote du créateur au coffre et émet toute la supply dans l'autre coffre. **L'apport initial est permanent : aucune instruction de retrait de liquidité/LP/admin n'existe.** Acheter et vendre sont les seules sorties de réserves. Le premier achat donne une supply circulante positive. La capitalisation circulante vaut `(mint.supply − token_vault.amount) × prix`, et le prix instantané dépend des réserves. Ce prix peut être manipulé dans un marché peu liquide ; ce n'est pas un oracle ni le produit réalisable en vendant toute la supply.

Chaque quote mint constitue un monde indépendant (`config` PDA seeds `["config",quoteMint]`). La configuration est permissionless et immuable ; changer le quote mint du site sélectionne un autre monde et ne migre aucun ancien pool. Un quote mint peut garder une mint authority (utile pour les tests), mais sa freeze authority doit être absente. La confiance dans l'émetteur du quote doit être traitée lors sélection de production.

## ABI

- `initialize_config()` comptes : payer signer writable, quote_mint, config writable, system_program.
- `create_pool(name:string,symbol:string,seed_quote:u64)` comptes : creator signer writable, config, quote_mint, mint signer writable, pool writable, token_vault writable, quote_vault writable, creator_quote writable, token_program, associated_token_program, system_program.
- `buy(amount_in:u64,min_out:u64,deadline:i64)` et `sell` mêmes comptes : trader signer writable, pool, mint, quote_mint, token_vault writable, quote_vault writable, trader_token writable, trader_quote writable, token_program, associated_token_program, system_program.

Deadline est un timestamp Unix en secondes, compris entre l'heure on-chain et +300 secondes. `min_out` doit être strictement positif. Montants en unités atomiques. Sortie arrondie vers zéro et invariant non décroissant.

Pool Borsh : discriminator8, creator32, mint32, quote_mint32, token_vault32, quote_vault32, initial_supply u64, created_at i64, bump u8, name String, symbol String. La longueur maximum de name est 32 octets UTF8 et symbol 10 caractères ASCII alphanumériques. Le champ initial_supply ne remplace pas mint.supply : un détenteur peut brûler ses tokens.

## Validation reproductible

```sh
cargo test --locked -p dominion
cargo build-sbf --arch v0 --manifest-path programs/dominion/Cargo.toml
solana-test-validator --reset --ledger ./target/local-ledger \
  --bpf-program Fg6PaFpoGXkYsidMpWxTWqkZ7FEfcYkgMQHHTPqzW8B ./target/deploy/dominion.so
# Dans un autre terminal :
node scripts/test-localnet.mjs
```

Build vérifié avec Agave 4.4.1 / platform-tools 1.57, architecture SBF v0. Le validateur Agave 2.3.13 est utilisé dans ce conteneur car Agave 4.4.1 exige io_uring indisponible ici.

Le script accepte uniquement localhost, crée un payer éphémère et fait un airdrop local. Il vérifie reinit, autorités, substitution de vault, slippage, deadline, conservation buy/sell et rollback atomique de création. Les tests arithmétiques seuls ne remplacent pas ce parcours.

L'adresse déclarée est un identifiant de développement. Avant déploiement devnet, générer une keypair programme, synchroniser `declare_id!`, Anchor.toml et configuration client, compiler à nouveau, vérifier le binaire puis déployer. Ne jamais committer les keypairs. Aucun déploiement mainnet n'est autorisé par ces scripts. Le programme n'a pas fait l'objet d'un audit indépendant de sécurité.
