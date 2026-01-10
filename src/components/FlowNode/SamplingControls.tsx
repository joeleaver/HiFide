/**
 * SamplingControls - Provider-agnostic sampling and reasoning controls
 *
 * Features:
 * - Normalized temperature (0-1) that maps to provider-specific ranges at runtime
 * - Reasoning effort (low/medium/high) for OpenAI o1/o3 models
 * - Extended thinking with budget for Gemini 2.5+ and Claude 3.5+
 * - Model-specific overrides: unlimited rows with model chooser
 */
import React from 'react'
import { supportsReasoningEffort, supportsExtendedThinking, getProviderFromModel } from '../../../shared/model-capabilities'

/** Model override entry */
export interface ModelOverride {
  model: string
  temperature?: number      // Raw value (not normalized) for this specific model
  reasoningEffort?: 'low' | 'medium' | 'high'
  includeThoughts?: boolean
  thinkingBudget?: number
  /** Gemini only: 'explicit' (default, guaranteed savings) or 'implicit' (automatic caching) */
  geminiCacheMode?: 'explicit' | 'implicit'
  /** Gemini explicit cache: token threshold for mid-loop cache rebuild (default: 500) */
  geminiCacheRefreshThreshold?: number
}

interface SamplingControlsProps {
  config: Record<string, any>
  onConfigChange: (updates: Record<string, any>) => void
  /** All available models grouped by provider */
  modelsByProvider: Record<string, Array<{ value: string; label: string }>>
  /** Prefix for config keys (e.g., 'override' for overrideTemperature) */
  prefix?: string
}

const inputStyle: React.CSSProperties = {
  padding: '2px 4px',
  background: '#252526',
  color: '#cccccc',
  border: '1px solid #3e3e42',
  borderRadius: 3,
  fontSize: 10,
}

const selectStyle: React.CSSProperties = {
  padding: '4px 6px',
  background: '#252526',
  color: '#cccccc',
  border: '1px solid #3e3e42',
  borderRadius: 3,
  fontSize: 10,
}

const hintStyle: React.CSSProperties = {
  fontSize: 9,
  color: '#666',
  fontStyle: 'italic',
  marginTop: 2,
}

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
}

/** Compute display values for normalized temperature */
function computeTempPreview(normalized: number | undefined): string {
  if (normalized === undefined || normalized === null) return ''
  const openai = (normalized * 2).toFixed(1)
  const anthropic = Math.min(normalized, 1).toFixed(1)
  return `→ OpenAI/Gemini: ${openai} | Anthropic: ${anthropic}`
}



export const SamplingControls: React.FC<SamplingControlsProps> = ({
  config,
  onConfigChange,
  modelsByProvider,
  prefix = '',
}) => {
  const key = (name: string) => prefix ? `${prefix}${name.charAt(0).toUpperCase()}${name.slice(1)}` : name
  const get = (name: string) => config[key(name)]
  const set = (name: string, value: any) => onConfigChange({ [key(name)]: value })

  // Determine the effective provider for the main controls
  const effectiveModel = prefix === 'override' ? config.overrideModel : config.model
  const effectiveProvider = prefix === 'override' ? config.overrideProvider : config.provider
  const detectedProvider = getProviderFromModel(effectiveModel)
  
  // Use the explicitly selected provider if the heuristic fails or if it's openrouter
  const provider = (effectiveProvider === 'openrouter' || detectedProvider === 'unknown') 
    ? (effectiveProvider || detectedProvider) 
    : detectedProvider

  const modelOverrides: ModelOverride[] = get('modelOverrides') || []

  // Flatten all models for the chooser
  const allModels = React.useMemo(() => {
    const result: Array<{ value: string; label: string; provider: string }> = []
    for (const [provider, models] of Object.entries(modelsByProvider)) {
      for (const m of models) {
        result.push({ ...m, provider })
      }
    }
    return result.sort((a, b) => a.label.localeCompare(b.label))
  }, [modelsByProvider])

  const addOverride = () => {
    const firstModel = allModels[0]?.value || ''
    set('modelOverrides', [...modelOverrides, { model: firstModel }])
  }

  const updateOverride = (index: number, updates: Partial<ModelOverride>) => {
    const updated = [...modelOverrides]
    updated[index] = { ...updated[index], ...updates }
    set('modelOverrides', updated)
  }

  const removeOverride = (index: number) => {
    set('modelOverrides', modelOverrides.filter((_, i) => i !== index))
  }

  const tempPreview = computeTempPreview(get('temperature'))
  const showMainTemp = provider && provider !== 'unknown'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Normalized Temperature */}
      {showMainTemp && (
        <div style={sectionStyle}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cccccc' }}>
            <span style={{ fontSize: 10, color: '#888', width: 90 }}>Temperature:</span>
            <input
              type="number"
              step="0.05"
              min={0}
              max={1}
              value={(get('temperature') ?? '') as any}
              onChange={(e) => {
                const v = e.target.value
                const num = parseFloat(v)
                set('temperature', Number.isFinite(num) ? Math.max(0, Math.min(1, num)) : undefined)
              }}
              placeholder="0–1"
              style={{ ...inputStyle, flex: 1 }}
            />
          </label>
          {tempPreview && <span style={hintStyle}>{tempPreview}</span>}
          <span style={hintStyle}>Normalized 0-1 scale, mapped to provider ranges at runtime</span>
        </div>
      )}

      {/* Reasoning Effort */}
      <div style={sectionStyle}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cccccc' }}>
          <span style={{ fontSize: 10, color: '#888', width: 90 }}>Reasoning effort:</span>
          <select
            value={get('reasoningEffort') || ''}
            onChange={(e) => set('reasoningEffort', e.target.value || undefined)}
            style={{ ...selectStyle, flex: 1 }}
          >
            <option value="">Default</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <span style={hintStyle}>Applies to: OpenAI o1/o3 models</span>
      </div>

      {/* Extended Thinking */}
      {supportsExtendedThinking(effectiveModel || '') && (
      <div style={sectionStyle}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cccccc' }}>
          <input
            type="checkbox"
            checked={!!get('includeThoughts')}
            onChange={(e) => {
              const checked = e.currentTarget.checked
              if (checked && (get('thinkingBudget') === undefined || get('thinkingBudget') === null)) {
                onConfigChange({ [key('includeThoughts')]: true, [key('thinkingBudget')]: 2048 })
              } else {
                set('includeThoughts', checked)
              }
            }}
          />
          <span style={{ fontSize: 10 }}>Extended thinking</span>
        </label>
        {!!get('includeThoughts') && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cccccc', marginLeft: 20 }}>
            <span style={{ fontSize: 10, color: '#888', width: 70 }}>Budget:</span>
            <input
              type="number"
              min={-1}
              value={(get('thinkingBudget') ?? 2048) as any}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                set('thinkingBudget', Number.isFinite(v) ? v : undefined)
              }}
              placeholder="2048"
              style={{ ...inputStyle, width: 80 }}
            />
            <span style={{ fontSize: 9, color: '#666' }}>tokens (-1 = unlimited)</span>
          </label>
        )}
        <span style={hintStyle}>Applies to: Gemini 2.5+, Claude 3.5+ Sonnet / 3.7+ / 4+</span>
      </div>
      )}

      {/* Gemini Cache Mode */}
      {provider === 'gemini' && (
      <div style={sectionStyle}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cccccc' }}>
          <span style={{ fontSize: 10, color: '#888', width: 90 }}>Cache mode:</span>
          <select
            value={get('geminiCacheMode') || 'explicit'}
            onChange={(e) => set('geminiCacheMode', e.target.value as 'explicit' | 'implicit')}
            style={{ ...selectStyle, flex: 1 }}
          >
            <option value="explicit">Explicit (guaranteed savings)</option>
            <option value="implicit">Implicit (automatic)</option>
          </select>
        </label>
        {(get('geminiCacheMode') || 'explicit') === 'explicit' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cccccc', marginTop: 4 }}>
            <span style={{ fontSize: 10, color: '#888', width: 90 }}>Refresh threshold:</span>
            <input
              type="number"
              min={100}
              step={100}
              value={get('geminiCacheRefreshThreshold') ?? 500}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                set('geminiCacheRefreshThreshold', Number.isFinite(v) && v > 0 ? v : undefined)
              }}
              placeholder="500"
              style={{ ...inputStyle, width: 70 }}
            />
            <span style={{ fontSize: 9, color: '#666' }}>tokens</span>
          </label>
        )}
        <span style={hintStyle}>Explicit: 75-90% savings guaranteed. Implicit: probabilistic caching by Gemini.</span>
      </div>
      )}

      {/* Model-Specific Overrides */}
      <div style={{ borderTop: '1px solid #3e3e42', paddingTop: 10 }}>
        <div style={{ fontSize: 10, color: '#888', marginBottom: 6, fontWeight: 600 }}>
          Model-Specific Overrides
        </div>

        {modelOverrides.map((override, idx) => {
          const provider = getProviderFromModel(override.model)
          const showReasoningEffort = supportsReasoningEffort(override.model)
          const showThinking = supportsExtendedThinking(override.model)
          // Always show temperature for anything that looks like a valid override, 
          // or if we identified a known provider.
          const showTemp = provider !== 'unknown' || override.model.includes(':') || override.model.length > 0

          return (
            <div
              key={idx}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: 6,
                marginBottom: 6,
                background: '#1e1e1e',
                borderRadius: 4,
                border: '1px solid #3e3e42',
              }}
            >
              {/* Model chooser row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <select
                  value={override.model}
                  onChange={(e) => updateOverride(idx, { model: e.target.value })}
                  style={{ ...selectStyle, flex: 1 }}
                >
                  {allModels.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.provider}: {m.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => removeOverride(idx)}
                  style={{
                    padding: '2px 6px',
                    background: '#3e3e42',
                    color: '#cccccc',
                    border: 'none',
                    borderRadius: 3,
                    cursor: 'pointer',
                    fontSize: 10,
                  }}
                  title="Remove override"
                >
                  ×
                </button>
              </div>

              {/* Override fields based on model capabilities */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                {showTemp && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#cccccc' }}>
                    <span style={{ fontSize: 9, color: '#888' }}>Temp:</span>
                    <input
                      type="number"
                      step="0.1"
                      min={0}
                      max={(provider === 'anthropic' || provider === 'openrouter') ? 1 : 2}
                      value={override.temperature ?? ''}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value)
                        updateOverride(idx, { temperature: Number.isFinite(v) ? v : undefined })
                      }}
                      placeholder={(provider === 'anthropic' || provider === 'openrouter') ? '0-1' : '0-2'}
                      style={{ ...inputStyle, width: 50 }}
                    />
                  </label>
                )}

                {showReasoningEffort && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#cccccc' }}>
                    <span style={{ fontSize: 9, color: '#888' }}>Effort:</span>
                    <select
                      value={override.reasoningEffort || ''}
                      onChange={(e) => updateOverride(idx, {
                        reasoningEffort: (e.target.value || undefined) as any
                      })}
                      style={{ ...selectStyle, width: 70 }}
                    >
                      <option value="">—</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </label>
                )}

                {showThinking && (
                  <>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#cccccc' }}>
                      <input
                        type="checkbox"
                        checked={override.includeThoughts ?? false}
                        onChange={(e) => updateOverride(idx, { includeThoughts: e.target.checked })}
                      />
                      <span style={{ fontSize: 9 }}>Think</span>
                    </label>
                    {override.includeThoughts && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#cccccc' }}>
                        <span style={{ fontSize: 9, color: '#888' }}>Budget:</span>
                        <input
                          type="number"
                          min={-1}
                          value={override.thinkingBudget ?? ''}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10)
                            updateOverride(idx, { thinkingBudget: Number.isFinite(v) ? v : undefined })
                          }}
                          placeholder="2048"
                          style={{ ...inputStyle, width: 60 }}
                        />
                      </label>
                    )}
                  </>
                )}

                {provider === 'gemini' && (
                  <>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#cccccc' }}>
                      <span style={{ fontSize: 9, color: '#888' }}>Cache:</span>
                      <select
                        value={override.geminiCacheMode || 'explicit'}
                        onChange={(e) => updateOverride(idx, {
                          geminiCacheMode: e.target.value as 'explicit' | 'implicit'
                        })}
                        style={{ ...selectStyle, width: 80 }}
                      >
                        <option value="explicit">Explicit</option>
                        <option value="implicit">Implicit</option>
                      </select>
                    </label>
                    {(override.geminiCacheMode || 'explicit') === 'explicit' && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#cccccc' }}>
                        <span style={{ fontSize: 9, color: '#888' }}>Refresh:</span>
                        <input
                          type="number"
                          min={100}
                          step={100}
                          value={override.geminiCacheRefreshThreshold ?? ''}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10)
                            updateOverride(idx, { geminiCacheRefreshThreshold: Number.isFinite(v) && v > 0 ? v : undefined })
                          }}
                          placeholder="500"
                          style={{ ...inputStyle, width: 50 }}
                        />
                      </label>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}

        <button
          onClick={addOverride}
          style={{
            padding: '4px 8px',
            background: '#0e639c',
            color: '#ffffff',
            border: 'none',
            borderRadius: 3,
            cursor: 'pointer',
            fontSize: 10,
          }}
        >
          + Add model override
        </button>
      </div>
    </div>
  )
}

