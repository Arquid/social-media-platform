import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Sentry is loaded only when error reporting is on. Without this the dev server finds it late,
  // optimizes it while the page is open and reloads the page once.
  optimizeDeps: { include: ['@sentry/react'] },
  build: {
    rolldownOptions: {
      output: {
        // Put big libraries in their own files. They change rarely, so browsers can keep
        // them cached when only the app code changes.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/ },
            { name: 'mui', test: /node_modules[\\/](@mui|@emotion)[\\/]/ },
            { name: 'supabase', test: /node_modules[\\/]@supabase[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}', 'scripts/**/*.test.js'],
    css: false,
    // Run with: npm run test:coverage
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      exclude: [
        'src/**/*.test.{js,jsx}',
        'src/test/**',
        // Only start-up code: creating the Supabase client and mounting the app
        'src/main.jsx',
        'src/lib/supabaseClient.js',
      ],
      reporter: ['text', 'html'],
      all: true,
      // The run fails if the tests cover less than this. Measured: 98.6 / 92.9 / 99.0 / 99.8 %,
      // so there is room for a little untested code, but not for a whole new feature without tests.
      thresholds: { statements: 95, branches: 88, functions: 95, lines: 95 },
    },
  },
})