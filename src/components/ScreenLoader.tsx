/**
 * ScreenLoader Component
 * 
 * A wrapper that shows loading skeleton, error state, or content
 * based on the screen's hydration phase.
 * 
 * Usage:
 * ```tsx
 * <ScreenLoader
 *   hydration={useKanbanHydration}
 *   onLoad={loadKanbanData}
 *   skeleton={<KanbanSkeleton />}
 * >
 *   <KanbanBoard />
 * </ScreenLoader>
 * ```
 */

import React, { useEffect } from 'react'
import { Box, Center, Loader, Stack, Text, Button, Skeleton } from '@mantine/core'
import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react'
import type { StoreApi, UseBoundStore } from 'zustand'
import type { ScreenHydrationStore } from '../store/screenHydration'

export interface ScreenLoaderProps {
  /** The screen's hydration store */
  hydration: UseBoundStore<StoreApi<ScreenHydrationStore>>
  /** Called when screen should load data */
  onLoad: () => Promise<void>
  /** Content to show while loading (skeleton UI) */
  skeleton?: React.ReactNode
  /** Children to show when ready */
  children: React.ReactNode
  /** Whether to auto-load on mount (default: true) */
  autoLoad?: boolean
  /** Minimum height for the container */
  minHeight?: number | string
}

/**
 * Default skeleton that shows a simple loading spinner
 */
function DefaultSkeleton({ minHeight }: { minHeight?: number | string }) {
  return (
    <Center h={minHeight ?? 200}>
      <Stack align="center" gap="sm">
        <Loader size="md" />
        <Text size="sm" c="dimmed">Loading…</Text>
      </Stack>
    </Center>
  )
}

/**
 * Error state with retry button
 */
function ErrorState({ 
  error, 
  onRetry,
  minHeight,
}: { 
  error: string | null
  onRetry: () => void
  minHeight?: number | string
}) {
  return (
    <Center h={minHeight ?? 200}>
      <Stack align="center" gap="md">
        <IconAlertTriangle size={48} color="var(--mantine-color-red-6)" />
        <Text size="sm" c="dimmed" ta="center">
          {error ?? 'Something went wrong'}
        </Text>
        <Button
          variant="light"
          size="sm"
          leftSection={<IconRefresh size={16} />}
          onClick={onRetry}
        >
          Retry
        </Button>
      </Stack>
    </Center>
  )
}

export function ScreenLoader({
  hydration,
  onLoad,
  skeleton,
  children,
  autoLoad = true,
  minHeight,
}: ScreenLoaderProps) {
  const phase = hydration((s) => s.phase)
  const error = hydration((s) => s.error)
  const startLoading = hydration((s) => s.startLoading)
  const setReady = hydration((s) => s.setReady)
  const setError = hydration((s) => s.setError)

  // Auto-load on mount if enabled and in idle state
  useEffect(() => {
    if (autoLoad && phase === 'idle') {
      doLoad()
    }
  }, [autoLoad]) // Only run on mount

  const doLoad = async () => {
    startLoading()
    try {
      await onLoad()
      setReady()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // Show based on phase
  switch (phase) {
    case 'idle':
    case 'loading':
      return (
        <Box style={{ minHeight }}>
          {skeleton ?? <DefaultSkeleton minHeight={minHeight} />}
        </Box>
      )

    case 'error':
      return (
        <ErrorState 
          error={error} 
          onRetry={doLoad}
          minHeight={minHeight}
        />
      )

    case 'ready':
    case 'refreshing':
      return <>{children}</>

    default:
      return null
  }
}

/**
 * Simple skeleton for lists
 */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Stack gap="sm" p="md">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={40} radius="sm" />
      ))}
    </Stack>
  )
}

/**
 * Grid skeleton for card layouts
 */
export function GridSkeleton({ cols = 3, rows = 2 }: { cols?: number; rows?: number }) {
  return (
    <Box p="md" style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 16 }}>
      {Array.from({ length: cols * rows }).map((_, i) => (
        <Skeleton key={i} height={120} radius="sm" />
      ))}
    </Box>
  )
}

