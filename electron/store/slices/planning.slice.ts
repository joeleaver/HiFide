/**
 * Planning Slice
 * 
 * Manages approved plans and plan execution.
 * 
 * Responsibilities:
 * - Approved plan state
 * - Plan persistence (save/load)
 * - Plan execution (first step, autonomous)
 * - Plan step tracking
 * 
 * Dependencies:
 * - Session slice (for getCurrentMessages, currentId)
 * - Provider slice (for selectedModel, selectedProvider)
 * - Settings slice (for autoApproveEnabled, autoApproveThreshold)
 * - Debug slice (for addDebugLog)
 */

import type { StateCreator } from 'zustand'
import type { ApprovedPlan } from '../types'

// ============================================================================
// Types
// ============================================================================

export interface PlanningSlice {
  // State
  approvedPlan: ApprovedPlan | null
  
  // Actions
  setApprovedPlan: (plan: ApprovedPlan | null) => void
  saveApprovedPlan: () => Promise<{ ok: boolean } | undefined>
  loadApprovedPlan: () => Promise<{ ok: boolean } | undefined>
  executeApprovedPlanFirstStep: () => Promise<void>
  executeApprovedPlanAutonomous: () => Promise<void>
}

// ============================================================================
// Slice Creator
// ============================================================================

export const createPlanningSlice: StateCreator<PlanningSlice, [], [], PlanningSlice> = (set, get) => ({
  // State
  approvedPlan: null,
  
  // Actions
  setApprovedPlan: (plan: ApprovedPlan | null) => {
    set({ approvedPlan: plan })
  },
  
  saveApprovedPlan: async () => {
    try {
      const plan = get().approvedPlan
      const res = await window.planning?.saveApproved?.(plan)
      
      const state = get() as any
      if (!res?.ok) {
        if (state.addDebugLog) {
          state.addDebugLog('error', 'Planning', 'Failed to save ApprovedPlan', res)
        }
      } else {
        if (state.addDebugLog) {
          state.addDebugLog('info', 'Planning', 'ApprovedPlan saved')
        }
      }
      
      return res
    } catch (e) {
      const state = get() as any
      if (state.addDebugLog) {
        state.addDebugLog('error', 'Planning', 'Error saving ApprovedPlan', { error: String(e) })
      }
      console.error('[planning] Save error:', e)
    }
  },
  
  loadApprovedPlan: async () => {
    try {
      const res = await window.planning?.loadApproved?.()
      
      if (res?.ok) {
        set({ approvedPlan: (res as any)?.plan ?? null })
      } else {
        const state = get() as any
        if (state.addDebugLog) {
          state.addDebugLog('error', 'Planning', 'Failed to load ApprovedPlan', res)
        }
      }
      
      return res
    } catch (e) {
      const state = get() as any
      if (state.addDebugLog) {
        state.addDebugLog('error', 'Planning', 'Error loading ApprovedPlan', { error: String(e) })
      }
      console.error('[planning] Load error:', e)
    }
  },
  
  executeApprovedPlanFirstStep: async () => {
    const plan = get().approvedPlan
    
    if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      const state = get() as any
      if (state.addDebugLog) {
        state.addDebugLog('warning', 'Planning', 'No ApprovedPlan or steps to execute')
      }
      return
    }
    
    const first = plan.steps[0]
    const rid = crypto.randomUUID()
    
    // Get state from other slices
    const state = get() as any
    const selectedModel = state.selectedModel || 'gpt-4'
    const selectedProvider = state.selectedProvider || 'openai'
    const autoApproveEnabled = state.autoApproveEnabled ?? false
    const autoApproveThreshold = state.autoApproveThreshold ?? 0.5
    
    const autoEnabled = plan.autoApproveEnabled ?? autoApproveEnabled
    const autoThresh = typeof plan.autoApproveThreshold === 'number' ? plan.autoApproveThreshold : autoApproveThreshold
    
    const sys1 = 'EXECUTION MODE. Execute exactly the indicated step then stop and report. Verify per plan. Respect auto-approve policy.'
    const sys2 = `ApprovedPlan:\n\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``
    const user = `Execute exactly step ${first.id} only. Stop after verification with a brief report.`
    
    // Set current request ID (from session slice)
    if (state.currentRequestId !== undefined) {
      const sessionState = state as any
      sessionState.currentRequestId = rid
      sessionState.streamingText = ''
      sessionState.chunkStats = { count: 0, totalChars: 0 }
      sessionState.retryCount = 0
    }
    
    if (state.addDebugLog) {
      state.addDebugLog('info', 'LLM', `Executing ApprovedPlan first step (${first.id}) via tools`, {
        requestId: rid,
        provider: selectedProvider,
        model: selectedModel,
      })
    }
    
    
    const msgs = [
      { role: 'system' as const, content: sys1 + ` AutoApprove: enabled=${autoEnabled} threshold=${autoThresh}.` },
      { role: 'system' as const, content: sys2 },
      ...(state.getCurrentMessages ? state.getCurrentMessages() : []),
      { role: 'user' as const, content: user },
    ]
    
    try {
      const res = await window.llm?.agentStart?.(
        rid,
        msgs,
        selectedModel,
        selectedProvider,
        undefined,
        undefined,
        state.currentId || undefined
      )
      
      try {
        if (state.pushRouteRecord) {
          state.pushRouteRecord({
            requestId: rid,
            mode: 'tools',
            provider: selectedProvider,
            model: selectedModel,
            timestamp: Date.now(),
          })
        }
      } catch {}
      
      if (!res?.ok && state.addDebugLog) {
        state.addDebugLog('error', 'LLM', 'agentStart failed for ApprovedPlan execution', res)
      }
    } catch (e) {
      if (state.addDebugLog) {
        state.addDebugLog('error', 'LLM', 'agentStart threw for ApprovedPlan execution', { error: String(e) })
      }
      
      if (state.currentRequestId !== undefined) {
        const sessionState = state as any
        sessionState.currentRequestId = null
      }
      
      console.error('[planning] Execute first step error:', e)
    }
  },
  
  executeApprovedPlanAutonomous: async () => {
    const plan = get().approvedPlan
    
    if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      const state = get() as any
      if (state.addDebugLog) {
        state.addDebugLog('warning', 'Planning', 'No ApprovedPlan or steps to execute')
      }
      return
    }
    
    const rid = crypto.randomUUID()
    
    // Get state from other slices
    const state = get() as any
    const selectedModel = state.selectedModel || 'gpt-4'
    const selectedProvider = state.selectedProvider || 'openai'
    const autoApproveEnabled = state.autoApproveEnabled ?? false
    const autoApproveThreshold = state.autoApproveThreshold ?? 0.5
    
    const autoEnabled = plan.autoApproveEnabled ?? autoApproveEnabled
    const autoThresh = typeof plan.autoApproveThreshold === 'number' ? plan.autoApproveThreshold : autoApproveThreshold
    
    const sys1 = [
      'EXECUTION MODE. Execute the ApprovedPlan steps in order, autonomously.',
      'After each step: run Verify, summarize the result briefly.',
      'If verification passes, proceed to the next step automatically.',
      'If verification fails or you detect risk beyond auto-approve policy, STOP and report.',
      'Respect auto-approve policy for risky operations; ask only when required.',
    ].join(' ')
    
    const sys2 = `ApprovedPlan:\n\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``
    const user = 'Begin executing the plan from the first step and continue through all steps unless verification fails. Keep outputs concise.'
    
    // Set current request ID (from session slice)
    if (state.currentRequestId !== undefined) {
      const sessionState = state as any
      sessionState.currentRequestId = rid
      sessionState.streamingText = ''
      sessionState.chunkStats = { count: 0, totalChars: 0 }
      sessionState.retryCount = 0
    }
    
    if (state.addDebugLog) {
      state.addDebugLog('info', 'LLM', 'Executing ApprovedPlan autonomously via tools', {
        requestId: rid,
        provider: selectedProvider,
        model: selectedModel,
      })
    }
    
    
    const msgs = [
      { role: 'system' as const, content: sys1 + ` AutoApprove: enabled=${autoEnabled} threshold=${autoThresh}.` },
      { role: 'system' as const, content: sys2 },
      ...(state.getCurrentMessages ? state.getCurrentMessages() : []),
      { role: 'user' as const, content: user },
    ]
    
    try {
      const res = await window.llm?.agentStart?.(
        rid,
        msgs,
        selectedModel,
        selectedProvider,
        undefined,
        undefined,
        state.currentId || undefined
      )
      
      try {
        if (state.pushRouteRecord) {
          state.pushRouteRecord({
            requestId: rid,
            mode: 'tools',
            provider: selectedProvider,
            model: selectedModel,
            timestamp: Date.now(),
          })
        }
      } catch {}
      
      if (!res?.ok && state.addDebugLog) {
        state.addDebugLog('error', 'LLM', 'agentStart failed for autonomous ApprovedPlan execution', res)
      }
    } catch (e) {
      if (state.addDebugLog) {
        state.addDebugLog('error', 'LLM', 'agentStart threw for autonomous ApprovedPlan execution', { error: String(e) })
      }
      
      if (state.currentRequestId !== undefined) {
        const sessionState = state as any
        sessionState.currentRequestId = null
      }
      
      console.error('[planning] Execute autonomous error:', e)
    }
  },
})

