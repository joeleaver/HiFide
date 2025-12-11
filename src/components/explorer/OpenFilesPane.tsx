import { memo } from 'react'
import { ScrollArea, Stack, Text, UnstyledButton, ActionIcon } from '@mantine/core'
import { IconFile, IconX } from '@tabler/icons-react'

import { useEditorStore } from '@/store/editor'

interface OpenFilesSummary {
  id: string
  name: string
  path: string
  isDirty: boolean
  isPreview: boolean
  isUntitled: boolean
}

const OpenFilesPane = memo(function OpenFilesPane() {
  const openFiles = useEditorStore<OpenFilesSummary[]>((state) =>
    state.tabs.map((tab) => ({
      id: tab.id,
      name: tab.name,
      path: tab.path,
      isDirty: tab.isDirty,
      isPreview: tab.isPreview,
      isUntitled: tab.isUntitled,
    }))
  )
  const activeTabId = useEditorStore((state) => state.activeTabId)
  const setActiveTab = useEditorStore((state) => state.setActiveTab)
  const closeTab = useEditorStore((state) => state.closeTab)

  if (!openFiles.length) {
    return (
      <div className="open-files-empty">
        <Text size="xs" c="dimmed">
          No open files
        </Text>
      </div>
    )
  }

  return (
    <ScrollArea className="open-files-scroll">
      <Stack gap={0} p="xs">
        {openFiles.map((tab) => {
          const isActive = tab.id === activeTabId
          const titleText = tab.isUntitled ? 'Unsaved file' : tab.path
          return (
            <UnstyledButton
              key={tab.id}
              className="open-files-row"
              data-active={isActive ? 'true' : undefined}
              title={titleText ?? undefined}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="open-files-row-icon">
                <IconFile size={14} stroke={1.5} />
              </span>
              <Text
                size="sm"
                className="open-files-row-name single-line"
                style={{ fontStyle: tab.isPreview ? 'italic' : 'normal' }}
              >
                {tab.name}
              </Text>
              {tab.isDirty && <span className="open-files-row-dirty">•</span>}
              <ActionIcon
                component="span"
                role="button"
                aria-label={`Close ${tab.name}`}
                tabIndex={-1}
                size="xs"
                variant="subtle"
                color="gray"
                onClick={(event) => {
                  event.stopPropagation()
                  closeTab(tab.id)
                }}
              >
                <IconX size={12} />
              </ActionIcon>
            </UnstyledButton>
          )
        })}
      </Stack>
    </ScrollArea>
  )
})

export default OpenFilesPane
