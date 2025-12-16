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
    expect(processed.title).toBe('Kanban Board')
    expect(processed.label).toBe('(todo) [Epic: epic-1]')
    expect(processed.metadata).toMatchObject({ status: 'todo', epicId: 'epic-1' })
    expect(processed.status).toBe('success')
  })

  it('should correctly label kanbanCreateTask', () => {
    const badge = {
      toolName: 'kanbanCreateTask',
      args: { title: 'New Task', status: 'backlog' },
      result: { id: 'task-1' }
    }
    
    const processed = processor.processBadge(badge)
    expect(processed.title).toBe('New Task')
    expect(processed.label).toBe('"New Task"')
    expect(processed.metadata).toMatchObject({ title: 'New Task', status: 'backlog', epicId: undefined })
  })

  it('should correctly label knowledgeBaseSearch', () => {
    const badge = {
      toolName: 'knowledgeBaseSearch',
      args: { query: 'docs', tags: ['bug'] },
      result: { data: { results: [{ id: '1' }] } }
    }
    
    const processed = processor.processBadge(badge)
    expect(processed.title).toBe('"docs"')
    expect(processed.label).toBe('"docs" [bug]')
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
    expect(processed.title).toBe('"missing"')
    expect(processed.label).toBe('"missing"')
    expect(processed.status).toBe('warning')
  })

  it('should label MCP tools with server + tool name (generic MCP config)', () => {
    const badge: any = {
      toolName: 'mcp_playwright_openPage',
      args: { url: 'https://example.com' },
      result: { ok: true, data: { title: 'Example' } },
      metadata: {}
    }

    const processed = processor.processBadge(badge)

    expect(processed.contentType).toBe('operation-result')
    expect(processed.expandable).toBe(true)
    expect(processed.needsExpansion).toBe(true)
    expect(processed.title).toContain('MCP playwright: openPage')
    expect(processed.label).toContain('url: https://example.com')
    expect(processed.metadata).toMatchObject({
      server: 'playwright',
      mcpTool: 'openPage'
    })
    expect(processed.metadata.fullParams).toMatchObject({
      kind: 'tool-payload',
      toolName: 'mcp_playwright_openPage',
    })
  })
})
