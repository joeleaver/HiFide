import React from 'react'
import { Badge as MantineBadge, useMantineTheme } from '@mantine/core'

export type BadgePillTone = 'neutral' | 'success' | 'danger'

export interface BadgePillProps {
  children: React.ReactNode
  tone?: BadgePillTone
}

export function BadgePill({ children, tone = 'neutral' }: BadgePillProps) {
  const theme = useMantineTheme()

  const background =
    tone === 'success' ? theme.colors.green[8]
    : tone === 'danger' ? theme.colors.red[8]
    : '#2a2a2a'

  return (
    <MantineBadge
      size="xs"
      style={{
        padding: '0 6px',
        height: 16,
        lineHeight: '16px',
        borderRadius: 9999,
        border: '1px solid rgba(255,255,255,0.25)',
        background,
        color: '#fff',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.3,
      }}
    >
      {children}
    </MantineBadge>
  )
}

