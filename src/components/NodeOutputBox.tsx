/**
 * NodeOutputBox Component
 *
 * Unified dark-themed box for displaying node outputs (messages, badges, etc.)
 * with consistent header/footer styling.
 */

import { Stack, Text, Group } from '@mantine/core'
import type { ReactNode } from 'react'
import type { TokenCost } from '../store'
import { getNodeColor, formatNodeTitle } from '../../electron/store/utils/node-colors'

interface NodeOutputBoxProps {
  nodeLabel?: string
  nodeKind?: string
  provider?: string
  model?: string
  cost?: TokenCost
  children: ReactNode
}

export function NodeOutputBox({ nodeLabel, nodeKind, provider, model, cost, children }: NodeOutputBoxProps) {
  const showFooter = provider || model || (cost && cost.totalCost > 0)
  const color = getNodeColor(nodeKind)
  const displayTitle = formatNodeTitle(nodeKind, nodeLabel)

  return (
    <Stack
      gap={0}
      style={{
        backgroundColor: '#1a1a1a',
        border: `1px solid ${color}`,
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      {displayTitle && (
        <div
          style={{
            padding: '4px 8px',
            backgroundColor: color,
            borderBottom: `1px solid ${color}`,
          }}
        >
          <Text
            size="10px"
            fw={600}
            c="#ffffff"
            tt="uppercase"
            style={{ letterSpacing: '0.5px' }}
          >
            {displayTitle}
          </Text>
        </div>
      )}

      {/* Body */}
      <div style={{ padding: '8px' }}>
        {children}
      </div>

      {/* Footer */}
      {showFooter && (
        <div
          style={{
            padding: '4px 8px',
            backgroundColor: '#252525',
            borderTop: '1px solid #2a2a2a',
          }}
        >
          <Group gap="xs" justify="space-between">
            {/* Provider/Model */}
            {(provider || model) && (
              <Text size="10px" c="#666">
                {provider && model ? `${provider}/${model}` : provider || model}
              </Text>
            )}

            {/* Cost */}
            {cost && cost.totalCost > 0 && (
              <Text size="10px" c="#888" fw={500}>
                ${cost.totalCost.toFixed(5)}
                {cost.savings && cost.savings > 0 && (
                  <span style={{ color: '#4ade80', marginLeft: 4 }}>
                    (-${cost.savings.toFixed(5)})
                  </span>
                )}
              </Text>
            )}
          </Group>
        </div>
      )}
    </Stack>
  )
}

