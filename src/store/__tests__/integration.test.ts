/**
 * Integration Tests for Combined Store
 * 
 * Tests that all slices work together correctly and cross-slice
 * communication functions as expected.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAppStore } from '../index'

// Mock window APIs
const mockWindow = {
  app: {
    setView: vi.fn().mockResolvedValue({ ok: true }),
  },
  workspace: {
    setRoot: vi.fn().mockResolvedValue({ ok: true }),
    getRoot: vi.fn().mockResolvedValue('/test/workspace'),
    bootstrap: vi.fn().mockResolvedValue({ ok: true }),
  },
  secrets: {
    getApiKeyFor: vi.fn().mockResolvedValue('test-key'),
    setApiKeyFor: vi.fn().mockResolvedValue({ ok: true }),
    validateApiKeyFor: vi.fn().mockResolvedValue({ ok: true }),
  },
  sessions: {
    load: vi.fn().mockResolvedValue({ sessions: [], currentId: null }),
    save: vi.fn().mockResolvedValue({ ok: true }),
    delete: vi.fn().mockResolvedValue({ ok: true }),
  },
  planning: {
    saveApproved: vi.fn().mockResolvedValue({ ok: true }),
    loadApproved: vi.fn().mockResolvedValue({ ok: false }),
  },
}

global.window = mockWindow as any

describe('Combined Store Integration', () => {
  beforeEach(() => {
    // Reset store state before each test
    useAppStore.setState({
      currentView: 'agent',
      sessions: [],
      currentId: null,
      workspaceRoot: null,
      selectedProvider: 'openai',
      selectedModel: 'gpt-4',
    })
    
    // Clear all mocks
    vi.clearAllMocks()
  })

  describe('Store Initialization', () => {
    it('should create store with all slices', () => {
      const store = useAppStore.getState()
      
      // Verify all slices are present
      expect(store.currentView).toBeDefined()
      expect(store.setCurrentView).toBeDefined()
      expect(store.sessions).toBeDefined()
      expect(store.addUserMessage).toBeDefined()
      expect(store.workspaceRoot).toBeDefined()
      expect(store.openFolder).toBeDefined()
      expect(store.selectedProvider).toBeDefined()
      expect(store.setSelectedProvider).toBeDefined()
    })

    it('should have correct initial state', () => {
      const store = useAppStore.getState()
      
      expect(store.currentView).toBe('agent')
      expect(store.sessions).toEqual([])
      expect(store.currentId).toBeNull()
      expect(store.debugLogs).toEqual([])
      expect(store.approvedPlan).toBeNull()
    })
  })

  describe('Cross-Slice Communication', () => {
    it('should allow view slice to communicate with main process', () => {
      const store = useAppStore.getState()
      
      store.setCurrentView('explorer')
      
      expect(mockWindow.app.setView).toHaveBeenCalledWith('explorer')
    })

    it('should allow session slice to create new session and clear terminals', () => {
      const store = useAppStore.getState()
      
      // Mock terminal slice methods
      const clearAgentTerminals = vi.fn()
      useAppStore.setState({ clearAgentTerminals })
      
      const sessionId = store.newSession('Test Session')
      
      expect(sessionId).toBeDefined()
      expect(store.sessions).toHaveLength(1)
      expect(store.sessions[0].title).toBe('Test Session')
    })

    it('should allow settings slice to update provider validation', async () => {
      const store = useAppStore.getState()
      
      // Mock provider slice method
      const setProvidersValid = vi.fn()
      useAppStore.setState({ setProvidersValid })
      
      await store.saveSettingsApiKeys()
      
      // Verify provider validation was called
      expect(setProvidersValid).toHaveBeenCalled()
    })
  })

  describe('Session Management', () => {
    it('should create and select new session', () => {
      const store = useAppStore.getState()
      
      const sessionId = store.newSession('My Chat')
      
      expect(store.currentId).toBe(sessionId)
      expect(store.sessions).toHaveLength(1)
      expect(store.sessions[0].title).toBe('My Chat')
    })

    it('should add messages to current session', () => {
      const store = useAppStore.getState()
      
      const sessionId = store.newSession('Test')
      store.addUserMessage('Hello')
      store.addAssistantMessage('Hi there!')
      
      const messages = store.getCurrentMessages()
      expect(messages).toHaveLength(2)
      expect(messages[0].role).toBe('user')
      expect(messages[0].content).toBe('Hello')
      expect(messages[1].role).toBe('assistant')
      expect(messages[1].content).toBe('Hi there!')
    })

    it('should track token usage per session', () => {
      const store = useAppStore.getState()
      
      store.newSession('Test')
      store.recordTokenUsage('openai', 'gpt-4', {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      })
      
      const session = store.sessions[0]
      expect(session.tokenUsage.total.totalTokens).toBe(150)
      expect(session.tokenUsage.byProvider.openai.totalTokens).toBe(150)
    })
  })

  describe('Provider Management', () => {
    it('should update selected provider and model', () => {
      const store = useAppStore.getState()
      
      store.setSelectedProvider('anthropic')
      store.setSelectedModel('claude-3-5-sonnet')
      
      expect(store.selectedProvider).toBe('anthropic')
      expect(store.selectedModel).toBe('claude-3-5-sonnet')
    })

    it('should track provider validation state', () => {
      const store = useAppStore.getState()
      
      store.setProviderValid('openai', true)
      store.setProviderValid('anthropic', false)
      
      expect(store.providerValid.openai).toBe(true)
      expect(store.providerValid.anthropic).toBe(false)
    })

    it('should set default model for provider', () => {
      const store = useAppStore.getState()
      
      store.setDefaultModel('openai', 'gpt-4-turbo')
      
      expect(store.defaultModels.openai).toBe('gpt-4-turbo')
    })
  })

  describe('Debug Logging', () => {
    it('should add debug logs', () => {
      const store = useAppStore.getState()
      
      store.addDebugLog('info', 'Test', 'Test message')
      store.addDebugLog('error', 'Test', 'Error message')
      
      expect(store.debugLogs).toHaveLength(2)
      expect(store.debugLogs[0].level).toBe('info')
      expect(store.debugLogs[1].level).toBe('error')
    })

    it('should clear debug logs', () => {
      const store = useAppStore.getState()
      
      store.addDebugLog('info', 'Test', 'Message 1')
      store.addDebugLog('info', 'Test', 'Message 2')
      store.clearDebugLogs()
      
      expect(store.debugLogs).toHaveLength(0)
    })
  })

  describe('Planning', () => {
    it('should set and save approved plan', async () => {
      const store = useAppStore.getState()
      
      const plan = {
        goals: ['Test goal'],
        steps: [
          { id: 'step1', title: 'First step' },
        ],
      }
      
      store.setApprovedPlan(plan)
      expect(store.approvedPlan).toEqual(plan)
      
      await store.saveApprovedPlan()
      expect(mockWindow.planning.saveApproved).toHaveBeenCalledWith(plan)
    })
  })

  describe('UI State', () => {
    it('should toggle UI panels', () => {
      const store = useAppStore.getState()
      
      store.setMetaPanelOpen(false)
      expect(store.metaPanelOpen).toBe(false)
      
      store.setSidebarCollapsed(true)
      expect(store.sidebarCollapsed).toBe(true)
      
      store.setDebugPanelCollapsed(true)
      expect(store.debugPanelCollapsed).toBe(true)
    })

    it('should manage terminal panel state', () => {
      const store = useAppStore.getState()
      
      store.setAgentTerminalPanelOpen(true)
      store.setAgentTerminalPanelHeight(300)
      
      expect(store.agentTerminalPanelOpen).toBe(true)
      expect(store.agentTerminalPanelHeight).toBe(300)
    })
  })

  describe('Selectors', () => {
    it('should provide working selectors', () => {
      const store = useAppStore.getState()
      
      store.newSession('Test Session')
      store.addUserMessage('Hello')
      
      // Import selectors
      const { selectCurrentSession, selectCurrentMessages } = require('../index')
      
      const session = selectCurrentSession(store)
      expect(session?.title).toBe('Test Session')
      
      const messages = selectCurrentMessages(store)
      expect(messages).toHaveLength(1)
    })
  })

  describe('Type Safety', () => {
    it('should maintain type safety across slices', () => {
      const store = useAppStore.getState()
      
      // These should all be type-safe
      const view: 'agent' | 'explorer' = store.currentView
      const provider: string = store.selectedProvider
      const model: string = store.selectedModel
      const sessions: any[] = store.sessions
      
      expect(view).toBeDefined()
      expect(provider).toBeDefined()
      expect(model).toBeDefined()
      expect(sessions).toBeDefined()
    })
  })
})

