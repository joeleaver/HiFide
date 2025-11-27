/**
 * Phase 1 Services Tests
 *
 * Tests for DebugService, ViewService, and UiService
 */

import { DebugService } from '../DebugService'
import { ViewService } from '../ViewService'
import { UiService } from '../UiService'
import { ServiceRegistry } from '../base/ServiceRegistry'

describe('Phase 1 Services', () => {
  beforeEach(() => {
    // Clear registry before each test
    ServiceRegistry.getInstance().clear()
  })

  describe('DebugService', () => {
    it('should add debug logs', () => {
      const service = new DebugService()
      
      service.addLog('info', 'test', 'Test message')
      const logs = service.getLogs()
      
      expect(logs).toHaveLength(1)
      expect(logs[0]).toMatchObject({
        level: 'info',
        category: 'test',
        message: 'Test message',
      })
      expect(logs[0].timestamp).toBeGreaterThan(0)
    })

    it('should clear debug logs', () => {
      const service = new DebugService()
      
      service.addLog('info', 'test', 'Message 1')
      service.addLog('error', 'test', 'Message 2')
      expect(service.getLogs()).toHaveLength(2)
      
      service.clearLogs()
      expect(service.getLogs()).toHaveLength(0)
    })

    it('should limit log size to MAX_DEBUG_LOGS', () => {
      const service = new DebugService()
      const MAX_DEBUG_LOGS = 1000
      
      // Add more than MAX_DEBUG_LOGS
      for (let i = 0; i < MAX_DEBUG_LOGS + 100; i++) {
        service.addLog('info', 'test', `Message ${i}`)
      }
      
      const logs = service.getLogs()
      expect(logs).toHaveLength(MAX_DEBUG_LOGS)
      
      // Should keep the most recent logs
      expect(logs[logs.length - 1].message).toBe(`Message ${MAX_DEBUG_LOGS + 99}`)
    })
  })

  describe('ViewService', () => {
    it('should initialize with default view', () => {
      const service = new ViewService()
      expect(service.getCurrentView()).toBe('flow')
    })

    it('should set current view', () => {
      const service = new ViewService()
      
      service.setView('explorer')
      expect(service.getCurrentView()).toBe('explorer')
      
      service.setView('settings')
      expect(service.getCurrentView()).toBe('settings')
    })

    it('should not update if view is the same', () => {
      const service = new ViewService()
      let changeCount = 0
      
      service.on('view:changed', () => {
        changeCount++
      })
      
      service.setView('flow') // Same as default
      expect(changeCount).toBe(0)
      
      service.setView('explorer')
      expect(changeCount).toBe(1)
      
      service.setView('explorer') // Same as current
      expect(changeCount).toBe(1)
    })
  })

  describe('UiService', () => {
    it('should initialize with default window state', () => {
      const service = new UiService()
      const state = service.getWindowState()
      
      expect(state.agentMode).toBe('chat')
      expect(state.flowCanvasWidth).toBe(600)
      expect(state.metaPanelOpen).toBe(false)
    })

    it('should update window state', () => {
      const service = new UiService()
      
      service.updateWindowState({ agentMode: 'flow' })
      expect(service.getWindowState().agentMode).toBe('flow')
      
      service.updateWindowState({ flowCanvasWidth: 800 })
      expect(service.getWindowState().flowCanvasWidth).toBe(800)
    })

    it('should not trigger change if values are the same', () => {
      const service = new UiService()
      let changeCount = 0
      
      service.on('windowState:changed', () => {
        changeCount++
      })
      
      service.updateWindowState({ agentMode: 'chat' }) // Same as default
      expect(changeCount).toBe(0)
      
      service.updateWindowState({ agentMode: 'flow' })
      expect(changeCount).toBe(1)
      
      service.updateWindowState({ agentMode: 'flow' }) // Same as current
      expect(changeCount).toBe(1)
    })

    it('should persist window state without broadcasting', () => {
      const service = new UiService()
      let changeCount = 0
      
      service.on('windowState:changed', () => {
        changeCount++
      })
      
      service.persistWindowState({ flowCanvasWidth: 700 })
      
      // Should update in-memory state
      expect(service.getWindowState().flowCanvasWidth).toBe(700)
      
      // Should not trigger change event
      expect(changeCount).toBe(0)
    })
  })

  describe('ServiceRegistry', () => {
    it('should register and retrieve services', () => {
      const registry = ServiceRegistry.getInstance()
      const debugService = new DebugService()
      
      registry.register('debug', debugService)
      
      const retrieved = registry.get<DebugService>('debug')
      expect(retrieved).toBe(debugService)
    })

    it('should throw error for non-existent service', () => {
      const registry = ServiceRegistry.getInstance()

      expect(() => {
        registry.get('nonexistent')
      }).toThrow('Service nonexistent not found')
    })
  })
})

