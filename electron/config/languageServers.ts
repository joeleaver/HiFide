import type { SupportedLspLanguage } from '../../shared/lsp.js'

export type LanguageProvisioning =
  | { type: 'builtin' }
  | { type: 'npm-npx'; bin: string; args?: string[] }

export interface LanguageServerDefinition {
  key: string
  displayName: string
  languages: SupportedLspLanguage[]
  masonPackage: string
  provisioning: LanguageProvisioning
  initializationOptions?: any
}

export const LANGUAGE_SERVER_DEFINITIONS: LanguageServerDefinition[] = [
  {
    key: 'tsserver',
    displayName: 'TypeScript / JavaScript',
    languages: ['typescript', 'javascript', 'typescriptreact', 'javascriptreact', 'json'],
    masonPackage: 'typescript-language-server',
    provisioning: { type: 'builtin' },
  },
  {
    key: 'pyright',
    displayName: 'Python',
    languages: ['python'],
    masonPackage: 'pyright',
    provisioning: { type: 'npm-npx', bin: 'pyright-langserver', args: ['--stdio'] },
  },
  {
    key: 'yamlls',
    displayName: 'YAML',
    languages: ['yaml'],
    masonPackage: 'yaml-language-server',
    provisioning: { type: 'npm-npx', bin: 'yaml-language-server', args: ['--stdio'] },
  },
]
