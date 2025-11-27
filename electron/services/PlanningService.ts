/**
 * Planning Service
 * 
 * Manages approved plans and plan execution.
 */

import path from 'node:path'
import fs from 'node:fs/promises'
import { Service } from './base/Service.js'
import type { ApprovedPlan } from '../store/types.js'
import { ServiceRegistry } from './base/ServiceRegistry.js'

interface PlanningState {
  approvedPlan: ApprovedPlan | null
}

export class PlanningService extends Service<PlanningState> {
  constructor() {
    super({
      approvedPlan: null,
    })
  }

  protected onStateChange(): void {
    // Planning state is transient, no persistence needed
    // Plans are saved to disk explicitly via saveApprovedPlan
  }

  // Getters
  getApprovedPlan(): ApprovedPlan | null {
    return this.state.approvedPlan
  }

  // Setters
  setApprovedPlan(plan: ApprovedPlan | null): void {
    this.setState({ approvedPlan: plan })
  }

  // Async operations
  async saveApprovedPlan(): Promise<{ ok: boolean; error?: string }> {
    try {
      const plan = this.state.approvedPlan
      const workspaceService = ServiceRegistry.get<any>('workspace')
      const baseDir = path.resolve(String(workspaceService?.getWorkspaceRoot() || process.cwd()))
      const privateDir = path.join(baseDir, '.hifide-private')
      await fs.mkdir(privateDir, { recursive: true })
      const file = path.join(privateDir, 'approved-plan.json')
      await fs.writeFile(file, JSON.stringify(plan ?? {}, null, 2), 'utf-8')

      const debugService = ServiceRegistry.get<any>('debug')
      if (debugService?.addLog) {
        debugService.addLog('info', 'Planning', 'ApprovedPlan saved')
      }

      return { ok: true }
    } catch (e) {
      const debugService = ServiceRegistry.get<any>('debug')
      if (debugService?.addLog) {
        debugService.addLog('error', 'Planning', 'Error saving ApprovedPlan', { error: String(e) })
      }
      console.error('[planning] Save error:', e)
      return { ok: false, error: String(e) }
    }
  }

  async loadApprovedPlan(): Promise<{ ok: boolean; plan?: ApprovedPlan | null; error?: string }> {
    try {
      const workspaceService = ServiceRegistry.get<any>('workspace')
      const baseDir = path.resolve(String(workspaceService?.getWorkspaceRoot() || process.cwd()))
      const file = path.join(baseDir, '.hifide-private', 'approved-plan.json')
      const text = await fs.readFile(file, 'utf-8').catch(() => '')

      if (!text) {
        this.setState({ approvedPlan: null })
        return { ok: true, plan: null }
      }

      try {
        const plan = JSON.parse(text)
        this.setState({ approvedPlan: plan })
        return { ok: true, plan }
      } catch {
        this.setState({ approvedPlan: null })
        return { ok: true, plan: null }
      }
    } catch (e) {
      const debugService = ServiceRegistry.get<any>('debug')
      if (debugService?.addLog) {
        debugService.addLog('error', 'Planning', 'Error loading ApprovedPlan', { error: String(e) })
      }
      console.error('[planning] Load error:', e)
      return { ok: false, error: String(e) }
    }
  }

  async executeApprovedPlanFirstStep(): Promise<void> {
    const plan = this.state.approvedPlan

    if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      const debugService = ServiceRegistry.get<any>('debug')
      if (debugService?.addLog) {
        debugService.addLog('warning', 'Planning', 'No ApprovedPlan or steps to execute')
      }
      return
    }

    const first = plan.steps[0]
    const rid = crypto.randomUUID()

    // Get provider/model from provider service
    const providerService = ServiceRegistry.get<any>('provider')
    const selectedModel = providerService?.getSelectedModel() || 'gpt-4'
    const selectedProvider = providerService?.getSelectedProvider() || 'openai'

    const sys1 = 'EXECUTION MODE. Execute exactly the indicated step then stop and report. Verify per plan.'
    const sys2 = `ApprovedPlan:\n\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``
    const user = `Execute exactly step ${first.id} only. Stop after verification with a brief report.`

    const debugService = ServiceRegistry.get<any>('debug')
    if (debugService?.addLog) {
      debugService.addLog('info', 'LLM', `Executing ApprovedPlan first step (${first.id}) via tools`, {
        requestId: rid,
        provider: selectedProvider,
        model: selectedModel,
      })
    }

    // Execute via Flow V2
    try {
      const flowEditorService = ServiceRegistry.get<any>('flowEditor')
      if (!flowEditorService) {
        if (debugService?.addLog) {
          debugService.addLog('warning', 'Planning', 'FlowEditor service not available')
        }
        return
      }

      // If no flow execution is active, initialize it
      if (!flowEditorService.getRequestId()) {
        const nodes = flowEditorService.getNodes()
        if (Array.isArray(nodes) && nodes.length > 0) {
          await flowEditorService.flowInit()
        } else {
          if (debugService?.addLog) {
            debugService.addLog('warning', 'Planning', 'No flow loaded; cannot execute ApprovedPlan step')
          }
          return
        }
      }

      // Build planning prompt
      const planningPrompt = [sys1, sys2, user].join('\n\n')

      await flowEditorService.feResume({ userInput: planningPrompt })

      // Record route
      try {
        providerService?.pushRouteRecord({
          requestId: flowEditorService.getRequestId() || rid,
          mode: 'tools',
          provider: selectedProvider,
          model: selectedModel,
          timestamp: Date.now(),
        })
      } catch {}
    } catch (e) {
      if (debugService?.addLog) {
        debugService.addLog('error', 'Planning', 'Flow execution threw for ApprovedPlan first step', {
          error: String(e),
        })
      }
      console.error('[planning] Execute first step error:', e)
    }
  }

  async executeApprovedPlanAutonomous(): Promise<void> {
    const plan = this.state.approvedPlan

    if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      const debugService = ServiceRegistry.get<any>('debug')
      if (debugService?.addLog) {
        debugService.addLog('warning', 'Planning', 'No ApprovedPlan or steps to execute')
      }
      return
    }

    const rid = crypto.randomUUID()

    // Get provider/model from provider service
    const providerService = ServiceRegistry.get<any>('provider')
    const selectedModel = providerService?.getSelectedModel() || 'gpt-4'
    const selectedProvider = providerService?.getSelectedProvider() || 'openai'

    const sys1 = [
      'EXECUTION MODE. Execute the ApprovedPlan steps in order, autonomously.',
      'After each step: run Verify, summarize the result briefly.',
      'If verification fails or you detect a critical risk, STOP and report.',
    ].join(' ')

    const sys2 = `ApprovedPlan:\n\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``
    const user =
      'Begin executing the plan from the first step and continue through all steps unless verification fails. Keep outputs concise.'

    const debugService = ServiceRegistry.get<any>('debug')
    if (debugService?.addLog) {
      debugService.addLog('info', 'LLM', 'Executing ApprovedPlan autonomously via tools', {
        requestId: rid,
        provider: selectedProvider,
        model: selectedModel,
      })
    }

    // Execute via Flow V2
    try {
      const flowEditorService = ServiceRegistry.get<any>('flowEditor')
      if (!flowEditorService) {
        if (debugService?.addLog) {
          debugService.addLog('warning', 'Planning', 'FlowEditor service not available')
        }
        return
      }

      // If no flow execution is active, initialize it
      if (!flowEditorService.getRequestId()) {
        const nodes = flowEditorService.getNodes()
        if (Array.isArray(nodes) && nodes.length > 0) {
          await flowEditorService.flowInit()
        } else {
          if (debugService?.addLog) {
            debugService.addLog('warning', 'Planning', 'No flow loaded; cannot execute ApprovedPlan autonomously')
          }
          return
        }
      }

      const planningPrompt = [sys1, sys2, user].join('\n\n')

      await flowEditorService.feResume({ userInput: planningPrompt })

      try {
        providerService?.pushRouteRecord({
          requestId: flowEditorService.getRequestId() || rid,
          mode: 'tools',
          provider: selectedProvider,
          model: selectedModel,
          timestamp: Date.now(),
        })
      } catch {}
    } catch (e) {
      if (debugService?.addLog) {
        debugService.addLog('error', 'Planning', 'Flow execution threw for autonomous ApprovedPlan', {
          error: String(e),
        })
      }
      console.error('[planning] Execute autonomous error:', e)
    }
  }
}
