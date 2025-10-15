/**
 * Node function registry with execution policies
 */

import type { FlowNode, NodeFunction, NodeExecutionPolicy } from '../types'
import { defaultContextStartNode } from './defaultContextStart'
import { userInputNode } from './userInput'
import { chatNode } from './chat'
import { toolsNode } from './tools'
import { manualInputNode } from './manualInput'
import { intentRouterNode } from './intentRouter'

/**
 * Node metadata
 */
interface NodeMetadata {
  fn: NodeFunction
  executionPolicy: NodeExecutionPolicy
}

const NODE_REGISTRY: Record<string, NodeMetadata> = {
  defaultContextStart: {
    fn: defaultContextStartNode,
    executionPolicy: 'any' // Entry node, no inputs needed
  },
  userInput: {
    fn: userInputNode,
    executionPolicy: 'any' // Execute on ANY input (supports loops)
  },
  chat: {
    fn: chatNode,
    executionPolicy: 'any' // Can execute with just message, tools are optional
  },
  tools: {
    fn: toolsNode,
    executionPolicy: 'any' // No inputs needed
  },
  manualInput: {
    fn: manualInputNode,
    executionPolicy: 'any' // No inputs needed
  },
  intentRouter: {
    fn: intentRouterNode,
    executionPolicy: 'any' // Needs context and data
  },
}

export function getNodeFunction(node: FlowNode): NodeFunction {
  const nodeType = node.type
  const metadata = NODE_REGISTRY[nodeType]

  if (!metadata) {
    throw new Error(`Unknown node type: ${nodeType}`)
  }

  return metadata.fn
}

export function getNodeExecutionPolicy(node: FlowNode): NodeExecutionPolicy {
  // Check if node has explicit policy in definition
  if (node.executionPolicy) {
    return node.executionPolicy
  }

  // Otherwise use default from registry
  const nodeType = node.type
  const metadata = NODE_REGISTRY[nodeType]

  if (!metadata) {
    return 'any' // Default fallback
  }

  return metadata.executionPolicy
}



