import { describe, it, expect } from '@jest/globals'
import { BadgeProcessor } from '../badge-processor'

describe('BadgeProcessor - New Tools', () => {
  const processor = new BadgeProcessor()

  it('should correctly label kanbanGetBoard', () => {
    const badge = {
      toolName: 'kanbanGetBoard',
      args: { status: 'todo', epicId: 'epic-1' },
      result: { tasks: [] }
    }
    
    const processed = processor.processBadge(badge)
    expect(processed.label).toBe('Kanban Board (todo) [Epic: epic-1]')
    expect(processed.metadata).toEqual({ status: 'todo', epicId: 'epic-1' })
    expect(processed.status).toBe('success')
  })

  it('should correctly label kanbanCreateTask', () => {
    const badge = {
      toolName: 'kanbanCreateTask',
      args: { title: 'New Task', status: 'backlog' },
      result: { id: 'task-1' }
    }
    
    const processed = processor.processBadge(badge)
    expect(processed.label).toBe('Create Task: "New Task"')
    expect(processed.metadata).toEqual({ title: 'New Task', status: 'backlog', epicId: undefined })
  })

  it('should correctly label knowledgeBaseSearch', () => {
    const badge = {
      toolName: 'knowledgeBaseSearch',
      args: { query: 'docs', tags: ['bug'] },
      result: { data: { results: [{ id: '1' }] } }
    }
    
    const processed = processor.processBadge(badge)
    expect(processed.label).toBe('KB Search: "docs" [bug]')
    expect(processed.status).toBe('success')
    expect(processed.showPreview).toBe(true)
  })

  it('should show warning for empty KB search', () => {
    const badge = {
      toolName: 'knowledgeBaseSearch',
      args: { query: 'missing' },
      result: { data: { results: [] } }
    }
    
    const processed = processor.processBadge(badge)
    expect(processed.label).toBe('KB Search: "missing"')
    expect(processed.status).toBe('warning')
  })
})
