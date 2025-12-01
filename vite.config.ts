import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    port: 5179,
    strictPort: true, // Fail if port is busy instead of auto-incrementing to ensure consistent localStorage origin
  },
  plugins: [
    react(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
        onstart({ startup }) {
          // Auto-start Electron in dev
          startup()
        },
        vite: {
          build: {
            lib: {
              entry: 'electron/main.ts',
              formats: ['es'],
              fileName: () => 'main.mjs',
            },
            rollupOptions: {
              external: (id) => {
                // Don't externalize electron built-ins
                if (id === 'electron' || id.startsWith('electron/')) return false

                // Don't externalize our own source files (they have absolute paths or start with .)
                if (id.startsWith('.') || id.startsWith('/') || /^[A-Z]:/i.test(id)) return false

                // Externalize all node_modules
                return true
              },
              output: {
                format: 'es',
                entryFileNames: 'main.mjs',
                chunkFileNames: 'main-[hash].mjs',
                banner: 'import { fileURLToPath as __fut } from "node:url"; import * as __path from "node:path"; var __filename = __fut(import.meta.url); var __dirname = __path.dirname(__filename);',
              },
            },
          },
        },
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          build: {
            rollupOptions: {
              output: {
                // Modern Electron (v28+) supports ESM preload scripts
                format: 'es',
                entryFileNames: 'preload.mjs',
              },
            },
          },
        },
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: process.env.NODE_ENV === 'test'
        // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        ? undefined
        : {},
    }),
    // Copy profiles directory to dist during build
    {
      name: 'copy-profiles',
      closeBundle() {
        const srcDir = path.join(__dirname, 'src', 'profiles')
        const destDir = path.join(__dirname, 'dist', 'profiles')

        try {
          mkdirSync(destDir, { recursive: true })
          const files = readdirSync(srcDir)

          for (const file of files) {
            if (file.endsWith('.json')) {
              copyFileSync(
                path.join(srcDir, file),
                path.join(destDir, file)
              )
              console.log(`Copied profile: ${file}`)
            }
          }
        } catch (error) {
          console.error('Failed to copy profiles:', error)
        }
      }
    }
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  build: {
    rollupOptions: {
      external: [
        // Externalize electron modules that are dynamically imported in store slices
        /^\.\.\/\.\.\/electron\//,
      ],
    },
  },
  publicDir: 'public',
})
