import { } from 'node:fs'

export function buildSystemPrompt(selfRegulate: boolean = true): string {
  const rm = selfRegulate
    ? `RESOURCE MANAGEMENT:
1. ALWAYS call agent.assess_task FIRST to understand your resource budget
2. Call agent.check_resources periodically to monitor your token/iteration usage
3. Call agent.summarize_progress when context grows (>10 tool calls) to compress conversation history
4. Stay within your allocated token budget and iteration limits`
    : ''

  return [
    'You are a software agent with tools. You have self-regulation capabilities to manage your own resources efficiently.',
    rm,
    'TASK EXECUTION:\nWhen the user asks to change files, you MUST make the changes using tools (fs.read_file, fs.write_file, edits.apply). Read the current file, apply minimal precise edits, and write the updated file. After changes, briefly summarize what changed.',
    'Be efficient: avoid redundant operations, reuse information you\'ve already gathered, and compress context when needed.'
  ].filter(Boolean).join('\n\n')
}

