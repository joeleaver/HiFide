import { useState } from 'react'
import { Text, UnstyledButton } from '@mantine/core'
import { useSessionUi } from '../store/sessionUi'
import { useUiStore } from '../store/ui'
import TokensCostsPanel from './TokensCostsPanel'

export default function TotalCostDisplay() {
  const [panelOpen, setPanelOpen] = useState(false)

  const mainCollapsed = useUiStore((s) => s.mainCollapsed)
  const costs = (useSessionUi((s: any) => s.costs) as any) || { inputCost: 0, cachedCost: 0, outputCost: 0 }

  // Calculate total the same way as TokensCostsPanel does
  const inputCost = Number(costs?.inputCost ?? 0)
  const cachedCost = Number(costs?.cachedCost ?? 0)
  const outputCost = Number(costs?.outputCost ?? 0)
  const totalCost = inputCost + cachedCost + outputCost

  const formatCost = (cost: number) => {
    return `$${cost.toFixed(4)}`
  }

  return (
    <>
      <UnstyledButton
        onClick={() => setPanelOpen(!panelOpen)}
        style={{
          padding: '4px 8px',
          borderRadius: '4px',
          backgroundColor: 'rgba(129, 199, 132, 0.1)',
          border: '1px solid rgba(129, 199, 132, 0.3)',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '28px',
          minWidth: '60px',
          fontSize: '12px',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(129, 199, 132, 0.2)'
          e.currentTarget.style.borderColor = 'rgba(129, 199, 132, 0.5)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(129, 199, 132, 0.1)'
          e.currentTarget.style.borderColor = 'rgba(129, 199, 132, 0.3)'
        }}
      >
        <Text size="xs" fw={600} c="#81c784" style={{ whiteSpace: 'nowrap' }}>
          {formatCost(totalCost)}
        </Text>
      </UnstyledButton>

      {/* Floating overlay panel */}
      {panelOpen && (
        <div
          style={{
            position: 'fixed',
            top: '60px',
            right: '16px',
            width: mainCollapsed ? '500px' : '700px',
            height: '600px',
            backgroundColor: '#1e1e1e',
            border: '1px solid #3e3e42',
            borderRadius: '4px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #3e3e42',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <Text size="sm" fw={600}>
              TOKENS & COSTS
            </Text>
            <UnstyledButton
              onClick={() => setPanelOpen(false)}
              style={{
                color: '#cccccc',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 20,
                height: 20,
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#ffffff'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = '#cccccc'
              }}
            >
              ✕
            </UnstyledButton>
          </div>

          {/* Panel content */}
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
            <TokensCostsPanel isFloating={true} />
          </div>
        </div>
      )}

      {/* Backdrop to close panel when clicking outside */}
      {panelOpen && (
        <div
          onClick={() => setPanelOpen(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999,
          }}
        />
      )}
    </>
  )
}

