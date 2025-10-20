module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    // Guardrails: forbid deprecated window.llm namespace in renderer
    'no-restricted-properties': [
      'error',
      {
        object: 'window',
        property: 'llm',
        message: 'window.llm is removed. Use zubridge store actions and flowExec events instead.'
      }
    ]
  },
}
