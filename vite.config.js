import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The packaged app loads only its own bundle: no inline or remote scripts, no
// plugins/frames/forms, images and API calls over https only. (index.html keeps a
// looser policy for the dev server, whose React-refresh preamble is an inline script.)
const PROD_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join('; ');

const strictCsp = () => ({
  name: 'strict-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace(
    /<meta http-equiv="Content-Security-Policy"[^>]*>/,
    `<meta http-equiv="Content-Security-Policy" content="${PROD_CSP}" />`,
  ),
});

export default defineConfig({
  base: './',
  plugins: [react(), strictCsp()],
  resolve: {
    preserveSymlinks: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      strict: false,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
