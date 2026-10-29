import { defineConfig } from 'vite';

export default defineConfig({
    base: './',
    build: {
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('phaser')) return 'phaser';
                }
            }
        },
    },
    server: {
        port: 8080
    }
});
