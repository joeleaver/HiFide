/**
 * Tests for View Slice
 */

import { create } from 'zustand'
import { createViewSlice, type ViewSlice } from '../view.slice'
import { LS_KEYS } from '../../utils/constants'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
})()

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
})

// Mock window.app
Object.defineProperty(window, 'app', {
  value: {
    setView: jest.fn().mockResolvedValue({ ok: true }),
  },
})

describe('ViewSlice', () => {
  let store: ReturnType<typeof create<ViewSlice>>
  
  beforeEach(() => {
    // Clear localStorage before each test
    localStorageMock.clear()
    
    // Create a fresh store
    store = create<ViewSlice>()(createViewSlice)
  })
  
  describe('initialization', () => {
    it('should initialize with default view', () => {
      expect(store.getState().currentView).toBe('agent')
    })
    
    it('should initialize from localStorage if available', () => {
      localStorageMock.setItem(LS_KEYS.CURRENT_VIEW, JSON.stringify('settings'))
      
      const newStore = create<ViewSlice>()(createViewSlice)
      expect(newStore.getState().currentView).toBe('settings')
    })
  })
  
  describe('setCurrentView', () => {
    it('should update current view', () => {
      store.getState().setCurrentView('explorer')
      expect(store.getState().currentView).toBe('explorer')
    })
    
    it('should persist to localStorage', () => {
      store.getState().setCurrentView('flowEditor')
      
      const stored = localStorageMock.getItem(LS_KEYS.CURRENT_VIEW)
      expect(JSON.parse(stored!)).toBe('flowEditor')
    })
    
    it('should notify main process', () => {
      store.getState().setCurrentView('terminal')
      
      expect(window.app.setView).toHaveBeenCalledWith('terminal')
    })
    
    it('should handle all view types', () => {
      const views: Array<'agent' | 'explorer' | 'flowEditor' | 'sourceControl' | 'terminal' | 'settings'> = [
        'agent',
        'explorer',
        'flowEditor',
        'sourceControl',
        'terminal',
        'settings',
      ]
      
      views.forEach((view) => {
        store.getState().setCurrentView(view)
        expect(store.getState().currentView).toBe(view)
      })
    })
  })
})

