/**
 * Flow Configuration Service
 * 
 * Manages flow execution configuration settings.
 * 
 * Responsibilities:
 * - Retry settings (attempts, backoff)
 * - Cache settings
 * - Redactor rules (emails, API keys, AWS keys)
 * - Budget limits
 * - Error detection patterns
 * - Portal data cache
 */

import { Service } from './base/Service.js'

interface FlowConfigState {
  // Retry configuration
  retryAttempts: number
  retryBackoffMs: number
  
  // Cache configuration
  cacheEnabled: boolean
  
  // Redactor configuration
  redactorEnabled: boolean
  ruleEmails: boolean
  ruleApiKeys: boolean
  ruleAwsKeys: boolean
  
  // Budget configuration
  budgetUSD: string
  budgetBlock: boolean
  
  // Error detection configuration
  errorDetectEnabled: boolean
  errorDetectBlock: boolean
  errorDetectPatterns: string
  
  // Portal data cache (ephemeral - only exists during flow execution)
  portalData: Map<string, { context?: any; data?: any }>
}

export class FlowConfigService extends Service<FlowConfigState> {
  constructor() {
    super({
      retryAttempts: 3,
      retryBackoffMs: 1000,
      cacheEnabled: true,
      redactorEnabled: false,
      ruleEmails: true,
      ruleApiKeys: true,
      ruleAwsKeys: true,
      budgetUSD: '',
      budgetBlock: false,
      errorDetectEnabled: false,
      errorDetectBlock: false,
      errorDetectPatterns: '',
      portalData: new Map(),
    })
  }

  protected onStateChange(): void {
    // Config state is transient, no persistence needed
    // (Could be persisted per-flow in the future)
  }

  // Getters
  getRetryAttempts(): number {
    return this.state.retryAttempts
  }

  getRetryBackoffMs(): number {
    return this.state.retryBackoffMs
  }

  isCacheEnabled(): boolean {
    return this.state.cacheEnabled
  }

  isRedactorEnabled(): boolean {
    return this.state.redactorEnabled
  }

  getRedactorRules(): {
    emails: boolean
    apiKeys: boolean
    awsKeys: boolean
  } {
    return {
      emails: this.state.ruleEmails,
      apiKeys: this.state.ruleApiKeys,
      awsKeys: this.state.ruleAwsKeys,
    }
  }

  getBudget(): { usd: string; block: boolean } {
    return {
      usd: this.state.budgetUSD,
      block: this.state.budgetBlock,
    }
  }

  getErrorDetection(): {
    enabled: boolean
    block: boolean
    patterns: string
  } {
    return {
      enabled: this.state.errorDetectEnabled,
      block: this.state.errorDetectBlock,
      patterns: this.state.errorDetectPatterns,
    }
  }

  // Setters
  setRetryAttempts(params: { n: number }): void {
    this.setState({ retryAttempts: Math.max(1, Number(params.n || 1)) })
  }

  setRetryBackoffMs(params: { ms: number }): void {
    this.setState({ retryBackoffMs: Math.max(0, Number(params.ms || 0)) })
  }

  setCacheEnabled(params: { v: boolean }): void {
    this.setState({ cacheEnabled: !!params.v })
  }

  setRedactorEnabled(params: { v: boolean }): void {
    this.setState({ redactorEnabled: !!params.v })
  }

  setRuleEmails(params: { v: boolean }): void {
    this.setState({ ruleEmails: !!params.v })
  }

  setRuleApiKeys(params: { v: boolean }): void {
    this.setState({ ruleApiKeys: !!params.v })
  }

  setRuleAwsKeys(params: { v: boolean }): void {
    this.setState({ ruleAwsKeys: !!params.v })
  }

  setBudgetUSD(params: { usd: string }): void {
    this.setState({ budgetUSD: params.usd })
  }

  setBudgetBlock(params: { v: boolean }): void {
    this.setState({ budgetBlock: !!params.v })
  }

  setErrorDetectEnabled(params: { v: boolean }): void {
    this.setState({ errorDetectEnabled: !!params.v })
  }

  setErrorDetectBlock(params: { v: boolean }): void {
    this.setState({ errorDetectBlock: !!params.v })
  }

  setErrorDetectPatterns(params: { text: string }): void {
    this.setState({ errorDetectPatterns: params.text })
  }

  // Portal data management
  setPortalData(portalId: string, context?: any, data?: any): void {
    const current = this.state.portalData.get(portalId) || {}
    this.state.portalData.set(portalId, {
      context: context !== undefined ? context : current.context,
      data: data !== undefined ? data : current.data,
    })
  }

  getPortalData(portalId: string): { context?: any; data?: any } | undefined {
    return this.state.portalData.get(portalId)
  }

  clearPortalData(portalId: string): void {
    this.state.portalData.delete(portalId)
  }

  clearAllPortalData(): void {
    this.state.portalData.clear()
  }
}

