import { Group, Tooltip, Text, Loader } from '@mantine/core'
import { IconCheck, IconAlertCircle, IconX, IconCode } from '@tabler/icons-react'
import { useLanguageSupportStore } from '@/store/languageSupport'
import { useEditorStore } from '@/store/editor'

/**
 * Language Server Protocol (LSP) Status Indicator
 * Shows the status of the TypeScript/JavaScript language server
 * Only displayed in the explorer view
 */
export function LspStatusIndicator() {
  const languages = useLanguageSupportStore((state) => state.languages)
  const activeTab = useEditorStore((state) => {
    const activeId = state.activeTabId
    return state.tabs.find((tab) => tab.id === activeId) || null
  })

  // Only show for TypeScript/JavaScript files
  if (!activeTab) return null

  const isTypeScriptFile = activeTab.path?.toLowerCase().match(/\.(ts|tsx|js|jsx)$/)
  if (!isTypeScriptFile) return null

  // Get TypeScript language server status
  const tsStatus = languages['typescript'] || languages['javascript']
  if (!tsStatus) return null

  const { status, lastError } = tsStatus

  // Determine icon and color based on status
  let icon = null
  let color = '#fff'
  let label = ''

  switch (status) {
    case 'ready':
      icon = <IconCheck size={12} color="#4ade80" />
      label = 'Language Server Ready'
      break
    case 'pending':
    case 'installing':
      icon = <Loader size={10} color="#60a5fa" />
      label = status === 'installing' ? 'Installing Language Server...' : 'Initializing Language Server...'
      break
    case 'error':
      icon = <IconAlertCircle size={12} color="#ff6b6b" />
      label = lastError ? `Language Server Error: ${lastError}` : 'Language Server Error'
      break
    case 'disabled':
      icon = <IconX size={12} color="#a0aec0" />
      label = 'Language Server Disabled'
      break
    default:
      icon = <IconCode size={12} color="#a0aec0" />
      label = 'Language Server'
  }

  return (
    <Tooltip label={label} position="top">
      <Group gap={4} px={4} style={{ cursor: 'default', display: 'flex', alignItems: 'center' }}>
        {icon}
        <Text size="xs" fw={500} style={{ color }}>
          LSP
        </Text>
      </Group>
    </Tooltip>
  )
}

