import { createEventEmitter } from './execution-events'
import { emitFlowEvent } from './events'
import type { FlowAPI, Badge, UsageReport, Tool } from './flow-api'
import { getAgentToolSnapshot } from '../tools/agentToolRegistry.js'
import type { AgentTool } from '../providers/provider'
import type { ContextBinding, ContextRegistry } from './contextRegistry'
import type { CreateIsolatedContextOptions } from './context-options'
import type { ExecutionEventRouter } from './execution-event-router'
import type { MainFlowContext } from './types'

export interface FlowApiFactoryDeps {
  requestId: string
  workspaceId?: string
  sessionId?: string
  abortController: AbortController
  contextRegistry: ContextRegistry
  portalRegistry: Map<string, { context?: MainFlowContext; data?: any }>
  userInputResolvers: Map<string, (value: string | MessagePart[]) => void>
  executionEventRouter: ExecutionEventRouter
  triggerPortalOutputs: (portalId: string) => Promise<void>
  setPausedNodeId: (nodeId: string | null) => void
  createIsolatedContext: (options: CreateIsolatedContextOptions, activeBinding: ContextBinding) => MainFlowContext
  releaseContext: (contextId: string) => boolean
}

export interface FlowApiFactoryParams {
  nodeId: string
  executionId: string
  binding: ContextBinding
}

export type FlowApiFactory = (params: FlowApiFactoryParams) => FlowAPI

export function createFlowApiFactory(deps: FlowApiFactoryDeps): FlowApiFactory {
  const {
    requestId,
    workspaceId,
    sessionId,
    abortController,
    contextRegistry,
    portalRegistry,
    userInputResolvers,
    executionEventRouter,
    triggerPortalOutputs,
    setPausedNodeId,
    createIsolatedContext,
    releaseContext,
  } = deps

  return ({ nodeId, executionId, binding }) => {
    if (!nodeId) {
      console.error('[FlowScheduler] createFlowAPI called with missing nodeId!', { executionId })
    }

    const emit = createEventEmitter(executionId, nodeId, (event) => {
      void executionEventRouter(event)
    })

    const contextsHelper = buildContextsHelper({
      contextRegistry,
      binding,
      createIsolatedContext,
      releaseContext,
      nodeId,
    })

    const flowAPI: FlowAPI = {
      nodeId,
      requestId,
      executionId,
      workspaceId,
      signal: abortController.signal,
      checkCancelled: () => {
        if (abortController.signal.aborted) {
          throw new Error('Flow execution cancelled')
        }
      },
      emitExecutionEvent: emit,
      store: {},
      context: binding.manager,
      contexts: contextsHelper,
      conversation: {
        streamChunk: (chunk: string) => {
          emit({ type: 'chunk', provider: 'unknown', model: 'unknown', chunk })
        },
        addBadge: (badge: Badge) => {
          const badgeId = `badge-${crypto.randomUUID()}`
          emit({
            type: 'badge_add',
            provider: 'unknown',
            model: 'unknown',
            badge: { badgeId, data: badge }
          })
          return badgeId
        },
        updateBadge: (badgeId: string, updates: Partial<Badge>) => {
          emit({
            type: 'badge_update',
            provider: 'unknown',
            model: 'unknown',
            badge: { badgeId, data: updates }
          })
        },
      },
      log: {
        debug: (message: string, data?: any) => {
          if (process.env.HF_FLOW_DEBUG === '1') console.log(`[Flow Debug] ${nodeId}:`, message, data)
        },
        info: (message: string, data?: any) => {
          if (process.env.HF_FLOW_DEBUG === '1') console.log(`[Flow Info] ${nodeId}:`, message, data)
        },
        warn: (message: string, data?: any) => console.warn(`[Flow Warn] ${nodeId}:`, message, data),
        error: (message: string, data?: any) => console.error(`[Flow Error] ${nodeId}:`, message, data),
      },
      tools: {
        execute: async (toolName: string, args: any) => {
          if (process.env.HF_FLOW_DEBUG === '1') console.log(`[Tool] ${nodeId}: ${toolName}`, args)
          const snapshot = getAgentToolSnapshot(workspaceId)
          const tool = snapshot.find((t) => t.name === toolName)
          if (!tool) {
            throw new Error(`Tool not found: ${toolName}`)
          }
          return tool.run(args, { requestId, workspaceId, flowAPI })
        },
        list: (): Tool[] => mapAgentToolsToFlowTools(getAgentToolSnapshot(workspaceId)),
      },
      usage: {
        report: (usage: UsageReport) => {
          if (process.env.HF_FLOW_DEBUG === '1') console.log(`[Usage] ${nodeId}:`, usage)
        },
      },
      waitForUserInput: async (prompt?: string) => {
        if (process.env.HF_FLOW_DEBUG === '1') console.log('[FlowAPI.waitForUserInput] Waiting for input, nodeId:', nodeId, 'prompt:', prompt)
        try {
          emitFlowEvent(requestId, { type: 'waitingforinput', nodeId, sessionId, prompt })
        } catch {}
        try {
          setPausedNodeId(nodeId)
        } catch {}

        const userInput = await new Promise<string | MessagePart[]>((resolve, reject) => {
          userInputResolvers.set(nodeId, resolve)
          if (abortController.signal.aborted) {
            reject(new Error('Flow execution cancelled'))
            return
          }
          const onAbort = () => {
            reject(new Error('Flow execution cancelled'))
          }
          abortController.signal.addEventListener('abort', onAbort, { once: true })
        })

        userInputResolvers.delete(nodeId)
        return userInput
      },
      triggerPortalOutputs: async (portalId: string) => {
        await triggerPortalOutputs(portalId)
      },
      setPortalData: (portalId: string, context?: MainFlowContext, data?: any) => {
        portalRegistry.set(portalId, { context, data })
      },
      getPortalData: (portalId: string) => {
        return portalRegistry.get(portalId)
      },
    }

    return flowAPI
  }
}

interface ContextsHelperDeps {
  contextRegistry: ContextRegistry
  binding: ContextBinding
  createIsolatedContext: (options: CreateIsolatedContextOptions, activeBinding: ContextBinding) => MainFlowContext
  releaseContext: (contextId: string) => boolean
  nodeId: string
}

function buildContextsHelper(deps: ContextsHelperDeps): FlowAPI['contexts'] {
  const { contextRegistry, binding, createIsolatedContext, releaseContext, nodeId } = deps
  return {
    active: () => contextRegistry.cloneContext(binding.ref.current),
    list: () => contextRegistry.listSnapshots(),
    get: (contextId: string) => contextRegistry.getContextSnapshot(contextId),
    createIsolated: (options) => createIsolatedContext({ ...options, createdByNodeId: nodeId }, binding),
    release: (contextId: string) => releaseContext(contextId),
  }
}

function mapAgentToolsToFlowTools(agentTools: AgentTool[]): Tool[] {
  return agentTools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? '',
    parameters: tool.parameters ?? {},
  }))
}
