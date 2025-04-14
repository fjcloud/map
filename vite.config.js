import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
    // Replace '/map/' with '/your-repo-name/' if your repo is named differently
    base: '/map/', // Base path for GitHub Pages
    root: 'src',   // Source files are now in 'src'
    build: {
        outDir: '../docs', // Output build files to the top-level 'docs' folder
        emptyOutDir: true, // Clean the 'docs' folder before building
    },
}); 