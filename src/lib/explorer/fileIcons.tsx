import type { ComponentType } from 'react'
import type { IconProps } from '@tabler/icons-react'
import {
  IconBrandCss3,
  IconBrandJavascript,
  IconBrandTypescript,
  IconBrandReact,
  IconMarkdown,
  IconBrandHtml5,
  IconFileCode,
  IconFileText,
  IconFileSpreadsheet,
  IconDatabase,
  IconFileZip,
  IconTerminal2,
  IconFileFunction,
} from '@tabler/icons-react'

export interface FileIconDescriptor {
  icon: ComponentType<IconProps>
  color: string
}

const EXTENSION_MAP: Record<string, FileIconDescriptor> = {
  ts: { icon: IconBrandTypescript, color: '#2f74c0' },
  tsx: { icon: IconBrandReact, color: '#5ccfee' },
  js: { icon: IconBrandJavascript, color: '#f7df1e' },
  jsx: { icon: IconBrandReact, color: '#5ccfee' },
  mjs: { icon: IconBrandJavascript, color: '#f7df1e' },
  cjs: { icon: IconBrandJavascript, color: '#f7df1e' },
  json: { icon: IconFileCode, color: '#f19637' },
  md: { icon: IconMarkdown, color: '#3f51b5' },
  mdx: { icon: IconMarkdown, color: '#3f51b5' },
  css: { icon: IconBrandCss3, color: '#2965f1' },
  scss: { icon: IconBrandCss3, color: '#c6538c' },
  sass: { icon: IconBrandCss3, color: '#c6538c' },
  less: { icon: IconBrandCss3, color: '#2b4c7e' },
  html: { icon: IconBrandHtml5, color: '#e34c26' },
  htm: { icon: IconBrandHtml5, color: '#e34c26' },
  svg: { icon: IconBrandHtml5, color: '#f06c00' },
  yml: { icon: IconFileText, color: '#cb8a2a' },
  yaml: { icon: IconFileText, color: '#cb8a2a' },
  env: { icon: IconFileFunction, color: '#2ecc71' },
  envrc: { icon: IconFileFunction, color: '#2ecc71' },
  sh: { icon: IconTerminal2, color: '#27ae60' },
  bash: { icon: IconTerminal2, color: '#27ae60' },
  zsh: { icon: IconTerminal2, color: '#27ae60' },
  py: { icon: IconFileFunction, color: '#3472a6' },
  rb: { icon: IconFileCode, color: '#cc342d' },
  go: { icon: IconFileFunction, color: '#00acd7' },
  rs: { icon: IconFileCode, color: '#dea584' },
  sql: { icon: IconDatabase, color: '#9b59b6' },
  csv: { icon: IconFileSpreadsheet, color: '#27ae60' },
  tsv: { icon: IconFileSpreadsheet, color: '#27ae60' },
  lock: { icon: IconFileText, color: '#bdc3c7' },
  zip: { icon: IconFileZip, color: '#d35400' },
  gz: { icon: IconFileZip, color: '#d35400' },
  tgz: { icon: IconFileZip, color: '#d35400' },
}

const NAME_MAP: Record<string, FileIconDescriptor> = {
  '.env': { icon: IconFileFunction, color: '#2ecc71' },
  '.env.local': { icon: IconFileFunction, color: '#27ae60' },
  '.gitignore': { icon: IconFileText, color: '#bdc3c7' },
  dockerfile: { icon: IconFileCode, color: '#1d63ed' },
}

const DEFAULT_ICON: FileIconDescriptor = { icon: IconFileCode, color: '#8e9aac' }

export function getFileIconDescriptor(name: string): FileIconDescriptor {
  const normalized = name.toLowerCase()
  if (NAME_MAP[normalized]) {
    return NAME_MAP[normalized]
  }
  const lastDot = normalized.lastIndexOf('.')
  if (lastDot !== -1) {
    const ext = normalized.slice(lastDot + 1)
    if (EXTENSION_MAP[ext]) {
      return EXTENSION_MAP[ext]
    }
  }
  return DEFAULT_ICON
}
