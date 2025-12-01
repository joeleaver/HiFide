/**
 * Phase 1 Services Tests
 *
 * Tests for DebugService
 * (ViewService and UiService removed - UI state now managed in frontend localStorage)
 */

import { DebugService } from '../DebugService'
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

