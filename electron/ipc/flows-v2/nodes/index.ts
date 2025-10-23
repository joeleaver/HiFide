/**
 * Node function registry with execution policies
 *
 * Each node is now self-contained in its own file with metadata.
 * This registry imports and aggregates them for easy lookup.
 */

import type { FlowNode, NodeFunction, NodeExecutionPolicy } from '../types'
import { defaultContextStartNode, metadata as defaultContextStartMetadata } from './defaultContextStart'
import { newContextNode, metadata as newContextMetadata } from './newContext'
import { userInputNode, metadata as userInputMetadata } from './userInput'
import { llmRequestNode, metadata as llmRequestMetadata } from './llmRequest'
import { toolsNode, metadata as toolsMetadata } from './tools'
import { manualInputNode, metadata as manualInputMetadata } from './manualInput'
import { intentRouterNode, metadata as intentRouterMetadata } from './intentRouter'
import { portalInputNode, metadata as portalInputMetadata } from './portalInput'
import { portalOutputNode, metadata as portalOutputMetadata } from './portalOutput'
import { injectMessagesNode, metadata as injectMessagesMetadata } from './injectMessages'
import { cacheNode, metadata as cacheMetadata } from './cache'

/**
 * Node metadata
 */
interface NodeMetadata {
  fn: NodeFunction
  executionPolicy: NodeExecutionPolicy
  description?: string
}

/**
 * Node registry - aggregates all node implementations and their metadata
 */
const NODE_REGISTRY: Record<string, NodeMetadata> = {
  defaultContextStart: {
    fn: defaultContextStartNode,
    ...defaultContextStartMetadata
  },
  newContext: {
    fn: newContextNode,
    ...newContextMetadata
  },
  userInput: {
    fn: userInputNode,
    ...userInputMetadata
  },
  llmRequest: {
    fn: llmRequestNode,
    ...llmRequestMetadata
  },
  tools: {
    fn: toolsNode,
    ...toolsMetadata
  },
  manualInput: {
    fn: manualInputNode,
    ...manualInputMetadata
  },
  intentRouter: {
    fn: intentRouterNode,
    ...intentRouterMetadata
  },
  portalInput: {
    fn: portalInputNode,
    ...portalInputMetadata
  },
  portalOutput: {
    fn: portalOutputNode,
    ...portalOutputMetadata
  },
  injectMessages: {
    fn: injectMessagesNode,
    ...injectMessagesMetadata
  },
  cache: {
    fn: cacheNode,
    ...cacheMetadata
  },
}

export function getNodeFunction(node: FlowNode): NodeFunction {
  const nodeType = (node as any).nodeType || (node as any).type
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
  const nodeType = (node as any).nodeType || (node as any).type
  const metadata = NODE_REGISTRY[nodeType]

  if (!metadata) {
    return 'any' // Default fallback
  }

  return metadata.executionPolicy
}



