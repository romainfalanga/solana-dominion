# Solana Dominion

Launchpad Solana et jeu de territoires. La carte partage exactement son rectangle entre les capitalisations en circulation des tokens du même monde.

**État : application de démonstration + programme Solana compilable et testé localement. Pas de lancement mainnet.** Les signatures Phantom exigent un programme réellement déployé, un mint de paiement configuré et des fonds devnet. Le mode demo ne crée aucun actif réel.

## Démarrer

Node.js 24 recommandé, minimum 22.18 pour Cloudflare CLI.

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

`npm run dev` ouvre une simulation locale. Pour tester le mode chaîne côté navigateur : configurer Cloudflare puis `npm run build && npm run preview` (le build utilise l’API réelle). Les actifs de production et le bundle Worker sont dans `.cloudflare/output/v1/`.

## Documentation

- [Plan, choix et limites économiques](docs/PLAN.md)
- [Mise en service et configuration](docs/MISE-EN-SERVICE.md)
- [Programme Solana et ABI](programs/dominion/README.md)
- [API et cohérence des snapshots](server/README.md)
- [État de validation](docs/VALIDATION.md)

## Organisation

`src/` interface, wallet, maths et carte ; `server/` API Cloudflare ; `programs/dominion/` programme Anchor ; `scripts/test-localnet.mjs` transactions adversariales sur validator ; `tests/` tests TypeScript.

Le token de paiement est public et configurable dans `cloudflare.config.ts`. Ne jamais y ajouter une phrase de récupération, clé de wallet ou URL RPC privée avec identifiant. Utiliser un secret Cloudflare pour `SOLANA_RPC_URL`.

## Vérifier Solana

```sh
cargo test --workspace --locked
cargo build-sbf --arch v0 --manifest-path programs/dominion/Cargo.toml
# Voir scripts/test-localnet.mjs pour démarrer le validator avec le programme.
npm run test:localnet
```

La réserve de lancement reste dans le marché. La capitalisation au prix marginal est manipulable en faible liquidité : cette version n’est pas une compétition financière mainnet prête à ouvrir. Voir le plan pour les exigences de durcissement.
