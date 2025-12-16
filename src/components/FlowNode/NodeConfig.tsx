import { useMemo } from 'react'
import InjectMessagesConfig from './InjectMessagesConfig'
import { useFlowEditorLocal } from '../../store/flowEditorLocal'
import { useSessionUi, type ProviderOption, type SessionUiState } from '../../store/sessionUi'
import { DefaultContextConfig } from './configSections/DefaultContextConfig'
import { ManualInputConfig, UserInputInfo } from './configSections/ManualAndUserConfig'
import { ReadFileConfig } from './configSections/ReadFileConfig'
import { NewContextConfig } from './configSections/NewContextConfig'
import { PortalInputConfig, PortalOutputConfig } from './configSections/PortalConfigs'
import { ApprovalGateConfig, BudgetGuardConfig } from './configSections/GuardConfigs'
import { LLMRequestConfig } from './configSections/LLMRequestConfig'
import { RedactorConfig, ErrorDetectionConfig } from './configSections/ModerationConfigs'
import { IntentRouterConfig } from './configSections/IntentRouterConfig'
import { ExtractMemoriesConfig } from './configSections/ExtractMemoriesConfig'
import { CacheConfig } from './configSections/CacheConfig'
import { ToolsConfig } from './configSections/ToolsConfig'

interface NodeConfigProps {
  nodeId: string
  nodeType: string
  config: any
  onConfigChange: (patch: any) => void
}

export default function NodeConfig({ nodeId, nodeType, config, onConfigChange }: NodeConfigProps) {
  const nodes = useFlowEditorLocal((s) => s.nodes)
  const edges = useFlowEditorLocal((s) => s.edges)
  const { providerOptions, modelsByProvider, sessionProvider, sessionModel } = useProviderSnapshot()

  const isSysInConnected = useMemo(() => (
    edges.some((e: any) => e.target === nodeId && e.targetHandle === 'systemInstructionsIn')
  ), [edges, nodeId])

  return (
    <div className="nodrag" style={wrapperStyle}>
      {nodeType === 'defaultContextStart' && (
        <DefaultContextConfig
          config={config}
          onConfigChange={onConfigChange}
          modelsByProvider={modelsByProvider}
          isSysInConnected={isSysInConnected}
        />
      )}

      {nodeType === 'userInput' && <UserInputInfo />}

      {nodeType === 'manualInput' && (
        <ManualInputConfig config={config} onConfigChange={onConfigChange} />
      )}

      {nodeType === 'readFile' && (
        <ReadFileConfig config={config} onConfigChange={onConfigChange} />
      )}

      {nodeType === 'injectMessages' && (
        <InjectMessagesConfig nodeId={nodeId} config={config} onConfigChange={onConfigChange} />
      )}

      {nodeType === 'tools' && (
        <ToolsConfig config={config} onConfigChange={onConfigChange} />
      )}

      {nodeType === 'newContext' && (
        <NewContextConfig
          config={config}
          onConfigChange={onConfigChange}
          providerOptions={providerOptions}
          modelsByProvider={modelsByProvider}
          isSysInConnected={isSysInConnected}
        />
      )}

      {nodeType === 'portalInput' && (
        <PortalInputConfig
          nodeId={nodeId}
          config={config}
          onConfigChange={onConfigChange}
          nodes={nodes}
        />
      )}

      {nodeType === 'portalOutput' && (
        <PortalOutputConfig config={config} onConfigChange={onConfigChange} />
      )}

      {nodeType === 'approvalGate' && (
        <ApprovalGateConfig config={config} onConfigChange={onConfigChange} />
      )}

      {nodeType === 'budgetGuard' && (
        <BudgetGuardConfig config={config} onConfigChange={onConfigChange} />
      )}

      {nodeType === 'llmRequest' && (
        <LLMRequestConfig
          nodeId={nodeId}
          config={config}
          edges={edges}
          providerOptions={providerOptions}
          modelsByProvider={modelsByProvider}
          sessionProvider={sessionProvider}
          sessionModel={sessionModel}
          onConfigChange={onConfigChange}
        />
      )}

      {nodeType === 'redactor' && (
        <RedactorConfig config={config} onConfigChange={onConfigChange} />
      )}

      {nodeType === 'errorDetection' && (
        <ErrorDetectionConfig config={config} onConfigChange={onConfigChange} />
      )}

      {nodeType === 'intentRouter' && (
        <IntentRouterConfig
          config={config}
          onConfigChange={onConfigChange}
          providerOptions={providerOptions}
          modelOptions={modelsByProvider}
        />
      )}

      {nodeType === 'extractMemories' && (
        <ExtractMemoriesConfig
          config={config}
          onConfigChange={onConfigChange}
          providerOptions={providerOptions}
          modelOptions={modelsByProvider}
        />
      )}

      {nodeType === 'cache' && (
        <CacheConfig nodeId={nodeId} config={config} onConfigChange={onConfigChange} />
      )}


    </div>
  )
}

function useProviderSnapshot() {
  const providerValid = useSessionUi((s: SessionUiState) => s.providerValid || {})
  const modelsByProvider = useSessionUi((s: SessionUiState) => s.modelsByProvider || {})
  const sessionProvider = useSessionUi((s: SessionUiState) => s.providerId)
  const sessionModel = useSessionUi((s: SessionUiState) => s.modelId)

  const providerOptions = useMemo<ProviderOption[]>(() => (
    Object.entries(providerValid)
      .filter(([, ok]) => !!ok)
      .map(([id]) => ({ value: id, label: id.charAt(0).toUpperCase() + id.slice(1) }))
  ), [providerValid])

  return { providerOptions, modelsByProvider, sessionProvider, sessionModel }
}

const wrapperStyle = {
  padding: 10,
  background: '#1e1e1e',
  borderTop: '1px solid #333',
  fontSize: 11,
  overflow: 'hidden',
  wordWrap: 'break-word' as const,
}
