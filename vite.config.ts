import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {cloudflare} from '@cloudflare/vite-plugin';
export default defineConfig({plugins:[react(),...(process.env.VITEST?[]:[cloudflare()])],build:{target:'es2022'},server:{host:'0.0.0.0'}});
