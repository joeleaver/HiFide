/**
 * DiffViewer - Displays file diffs for edits.apply badges
 * Fetches diff data via RPC on first expand
 */

import { useEffect } from 'react'
import { useUiStore } from '../../../../store/ui'
import { getBackendClient } from '../../../../lib/backend/bootstrap'
import type { Badge as BadgeType } from '../../../../../electron/store/types'
import { BadgeDiffContent } from '../../../BadgeDiffContent'

interface DiffViewerProps {
  badge: BadgeType
}

export function DiffViewer({ badge }: DiffViewerProps) {
  const openInlineDiffForBadge = useUiStore((s) => s.openInlineDiffForBadge)
  const inlineDiff = useUiStore((s) => s.inlineDiffByBadge?.[badge.id])

  // Load diff data on mount
  useEffect(() => {
    if (badge.interactive?.type !== 'diff') return

    const payload = badge.interactive?.data
    const existing = inlineDiff
    if (existing && existing.length) return

    if (payload && typeof payload === 'object' && payload.key) {
      const client = getBackendClient()
      if (!client) return
      client.rpc('edits.preview', { key: payload.key }).then((res: any) => {
        const files = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : [])
        if (files.length) openInlineDiffForBadge(badge.id, files)
      }).catch((e: any) => {
        console.error('[DiffViewer] Failed to load diff preview:', e)
      })
    } else if (Array.isArray(payload)) {
      openInlineDiffForBadge(badge.id, payload)
    }
  }, [badge.id, badge.interactive, inlineDiff, openInlineDiffForBadge])

  // Use existing BadgeDiffContent component
  if (badge.interactive?.data?.key) {
    return <BadgeDiffContent badgeId={badge.id} diffKey={badge.interactive.data.key} />
  }

  return null
}

