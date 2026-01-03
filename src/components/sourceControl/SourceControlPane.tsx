import type React from 'react'
import { Box, Group, ScrollArea, Stack, Text, UnstyledButton } from '@mantine/core'

export type SourceControlFileRow = {
  path: string
  label: string
  status?: string
  annotationsCount?: number
}

export type SourceControlFileGroup = {
  id: string
  title: string
  files: SourceControlFileRow[]
}

export type SourceControlPaneProps = {
  files: SourceControlFileRow[]
  groups?: SourceControlFileGroup[]
  activePath: string | null
  onSelectFile: (path: string) => void

  headerLeft?: React.ReactNode

  headerRight?: React.ReactNode

  children?: React.ReactNode
}

export function SourceControlPane(props: SourceControlPaneProps) {
  const groups = props.groups && props.groups.length > 0 ? props.groups : [{ id: 'all', title: 'CHANGES', files: props.files }]

  return (
    <Box style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <Box style={{ width: 280, borderRight: '1px solid #2a2a2a', background: '#1e1e1e', minHeight: 0 }}>
        <Box px="md" py="sm" style={{ borderBottom: '1px solid #333', background: '#252526' }}>
          <Group justify="space-between" wrap="nowrap">
            <Group gap={8} wrap="nowrap">
              <Text size="xs" fw={700} c="dimmed">
                CHANGES
              </Text>
              {props.headerLeft}
            </Group>
            {props.headerRight}
          </Group>
        </Box>
        <ScrollArea style={{ height: '100%' }}>
          <Stack gap={0}>
            {groups.every((g) => g.files.length === 0) ? (
              <Box p="md" style={{ color: '#888' }}>
                <Text size="sm">No changes detected.</Text>
              </Box>
            ) : (
              groups.map((g) => (
                <Box key={g.id}>
                  {groups.length > 1 && (
                    <Box px="md" py={6} style={{ borderBottom: '1px solid #222', background: '#1b1b1b' }}>
                      <Text size="xs" fw={700} c="dimmed">
                        {g.title}
                      </Text>
                    </Box>
                  )}
                  {g.files.map((f) => {
                    const active = props.activePath === f.path
                    return (
                      <UnstyledButton
                        key={f.path}
                        onClick={() => props.onSelectFile(f.path)}
                        style={{
                          padding: '8px 12px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 10,
                          background: active ? '#264f78' : 'transparent',
                          borderBottom: '1px solid #222',
                          width: '100%',
                          textAlign: 'left',
                        }}
                      >
                        <Box style={{ overflow: 'hidden' }}>
                          <Text size="sm" c={active ? 'white' : 'dimmed'} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {f.label}
                          </Text>
                          {f.status && (
                            <Text size="xs" c="dimmed">
                              {f.status}
                            </Text>
                          )}
                        </Box>
                        {typeof f.annotationsCount === 'number' && f.annotationsCount > 0 && (
                          <Box
                            style={{
                              fontSize: 11,
                              color: '#ffd666',
                              background: '#3a2f1a',
                              padding: '2px 6px',
                              borderRadius: 10,
                              flexShrink: 0,
                            }}
                          >
                            {f.annotationsCount}
                          </Box>
                        )}
                      </UnstyledButton>
                    )
                  })}
                </Box>
              ))
            )}
          </Stack>
        </ScrollArea>
      </Box>

      <Box style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex' }}>{props.children}</Box>
    </Box>
  )
}
