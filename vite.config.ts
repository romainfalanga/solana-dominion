import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {cloudflare} from '@cloudflare/vite-plugin';
// Anchor's Node ESM entry uses require/exports; Workers must use its supported browser path.
export default defineConfig({define:{'process.env.ANCHOR_BROWSER':'true'},plugins:[react(),...(process.env.VITEST?[]:[cloudflare()])],build:{target:'es2022'},server:{host:'0.0.0.0'}});
