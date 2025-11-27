import { memo, useEffect, useRef } from 'react'
import { Card, Group, Text, Badge as MantineBadge, Tooltip, ActionIcon } from '@mantine/core'
import { DiffEditor } from '@monaco-editor/react'
import { IconArrowsMaximize, IconX } from '@tabler/icons-react'
import { useUiStore } from '../store/ui'
import { computeLineDelta } from '../utils/diff'

export const InlineBadgeDiff = memo(function InlineBadgeDiff({ badgeId }: { badgeId: string }) {
    // Cached data (kept even when closed)
    const data = useUiStore((s) => s.inlineDiffByBadge?.[badgeId]) as Array<{ path: string; before?: string; after?: string; truncated?: boolean }> | undefined
    const isOpen = useUiStore((s) => !!s.inlineDiffOpenByBadge?.[badgeId])
    const openModal = useUiStore((s) => s.openDiffPreview)
    const closeInline = useUiStore((s) => s.closeInlineDiffForBadge)

    // Ensure Monaco diff editor detaches models on unmount
    const editorRef = useRef<any>(null)
    useEffect(() => {
        return () => {
            try { editorRef.current?.setModel(null) } catch { }
        }
    }, [])

    // If no data has ever been loaded for this badge, render nothing (no editor to mount yet)
    if (!data || !data.length) return null

    const f = data[0]
    const { added, removed } = computeLineDelta(f.before, f.after)

    // Unmount when closed; we detach models on unmount to avoid Monaco disposal errors
    if (!isOpen) return null

    return (
        <Card withBorder padding="xs" mt={6}>
            <Group justify="space-between" gap="xs" wrap="nowrap">
                <Group gap={6} wrap="nowrap">
                    <Text size="sm" fw={500} style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path}</Text>
                    <MantineBadge size="xs" color="green">+{added}</MantineBadge>
                    <MantineBadge size="xs" color="red">-{removed}</MantineBadge>
                    {f.truncated ? <MantineBadge size="xs" color="yellow">truncated</MantineBadge> : null}
                </Group>
                <Group gap="xs">
                    <Tooltip label="Open all files" withArrow>
                        <ActionIcon variant="light" size="sm" onClick={() => openModal(data)}>
                            <IconArrowsMaximize size={16} />
                        </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Close" withArrow>
                        <ActionIcon variant="subtle" size="sm" onClick={() => closeInline(badgeId)}>
                            <IconX size={16} />
                        </ActionIcon>
                    </Tooltip>
                </Group>
            </Group>
            <div style={{ height: 240, marginTop: 6 }}>
                <DiffEditor
                    height="240px"
                    original={f.before ?? ''}
                    modified={f.after ?? ''}
                    originalModelPath={`inmemory://diff/${badgeId}/${encodeURIComponent(f.path)}?side=original`}
                    modifiedModelPath={`inmemory://diff/${badgeId}/${encodeURIComponent(f.path)}?side=modified`}
                    theme="vs-dark"
                    options={{
                        readOnly: true,
                        renderSideBySide: false,
                        minimap: { enabled: false },
                        renderOverviewRuler: false,
                        overviewRulerBorder: false,
                        overviewRulerLanes: 0,
                        automaticLayout: true,
                        scrollBeyondLastLine: false
                    }}
                    language={undefined}
                    onMount={(ed) => { editorRef.current = ed }}
                />
            </div>
        </Card>
    )
})
