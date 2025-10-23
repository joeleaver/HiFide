/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/electron', '<rootDir>/src'],
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.spec.ts'
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        target: 'ES2020',
        module: 'commonjs',
        esModuleInterop: true,
        skipLibCheck: true,
        strict: false,
        resolveJsonModule: true,
        isolatedModules: true
      }
    }]
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^electron$': '<rootDir>/electron/__mocks__/electron.ts',
    '^electron-store$': '<rootDir>/electron/__mocks__/electron-store.ts',
    // Map relative import from refactors/ts.ts and tools/utils.ts to a lightweight mock
    '^\.\./store/index\.js$': '<rootDir>/electron/__mocks__/store-index.js',
    '^\.\./store/index$': '<rootDir>/electron/__mocks__/store-index.js'
  },
  setupFilesAfterEnv: ['<rootDir>/electron/__tests__/setup.ts'],
  collectCoverageFrom: [
    'electron/**/*.ts',
    'src/**/*.ts',
    '!**/__tests__/**',
    '!**/__mocks__/**',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/dist-electron/**'
  ],
  testTimeout: 30000 // 30 seconds for API calls
}

