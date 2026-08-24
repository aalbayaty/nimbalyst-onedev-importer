import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: { entry: './src/backend.ts', formats: ['es'], fileName: () => 'backend.js' },
    outDir: 'dist',
    emptyOutDir: false,
    target: 'node18',
    minify: false,
    sourcemap: true,
    rollupOptions: { external: [/^node:/] },
  },
});
