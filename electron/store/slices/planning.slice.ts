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
 * - Debug slice (for addDebugLog)
 */

import type { StateCreator } from 'zustand'
import type { ApprovedPlan } from '../types'

import path from 'node:path'
import fs from 'node:fs/promises'

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
      const state = get() as any
      const baseDir = path.resolve(String(state.workspaceRoot || process.cwd()))
      const privateDir = path.join(baseDir, '.hifide-private')
      await fs.mkdir(privateDir, { recursive: true })
      const file = path.join(privateDir, 'approved-plan.json')
      await fs.writeFile(file, JSON.stringify(plan ?? {}, null, 2), 'utf-8')
      if (state.addDebugLog) {
        state.addDebugLog('info', 'Planning', 'ApprovedPlan saved')
      }
      return { ok: true }
    } catch (e) {
      const state = get() as any
      if (state.addDebugLog) {
        state.addDebugLog('error', 'Planning', 'Error saving ApprovedPlan', { error: String(e) })
      }
      console.error('[planning] Save error:', e)
      return { ok: false, error: String(e) }
    }
  },

  loadApprovedPlan: async () => {
    try {
      const state = get() as any
      const baseDir = path.resolve(String(state.workspaceRoot || process.cwd()))
      const file = path.join(baseDir, '.hifide-private', 'approved-plan.json')
      const text = await fs.readFile(file, 'utf-8').catch(() => '')
      if (!text) {
        set({ approvedPlan: null })
        return { ok: true, plan: null }
      }
      try {
        const plan = JSON.parse(text)
        set({ approvedPlan: plan })
        return { ok: true, plan }
      } catch {
        set({ approvedPlan: null })
        return { ok: true, plan: null }
      }
    } catch (e) {
      const state = get() as any
      if (state.addDebugLog) {
        state.addDebugLog('error', 'Planning', 'Error loading ApprovedPlan', { error: String(e) })
      }
      console.error('[planning] Load error:', e)
      return { ok: false, error: String(e) }
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


    const sys1 = 'EXECUTION MODE. Execute exactly the indicated step then stop and report. Verify per plan.'
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

    // Execute via Flow V2: ensure a running flow, then resume with a planning prompt
    try {
      const storeAny = get() as any

      // If no flow execution is active, initialize it (requires nodes loaded)
      if (!storeAny.feRequestId) {
        if (Array.isArray(storeAny.feNodes) && storeAny.feNodes.length > 0 && typeof storeAny.flowInit === 'function') {
          await storeAny.flowInit()
        } else {
          if (state.addDebugLog) {
            state.addDebugLog('warning', 'Planning', 'No flow loaded; cannot execute ApprovedPlan step')
          }
          return
        }
      }

      // Build a single user instruction that embeds plan + policy
      const planningPrompt = [
        sys1,
        sys2,
        user,
      ].join('\n\n')

      if (typeof storeAny.feResume === 'function') {
        await storeAny.feResume({ userInput: planningPrompt })
      } else if (state.addDebugLog) {
        state.addDebugLog('error', 'Planning', 'feResume not available in store')
      }

      try {
        if (state.pushRouteRecord) {
          state.pushRouteRecord({
            requestId: storeAny.feRequestId || rid,
            mode: 'tools',
            provider: selectedProvider,
            model: selectedModel,
            timestamp: Date.now(),
          })
        }
      } catch {}
    } catch (e) {
      if (state.addDebugLog) {
        state.addDebugLog('error', 'Planning', 'Flow execution threw for ApprovedPlan first step', { error: String(e) })
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


    const sys1 = [
      'EXECUTION MODE. Execute the ApprovedPlan steps in order, autonomously.',
      'After each step: run Verify, summarize the result briefly.',
      'If verification fails or you detect a critical risk, STOP and report.',
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

    // Execute via Flow V2: ensure a running flow, then resume with a planning prompt
    try {
      const storeAny = get() as any

      // If no flow execution is active, initialize it (requires nodes loaded)
      if (!storeAny.feRequestId) {
        if (Array.isArray(storeAny.feNodes) && storeAny.feNodes.length > 0 && typeof storeAny.flowInit === 'function') {
          await storeAny.flowInit()
        } else {
          if (state.addDebugLog) {
            state.addDebugLog('warning', 'Planning', 'No flow loaded; cannot execute ApprovedPlan autonomously')
          }
          return
        }
      }

      const planningPrompt = [
        sys1,
        sys2,
        user,
      ].join('\n\n')

      if (typeof storeAny.feResume === 'function') {
        await storeAny.feResume({ userInput: planningPrompt })
      } else if (state.addDebugLog) {
        state.addDebugLog('error', 'Planning', 'feResume not available in store')
      }

      try {
        if (state.pushRouteRecord) {
          state.pushRouteRecord({
            requestId: storeAny.feRequestId || rid,
            mode: 'tools',
            provider: selectedProvider,
            model: selectedModel,
            timestamp: Date.now(),
          })
        }
      } catch {}
    } catch (e) {
      if (state.addDebugLog) {
        state.addDebugLog('error', 'Planning', 'Flow execution threw for autonomous ApprovedPlan', { error: String(e) })
      }
      console.error('[planning] Execute autonomous error:', e)
    }
  },
})

