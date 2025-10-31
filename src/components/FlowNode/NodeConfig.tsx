import { Text, Checkbox, Accordion } from '@mantine/core'
import { useAppStore, useDispatch } from '../../store'
import { useMemo, useState, useEffect } from 'react'
import InjectMessagesConfig from './InjectMessagesConfig'

interface NodeConfigProps {
  nodeId: string
  nodeType: string
  config: any
  onConfigChange: (patch: any) => void
}

export default function NodeConfig({ nodeId, nodeType, config, onConfigChange }: NodeConfigProps) {
  // Get provider/model data for newContext node and llmRequest node
  const providerValid = useAppStore((s) => s.providerValid)
  const modelsByProvider = useAppStore((s) => s.modelsByProvider)
  const feNodes = useAppStore((s) => s.feNodes)
  const feEdges = useAppStore((s) => s.feEdges)
  const selectedProvider = useAppStore((s) => s.selectedProvider)
  const selectedModel = useAppStore((s) => s.selectedModel)
  const dispatch = useDispatch()

  const providerOptions = useMemo(() => {
    return Object.entries(providerValid || {})
      .filter(([, ok]) => !!ok)
      .map(([id]) => ({ value: id, label: id.charAt(0).toUpperCase() + id.slice(1) }))
  }, [providerValid])

  const modelOptions = useMemo(() => {
    const provider = config.provider || 'openai'
    return (modelsByProvider[provider as keyof typeof modelsByProvider] || [])
  }, [config.provider, modelsByProvider])

  // Portal Input validation - check for duplicate IDs
  const portalInputValidation = useMemo(() => {
    if (nodeType !== 'portalInput') return { isValid: true, error: null }

    const portalId = config.id
    if (!portalId) return { isValid: false, error: 'Portal ID is required' }

    // Find all Portal Input nodes with the same ID
    const duplicates = feNodes.filter(
      (n: any) =>
        (n.data as any)?.nodeType === 'portalInput' &&
        (n.data as any)?.config?.id === portalId &&
        n.id !== nodeId // Exclude self
    )

    if (duplicates.length > 0) {
      return {
        isValid: false,
        error: `Duplicate Portal ID! ${duplicates.length + 1} Portal Input node(s) use "${portalId}"`
      }
    }

    return { isValid: true, error: null }
  }, [nodeType, config.id, feNodes, nodeId])



  return (
    <div className="nodrag" style={{ padding: 10, background: '#1e1e1e', borderTop: '1px solid #333', fontSize: 11, overflow: 'hidden', wordWrap: 'break-word' }}>
      {/* defaultContextStart node configuration */}
      {nodeType === 'defaultContextStart' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid #333' }}>
          <Text size="xs" c="dimmed" style={{ fontSize: 9, lineHeight: 1.3 }}>
            🎬 Flow entry point. Uses the global provider/model settings. Configure system instructions below.
          </Text>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: '#888', fontWeight: 600 }}>System Instructions:</span>
            <textarea
              value={config.systemInstructions || ''}
              onChange={(e) => onConfigChange({ systemInstructions: e.target.value })}
              placeholder="Optional system instructions for the AI (e.g., 'You are a helpful assistant...')"
              rows={4}
              style={{
                padding: '4px 6px',
                background: '#252526',
                color: '#cccccc',
                border: '1px solid #3e3e42',
                borderRadius: 3,
                fontSize: 10,
                fontFamily: 'inherit',
                resize: 'vertical',
              }}
            />
          </label>

          {/* Sampling & reasoning controls (visible only when global provider & model are selected) */}
          {selectedProvider && selectedModel ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {!(selectedProvider === 'openai' && /(o3|codex)/i.test(String(selectedModel))) && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cccccc' }}>
                  <span style={{ fontSize: 10, color: '#888', width: 90 }}>Temperature:</span>
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    max={selectedProvider === 'anthropic' ? 1 : 2}
                    value={(config.temperature ?? '') as any}
                    onChange={(e) => {
                      const v = e.target.value
                      const num = parseFloat(v)
                      onConfigChange({ temperature: Number.isFinite(num) ? num : undefined })
                    }}
                    placeholder={selectedProvider === 'anthropic' ? '0–1' : '0–2'}
                    style={{
                      flex: 1,
                      padding: '2px 4px',
                      background: '#252526',
                      color: '#cccccc',
                      border: '1px solid #3e3e42',
                      borderRadius: 3,
                      fontSize: 10,
                    }}
                  />
                </label>
              )}

              {/* OpenAI reasoning effort (o3 family) */}
              {selectedProvider === 'openai' && /(o3|gpt-5)/i.test(String(selectedModel)) && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cccccc' }}>
                  <span style={{ fontSize: 10, color: '#888', width: 90 }}>Reasoning effort:</span>
                  <select
                    value={config.reasoningEffort || ''}
                    onChange={(e) => onConfigChange({ reasoningEffort: e.target.value || undefined })}
                    style={{
                      flex: 1,
                      padding: '4px 6px',
                      background: '#252526',
                      color: '#cccccc',
                      border: '1px solid #3e3e42',
                      borderRadius: 3,
                      fontSize: 10,
                    }}
                  >
                    <option value="">Default</option>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </select>
                </label>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* userInput node configuration */}
      {nodeType === 'userInput' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid #333' }}>
          <Text size="xs" c="dimmed" style={{ fontSize: 9, lineHeight: 1.3 }}>
            👤 Pauses flow execution and waits for user input. Use this to create interactive loops or get feedback mid-flow.
          </Text>
          <Text size="xs" c="dimmed" style={{ fontSize: 9, lineHeight: 1.3, fontStyle: 'italic' }}>
            No configuration needed - just connect it in your flow where you want to wait for user input.
          </Text>
        </div>
      )}

      {/* manualInput node configuration */}
      {nodeType === 'manualInput' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid #333' }}>
          <Text size="xs" c="dimmed" style={{ fontSize: 9, lineHeight: 1.3 }}>
            ✍️ Sends a pre-configured user message to the LLM in the current context. Useful for multi-turn conversations.
          </Text>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: '#888', fontWeight: 600 }}>Message:</span>
            <textarea
              value={config.message || ''}
              onChange={(e) => onConfigChange({ message: e.target.value })}
              placeholder="Enter the user message to send (e.g., 'Now explain that in simpler terms...')"
              rows={3}
              style={{
                padding: '4px 6px',
                background: '#252526',
                color: '#cccccc',
                border: '1px solid #3e3e42',
                borderRadius: 3,
                fontSize: 10,
                fontFamily: 'inherit',
                resize: 'vertical',
              }}
            />
          </label>
        </div>
      )}

      {/* injectMessages node configuration */}
      {nodeType === 'injectMessages' && <InjectMessagesConfig nodeId={nodeId} config={config} onConfigChange={onConfigChange} />}

      {/* tools node configuration */}
      {nodeType === 'tools' && <ToolsConfig config={config} onConfigChange={onConfigChange} />}

      {/* newContext node configuration */}
      {nodeType === 'newContext' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid #333' }}>
          <Text size="xs" c="dimmed" style={{ fontSize: 9, lineHeight: 1.3 }}>
            🔀 Creates an isolated execution context for parallel flows. Use this for bootstrap flows or background processing that shouldn't pollute the main conversation.
          </Text>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: '#888', fontWeight: 600 }}>Provider:</span>
            <select
              value={config.provider || 'openai'}
              onChange={(e) => {
                const newProvider = e.target.value
                // Get models for the new provider
                const newProviderModels = modelsByProvider[newProvider as keyof typeof modelsByProvider] || []
                const firstModel = newProviderModels[0]?.value || ''
                // Set both provider and model when provider changes
                onConfigChange({ provider: newProvider, model: firstModel })
              }}
              style={{
                padding: '4px 6px',
                background: '#252526',
                color: '#cccccc',
                border: '1px solid #3e3e42',
                borderRadius: 3,
                fontSize: 10,
              }}
            >
              {providerOptions.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: '#888', fontWeight: 600 }}>Model:</span>
            <select
              value={config.model || (modelOptions[0]?.value || '')}
              onChange={(e) => onConfigChange({ provider: config.provider || 'openai', model: e.target.value })}
              style={{
                padding: '4px 6px',
                background: '#252526',
                color: '#cccccc',
                border: '1px solid #3e3e42',
                borderRadius: 3,
                fontSize: 10,
              }}
            >
              {modelOptions.map((m: any) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: '#888', fontWeight: 600 }}>System Instructions:</span>
            <textarea
              value={config.systemInstructions || ''}
              onChange={(e) => onConfigChange({ systemInstructions: e.target.value })}
              placeholder="Optional system instructions for this isolated context (e.g., 'You are a code analyzer...')"
              rows={4}
              style={{
                padding: '4px 6px',
                background: '#252526',
                color: '#cccccc',
                border: '1px solid #3e3e42',
                borderRadius: 3,
                fontSize: 10,
                fontFamily: 'inherit',
                resize: 'vertical',
              }}
            />
          </label>

            {/* Sampling & reasoning controls (visible only when provider & model are selected) */}
            {config.provider && config.model ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                {!(config.provider === 'openai' && /(o3|codex)/i.test(String(config.model))) && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cccccc' }}>
                    <span style={{ fontSize: 10, color: '#888', width: 90 }}>Temperature:</span>
                    <input
                      type="number"
                      step="0.1"
                      min={0}
                      max={(config.provider === 'anthropic') ? 1 : 2}
                      value={(config.temperature ?? '') as any}
                      onChange={(e) => {
                        const v = e.target.value
                        const num = parseFloat(v)
                        onConfigChange({ temperature: Number.isFinite(num) ? num : undefined })
                      }}
                      placeholder={(config.provider === 'anthropic') ? '0–1' : '0–2'}
                      style={{
                        flex: 1,
                        padding: '2px 4px',
                        background: '#252526',
                        color: '#cccccc',
                        border: '1px solid #3e3e42',
                        borderRadius: 3,
                        fontSize: 10,
                      }}
                    />
                  </label>
                )}

                {/* OpenAI reasoning effort (o3 family) */}
                {config.provider === 'openai' && /(o3|gpt-5)/i.test(String(config.model)) && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cccccc' }}>
                    <span style={{ fontSize: 10, color: '#888', width: 90 }}>Reasoning effort:</span>
                    <select
                      value={config.reasoningEffort || ''}
                      onChange={(e) => onConfigChange({ reasoningEffort: e.target.value || undefined })}
                      style={{
                        flex: 1,
                        padding: '4px 6px',
                        background: '#252526',
                        color: '#cccccc',
                        border: '1px solid #3e3e42',
                        borderRadius: 3,
                        fontSize: 10,
                      }}
                    >
                      <option value="">Default</option>
                      <option value="low">low</option>
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                    </select>
                  </label>
                )}
              </div>
            ) : null}

        </div>
      )}

      {/* portalInput node configuration */}
      {nodeType === 'portalInput' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid #333' }}>
          <Text size="xs" c="dimmed" style={{ fontSize: 9, lineHeight: 1.3 }}>
            📥 Stores context and data for retrieval by Portal Output nodes. Reduces edge crossings in complex flows.
          </Text>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: '#888', fontWeight: 600 }}>Portal ID:</span>
            <input
              type="text"
              value={config.id || ''}
              onChange={(e) => onConfigChange({ id: e.target.value })}
              placeholder="Enter unique portal ID (e.g., 'loop-back')"
              style={{
                padding: '4px 6px',
                background: '#252526',
                color: '#cccccc',
                border: portalInputValidation.isValid ? '1px solid #3e3e42' : '1px solid #ef4444',
                borderRadius: 3,
                fontSize: 10,
                fontFamily: 'monospace',
              }}
            />
          </label>
          {!portalInputValidation.isValid && (
            <Text size="xs" style={{ fontSize: 9, lineHeight: 1.3, color: '#ef4444', fontWeight: 600 }}>
              ⚠️ {portalInputValidation.error}
            </Text>
          )}
          <Text size="xs" c="dimmed" style={{ fontSize: 9, lineHeight: 1.3, fontStyle: 'italic' }}>
            Portal Output nodes with matching ID will retrieve data from this node.
          </Text>
        </div>
      )}

      {/* portalOutput node configuration */}
      {nodeType === 'portalOutput' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid #333' }}>
          <Text size="xs" c="dimmed" style={{ fontSize: 9, lineHeight: 1.3 }}>
            📤 Retrieves context and data from matching Portal Input node. Reduces edge crossings in complex flows.
          </Text>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: '#888', fontWeight: 600 }}>Portal ID:</span>
            <input
              type="text"
              value={config.id || ''}
              onChange={(e) => onConfigChange({ id: e.target.value })}
              placeholder="Enter portal ID to match (e.g., 'loop-back')"
              style={{
                padding: '4px 6px',
                background: '#252526',
                color: '#cccccc',
                border: '1px solid #3e3e42',
                borderRadius: 3,
                fontSize: 10,
                fontFamily: 'monospace',
              }}
            />
          </label>
          <Text size="xs" c="dimmed" style={{ fontSize: 9, lineHeight: 1.3, fontStyle: 'italic' }}>
            Must match the ID of a Portal Input node to retrieve its data.
          </Text>
        </div>
      )}



      {/* Node-specific config */}
      {nodeType === 'approvalGate' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cccccc', fontSize: 10 }}>
            <input
              type="checkbox"
              checked={!!config.requireApproval}
              onChange={(e) => onConfigChange({ requireApproval: e.target.checked })}
            />
            <span>Require approval</span>
          </label>
          <Text size="xs" c="dimmed" style={{ fontSize: 9, lineHeight: 1.3 }}>
            {config.requireApproval
              ? '⏸ Flow will pause here and wait for manual approval (click Resume to continue)'
              : '✓ Flow will continue automatically without pausing'}
          </Text>
        </div>
      )}

      {nodeType === 'budgetGuard' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cccccc' }}>
            <span style={{ fontSize: 10, color: '#888', width: 60 }}>Budget:</span>
            <input
              type="number"
              step="0.01"
              value={config.budgetUSD || ''}
              onChange={(e) => onConfigChange({ budgetUSD: e.target.value })}
              placeholder="USD"
              style={{
                flex: 1,
                padding: '2px 4px',
                background: '#252526',
                color: '#cccccc',
                border: '1px solid #3e3e42',
                borderRadius: 3,
                fontSize: 10,
              }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cccccc', fontSize: 10 }}>
            <input
              type="checkbox"
              checked={!!config.blockOnExceed}
              onChange={(e) => onConfigChange({ blockOnExceed: e.target.checked })}
            />
            <span>Block on exceed</span>
          </label>
        </div>
      )}

      {nodeType === 'llmRequest' && (() => {
        // Check if context input is connected
        const isContextConnected = feEdges.some((e: any) => e.target === nodeId && e.targetHandle === 'context')
        const overrideModelOptions = (modelsByProvider[(config.overrideProvider || config.provider || 'openai') as keyof typeof modelsByProvider] || [])

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Show provider/model selectors only when context is NOT connected */}
            {!isContextConnected && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid #333' }}>
                <Text size="xs" c="dimmed" style={{ fontSize: 9, lineHeight: 1.3 }}>
                  💬 No context connected. Configure provider/model for this LLM request:
                </Text>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 10, color: '#888', fontWeight: 600 }}>Provider:</span>
                    <select
                      value={config.provider || 'openai'}
                      onChange={(e) => onConfigChange({ provider: e.target.value, model: '' })}
                      className="nodrag"
                      style={{
                        padding: '4px 6px',
                        background: '#252526',
                        color: '#cccccc',
                        border: '1px solid #3e3e42',
                        borderRadius: 3,
                        fontSize: 10,
                      }}
                    >
                      {providerOptions.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 10, color: '#888', fontWeight: 600 }}>Model:</span>
                    <select
                      value={config.model || (modelOptions[0]?.value || '')}
                      onChange={(e) => onConfigChange({ provider: config.provider || 'openai', model: e.target.value })}
                      className="nodrag"
                      style={{
                        padding: '4px 6px',
                        background: '#252526',
                        color: '#cccccc',
                        border: '1px solid #3e3e42',
                        borderRadius: 3,
                        fontSize: 10,
                      }}
                    >
                      {modelOptions.map((m: any) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            )}

            {/* Override provider/model when context IS connected */}
            {isContextConnected && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid #333' }}>
                <Checkbox
                  label="Override provider/model"
                  checked={config.overrideEnabled || false}
                  onChange={(e) => {
                    const enabled = e.currentTarget.checked
                    if (enabled) {
                      const prov = (config.overrideProvider || selectedProvider || config.provider || 'openai') as string
                      const providerModels = (modelsByProvider as any)[prov] || []
                      let mdl = config.overrideModel as string | undefined
                      if (!mdl) {
                        const selectedIsValid = selectedModel && providerModels.some((m: any) => m.value === selectedModel)
                        mdl = selectedIsValid ? (selectedModel as string) : (providerModels[0]?.value || '')
                      }
                      onConfigChange({ overrideEnabled: true, overrideProvider: prov, overrideModel: mdl })
                    } else {
                      onConfigChange({ overrideEnabled: false })
                    }
                  }}
                  size="xs"
                  styles={{
                    label: { fontSize: 10, color: '#cccccc', fontWeight: 600 },
                  }}
                />

                {config.overrideEnabled && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 10, color: '#888', fontWeight: 600 }}>Provider:</span>
                      <select
                        value={config.overrideProvider || 'openai'}
                        onChange={(e) => {
                          const newProvider = e.target.value
                          const newProviderModels = (modelsByProvider as any)[newProvider] || []
                          const firstModel = newProviderModels[0]?.value || ''
                          onConfigChange({ overrideProvider: newProvider, overrideModel: firstModel })
                        }}
                        className="nodrag"
                        style={{
                          padding: '4px 6px',
                          background: '#252526',
                          color: '#cccccc',
                          border: '1px solid #3e3e42',
                          borderRadius: 3,
                          fontSize: 10,
                        }}
                      >
                        {providerOptions.map((p) => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 10, color: '#888', fontWeight: 600 }}>Model:</span>
                      <select
                        value={config.overrideModel || (overrideModelOptions[0]?.value || '')}
                        onChange={(e) => onConfigChange({ overrideModel: e.target.value })}
                        className="nodrag"
                        style={{
                          padding: '4px 6px',
                          background: '#252526',
                          color: '#cccccc',
                          border: '1px solid #3e3e42',
                          borderRadius: 3,
                          fontSize: 10,
                        }}
                      >
                        {overrideModelOptions.map((m: any) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                    </label>

                    {/* Override sampling & reasoning controls */}
                    {(config.overrideProvider && config.overrideModel) && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                        {!(config.overrideProvider === 'openai' && /(o3|codex)/i.test(String(config.overrideModel))) && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cccccc' }}>
                            <span style={{ fontSize: 10, color: '#888', width: 90 }}>Temperature:</span>
                            <input
                              type="number"
                              step="0.1"
                              min={0}
                              max={config.overrideProvider === 'anthropic' ? 1 : 2}
                              value={(config.overrideTemperature ?? '') as any}
                              onChange={(e) => {
                                const v = e.target.value
                                const num = parseFloat(v)
                                onConfigChange({ overrideTemperature: Number.isFinite(num) ? num : undefined })
                              }}
                              placeholder={config.overrideProvider === 'anthropic' ? '0–1' : '0–2'}
                              style={{
                                flex: 1,
                                padding: '2px 4px',
                                background: '#252526',
                                color: '#cccccc',
                                border: '1px solid #3e3e42',
                                borderRadius: 3,
                                fontSize: 10,
                              }}
                            />
                          </label>
                        )}

                        {config.overrideProvider === 'openai' && /(o3|gpt-5)/i.test(String(config.overrideModel)) && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cccccc' }}>
                            <span style={{ fontSize: 10, color: '#888', width: 90 }}>Reasoning effort:</span>
                            <select
                              value={config.overrideReasoningEffort || ''}
                              onChange={(e) => onConfigChange({ overrideReasoningEffort: e.target.value || undefined })}
                              style={{
                                flex: 1,
                                padding: '4px 6px',
                                background: '#252526',
                                color: '#cccccc',
                                border: '1px solid #3e3e42',
                                borderRadius: 3,
                                fontSize: 10,
                              }}
                            >
                              <option value="">Default</option>
                              <option value="low">low</option>
                              <option value="medium">medium</option>
                              <option value="high">high</option>
                            </select>
                          </label>
                        )}
                      </div>
                    )}

                  </div>
                )}
              </div>
            )}

            {/* Retry settings - always show */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cccccc' }}>
              <span style={{ fontSize: 10, color: '#888', width: 80 }}>Retry attempts:</span>
              <input
                type="number"
                min="1"
                value={config.retryAttempts || 1}
                onChange={(e) => onConfigChange({ retryAttempts: parseInt(e.target.value) || 1 })}
                style={{
                  flex: 1,
                  padding: '2px 4px',
                  background: '#252526',
                  color: '#cccccc',
                  border: '1px solid #3e3e42',
                  borderRadius: 3,
                  fontSize: 10,
                }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cccccc' }}>
              <span style={{ fontSize: 10, color: '#888', width: 80 }}>Retry backoff:</span>
              <input
                type="number"
                min="0"
                value={config.retryBackoffMs || 0}
                onChange={(e) => onConfigChange({ retryBackoffMs: parseInt(e.target.value) || 0 })}
                placeholder="ms"
                style={{
                  flex: 1,
                  padding: '2px 4px',
                  background: '#252526',
                  color: '#cccccc',
                border: '1px solid #3e3e42',
                borderRadius: 3,
                fontSize: 10,
              }}
            />
          </label>
        </div>
        )
      })()}

      {nodeType === 'redactor' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cccccc', fontSize: 10 }}>
            <input
              type="checkbox"
              checked={config.enabled ?? true}
              onChange={(e) => onConfigChange({ enabled: e.target.checked })}
            />
            <span>Enabled</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cccccc', fontSize: 10 }}>
            <input
              type="checkbox"
              checked={!!config.ruleEmails}
              onChange={(e) => onConfigChange({ ruleEmails: e.target.checked })}
            />
            <span>Redact emails</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cccccc', fontSize: 10 }}>
            <input
              type="checkbox"
              checked={!!config.ruleApiKeys}
              onChange={(e) => onConfigChange({ ruleApiKeys: e.target.checked })}
            />
            <span>Redact API keys</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cccccc', fontSize: 10 }}>
            <input
              type="checkbox"
              checked={!!config.ruleAwsKeys}
              onChange={(e) => onConfigChange({ ruleAwsKeys: e.target.checked })}
            />
            <span>Redact AWS keys</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cccccc', fontSize: 10 }}>
            <input
              type="checkbox"
              checked={!!config.ruleNumbers16}
              onChange={(e) => onConfigChange({ ruleNumbers16: e.target.checked })}
            />
            <span>Redact 16+ digit numbers</span>
          </label>
        </div>
      )}

      {nodeType === 'errorDetection' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cccccc', fontSize: 10 }}>
            <input
              type="checkbox"
              checked={config.enabled ?? true}
              onChange={(e) => onConfigChange({ enabled: e.target.checked })}
            />
            <span>Enabled</span>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, color: '#cccccc' }}>
            <span style={{ fontSize: 10, color: '#888' }}>Error patterns (one per line):</span>
            <textarea
              value={(config.patterns || []).join('\n')}
              onChange={(e) => onConfigChange({ patterns: e.target.value.split('\n').filter(Boolean) })}
              placeholder="error\nexception\nfailed"
              rows={3}
              style={{
                padding: '4px 6px',
                background: '#252526',
                color: '#cccccc',
                border: '1px solid #3e3e42',
                borderRadius: 3,
                fontSize: 10,
                fontFamily: 'monospace',
                resize: 'vertical',
              }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cccccc', fontSize: 10 }}>
            <input
              type="checkbox"
              checked={!!config.blockOnFlag}
              onChange={(e) => onConfigChange({ blockOnFlag: e.target.checked })}
            />
            <span>Block when flagged</span>
          </label>
        </div>
      )}

      {nodeType === 'intentRouter' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Text size="xs" c="dimmed" style={{ fontSize: 9, lineHeight: 1.3 }}>
            🔀 Routes flow based on LLM-classified user intent. Passes context through unchanged.
          </Text>

          {/* Provider and Model Selection - always show */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 8, borderBottom: '1px solid #3e3e42' }}>
            <Text size="xs" c="dimmed" style={{ fontSize: 9, lineHeight: 1.3 }}>
              Configure the LLM used for intent classification:
            </Text>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 10, color: '#888', fontWeight: 600 }}>Provider:</span>
                {(() => {
                  const currentProv = config.provider
                  const hasCurrent = !!currentProv && providerOptions.some((p) => p.value === currentProv)
                  const opts = hasCurrent
                    ? providerOptions
                    : (currentProv
                      ? [...providerOptions, { value: currentProv, label: `${currentProv} (no key)` }]
                      : providerOptions)
                  return (
                    <select
                      value={currentProv || 'openai'}
                      onChange={(e) => onConfigChange({ provider: e.target.value, model: '' })}
                      className="nodrag"
                      style={{
                        padding: '4px 6px',
                        background: '#252526',
                        color: '#cccccc',
                        border: '1px solid #3e3e42',
                        borderRadius: 3,
                        fontSize: 10,
                      }}
                    >
                      {opts.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  )
                })()}
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 10, color: '#888', fontWeight: 600 }}>Model:</span>
                <select
                  value={config.model || ''}
                  onChange={(e) => onConfigChange({ model: e.target.value })}
                  className="nodrag"
                  style={{
                    padding: '4px 6px',
                    background: '#252526',
                    color: '#cccccc',
                    border: '1px solid #3e3e42',
                    borderRadius: 3,
                    fontSize: 10,
                  }}
                >
                  <option value="">Select model...</option>
                  {modelOptions.map((m: any) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {/* Intent Table */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 24px', gap: 4, fontSize: 9, color: '#888', fontWeight: 600, paddingBottom: 4, borderBottom: '1px solid #3e3e42' }}>
              <span>Intent</span>
              <span>Description</span>
              <span></span>
            </div>

            {/* Render existing intents */}
            {Object.entries(config.routes || {}).map(([intent, description], idx) => (
              <div key={`intent-${idx}`} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 24px', gap: 4, alignItems: 'center' }}>
                <input
                  type="text"
                  value={intent}
                  onChange={(e) => {
                    const entries = Object.entries(config.routes || {})
                    const newRoutes: Record<string, string> = {}
                    entries.forEach(([k, v], i) => {
                      if (i === idx) {
                        newRoutes[e.target.value] = v as string
                      } else {
                        newRoutes[k] = v as string
                      }
                    })
                    onConfigChange({ routes: newRoutes })
                  }}
                  placeholder="intent"
                  className="nodrag"
                  style={{
                    padding: '3px 5px',
                    background: '#252526',
                    color: '#cccccc',
                    border: '1px solid #3e3e42',
                    borderRadius: 3,
                    fontSize: 10,
                    fontFamily: 'monospace',
                  }}
                />
                <input
                  type="text"
                  value={description as string}
                  onChange={(e) => {
                    const newRoutes = { ...config.routes }
                    newRoutes[intent] = e.target.value
                    onConfigChange({ routes: newRoutes })
                  }}
                  placeholder="Description of when to use this intent"
                  className="nodrag"
                  style={{
                    padding: '3px 5px',
                    background: '#252526',
                    color: '#cccccc',
                    border: '1px solid #3e3e42',
                    borderRadius: 3,
                    fontSize: 10,
                  }}
                />
                <button
                  onClick={() => {
                    const newRoutes = { ...config.routes }
                    delete newRoutes[intent]
                    onConfigChange({ routes: newRoutes })
                  }}
                  className="nodrag"
                  style={{
                    padding: '2px 6px',
                    background: '#3e3e42',
                    color: '#cccccc',
                    border: 'none',
                    borderRadius: 3,
                    fontSize: 10,
                    cursor: 'pointer',
                  }}
                  title="Remove intent"
                >
                  ×
                </button>
              </div>
            ))}

            {/* Add new intent button */}
            <button
              onClick={() => {
                const newRoutes = { ...config.routes }
                let counter = 1
                while (newRoutes[`intent${counter}`]) counter++
                newRoutes[`intent${counter}`] = ''
                onConfigChange({ routes: newRoutes })
              }}
              style={{
                padding: '4px 8px',
                background: '#3e3e42',
                color: '#cccccc',
                border: '1px solid #555',
                borderRadius: 3,
                fontSize: 10,
                cursor: 'pointer',
                marginTop: 4,
              }}
            >
              + Add Intent
            </button>
          </div>

          <Text size="xs" c="blue.4" style={{ fontSize: 9, lineHeight: 1.3 }}>
            💡 The LLM classifies the input text (without conversation context) and routes to the matching intent. Context is passed through unchanged. Only the matched intent's outputs will trigger downstream nodes.
          </Text>
        </div>
      )}

      {/* cache node configuration */}
      {nodeType === 'cache' && (() => {
        const currentSession = useAppStore((s) => s.sessions?.find((sess: any) => sess.id === s.currentId))
        const cacheData = currentSession?.flowCache?.[nodeId]
        const cacheAge = cacheData ? ((Date.now() - cacheData.timestamp) / 1000).toFixed(1) : null
        const ttl = config.ttl ?? 300
        const isCacheValid = cacheData && ttl > 0 && parseFloat(cacheAge!) < ttl

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid #333' }}>
            <Text size="xs" c="dimmed" style={{ fontSize: 9, lineHeight: 1.3 }}>
              💾 Caches data from upstream nodes. Set TTL to 0 to disable caching.
            </Text>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10, color: '#888', fontWeight: 600 }}>TTL (seconds):</span>
              <input
                type="number"
                min="0"
                value={config.ttl ?? 300}
                onChange={(e) => onConfigChange({ ttl: parseInt(e.target.value) || 0 })}
                placeholder="300"
                style={{
                  padding: '4px 6px',
                  background: '#252526',
                  color: '#cccccc',
                  border: '1px solid #3e3e42',
                  borderRadius: 3,
                  fontSize: 10,
                }}
              />
              <Text size="xs" c="dimmed" style={{ fontSize: 9, lineHeight: 1.3 }}>
                Default: 300 seconds (5 minutes). Set to 0 to disable caching.
              </Text>
            </label>

            <button
              onClick={async () => {
                // Set invalidate timestamp for next execution (local state only)
                onConfigChange({ invalidate: Date.now() })

                // Immediately clear the cache in session (without triggering flow editor sync)
                // Note: We don't await this to avoid blocking the UI
                dispatch('clearNodeCache', nodeId)
              }}
              style={{
                padding: '6px 10px',
                background: '#3e3e42',
                color: '#cccccc',
                border: '1px solid #555',
                borderRadius: 3,
                fontSize: 10,
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              🗑️ Invalidate Cache
            </button>

            {/* Cache Inspector - Read-only view of current cache contents */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8, background: '#1a1a1a', borderRadius: 3, border: '1px solid #3e3e42' }}>
              <Text size="xs" c="dimmed" style={{ fontSize: 9, fontWeight: 600, color: '#888' }}>
                📊 Cache Status
              </Text>

              {cacheData ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 9 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: isCacheValid ? '#4ade80' : '#f87171' }}>
                    <span>Status:</span>
                    <span style={{ fontWeight: 600 }}>
                      {isCacheValid ? '✓ Valid' : '✗ Expired'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cccccc' }}>
                    <span>Age:</span>
                    <span>{cacheAge}s</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cccccc' }}>
                    <span>TTL:</span>
                    <span>{ttl}s</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cccccc' }}>
                    <span>Data Type:</span>
                    <span>{typeof cacheData.data}</span>
                  </div>

                  {/* Data preview */}
                  <div style={{ marginTop: 4, padding: 6, background: '#252526', borderRadius: 2, border: '1px solid #3e3e42', maxHeight: 120, overflow: 'auto' }}>
                    <Text size="xs" c="dimmed" style={{ fontSize: 8, color: '#888', marginBottom: 4 }}>
                      Data Preview:
                    </Text>
                    <pre style={{ margin: 0, fontSize: 8, color: '#cccccc', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace' }}>
                      {typeof cacheData.data === 'string'
                        ? cacheData.data.substring(0, 200) + (cacheData.data.length > 200 ? '...' : '')
                        : JSON.stringify(cacheData.data, null, 2).substring(0, 200) + (JSON.stringify(cacheData.data).length > 200 ? '...' : '')}
                    </pre>
                  </div>
                </div>
              ) : (
                <Text size="xs" c="dimmed" style={{ fontSize: 9, color: '#888', fontStyle: 'italic' }}>
                  No cached data yet
                </Text>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// Tools configuration component with grouped checkboxes
function ToolsConfig({ config, onConfigChange }: { config: any; onConfigChange: (patch: any) => void }) {
  const [availableTools, setAvailableTools] = useState<Array<{ name: string; description: string; category?: string }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadTools = async () => {
      try {
        const tools = await window.flows?.getTools()
        setAvailableTools(tools || [])
      } catch (e) {
        console.error('Failed to load tools:', e)
      } finally {
        setLoading(false)
      }
    }
    loadTools()
  }, [])

  // Group tools by category provided by main store (fallback to heuristics)
  const groupedTools = useMemo(() => {
    const groups: Record<string, Array<{ name: string; description: string; category?: string }>> = {}
    availableTools.forEach(tool => {
      const n = tool.name || ''
      const lc = n.toLowerCase()
      const cat = tool.category
        || (n === 'knowledgeBaseStore' || n === 'knowledgeBaseSearch' ? 'workspace'
        : n.startsWith('fs') ? 'fs'
        : n.startsWith('agent') ? 'agent'
        : n.startsWith('workspace') || n.startsWith('knowledgeBase') ? 'workspace'
        : n.startsWith('terminal') || n.startsWith('session') ? 'terminal'
        : lc.includes('applyedits') || lc.includes('patch') ? 'edits'
        : lc.includes('grep') || lc.includes('search') ? 'index'
        : lc.includes('ast') || n.startsWith('replace') ? 'code'
        : 'other')
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(tool)
    })
    return groups
  }, [availableTools])

  const isAuto = config.tools === 'auto'
  const selectedTools = Array.isArray(config.tools) ? config.tools : []

  const handleAutoToggle = () => {
    if (isAuto) {
      onConfigChange({ tools: [] })
    } else {
      onConfigChange({ tools: 'auto' })
    }
  }

  const handleToolToggle = (toolName: string) => {
    if (isAuto) return // Can't toggle individual tools in auto mode

    const newSelected = selectedTools.includes(toolName)
      ? selectedTools.filter((t: string) => t !== toolName)
      : [...selectedTools, toolName]

    onConfigChange({ tools: newSelected })
  }

  const handleGroupToggle = (groupName: string) => {
    if (isAuto) return

    const groupTools = groupedTools[groupName].map(t => t.name)
    const allSelected = groupTools.every(t => selectedTools.includes(t))

    if (allSelected) {
      // Deselect all in group
      onConfigChange({ tools: selectedTools.filter((t: string) => !groupTools.includes(t)) })
    } else {
      // Select all in group
      const newSelected = [...new Set([...selectedTools, ...groupTools])]
      onConfigChange({ tools: newSelected })
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 10, background: '#1e1e1e', borderTop: '1px solid #333' }}>
        <Text size="xs" c="dimmed">Loading tools...</Text>
      </div>
    )
  }

  const groupLabels: Record<string, string> = {
    agent: '🤖 Agent (Self-regulation)',
    fs: '📁 Filesystem',
    edits: '✏️ Code Editing',
    index: '🔍 Search',
    terminal: '💻 Terminal',
    code: '🔧 Code Analysis',
    workspace: '🗂️ Workspace',
    other: '📦 Other',
  }

  return (
    <div className="nodrag" style={{ padding: 10, background: '#1e1e1e', borderTop: '1px solid #333', fontSize: 11 }}>
      <Text size="xs" c="dimmed" style={{ fontSize: 9, lineHeight: 1.3, marginBottom: 8 }}>
        🔧 Provides tools to the LLM. Select "Auto" for all tools, or choose specific tools below.
      </Text>

      <Checkbox
        label="Auto (All Tools)"
        checked={isAuto}
        onChange={handleAutoToggle}
        size="xs"
        styles={{
          root: { marginBottom: 12 },
          label: { fontSize: 11, fontWeight: 600, color: '#e0e0e0' },
        }}
      />

      {!isAuto && (
        <Accordion
          variant="separated"
          styles={{
            root: { background: 'transparent' },
            item: { background: '#252526', border: '1px solid #3e3e42', marginBottom: 4 },
            control: { padding: '6px 8px', fontSize: 10 },
            label: { fontSize: 10, fontWeight: 600 },
            content: { padding: '4px 8px' },
          }}
        >
          {Object.entries(groupedTools).map(([groupName, tools]) => {
            const allSelected = tools.every(t => selectedTools.includes(t.name))
            const someSelected = tools.some(t => selectedTools.includes(t.name))

            return (
              <Accordion.Item key={groupName} value={groupName}>
                <Accordion.Control>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected && !allSelected}
                      onChange={() => handleGroupToggle(groupName)}
                      size="xs"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span>{groupLabels[groupName] || groupName}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 9, color: '#888' }}>
                      {tools.filter(t => selectedTools.includes(t.name)).length}/{tools.length}
                    </span>
                  </div>
                </Accordion.Control>
                <Accordion.Panel>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {tools.map(tool => (
                      <Checkbox
                        key={tool.name}
                        label={
                          <div style={{ fontSize: 9 }}>
                            <div style={{ fontWeight: 500, color: '#e0e0e0' }}>{tool.name}</div>
                            <div style={{ color: '#888', marginTop: 2 }}>{tool.description}</div>
                          </div>
                        }
                        checked={selectedTools.includes(tool.name)}
                        onChange={() => handleToolToggle(tool.name)}
                        size="xs"
                        styles={{
                          root: { marginBottom: 4 },
                          body: { alignItems: 'flex-start' },
                        }}
                      />
                    ))}
                  </div>
                </Accordion.Panel>
              </Accordion.Item>
            )
          })}
        </Accordion>
      )}

      {!isAuto && (
        <Text size="xs" c="dimmed" style={{ fontSize: 9, marginTop: 8 }}>
          Selected: {selectedTools.length} tool{selectedTools.length !== 1 ? 's' : ''}
        </Text>
      )}
    </div>
  )
}

