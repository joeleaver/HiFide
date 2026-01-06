import type { AgentTool } from '../../providers/provider.js'
import type { FlowAPI } from '../../flow-engine/flow-api.js'

export interface AskForInputParams {
  prompt: string
}

export const askForInputTool: AgentTool = {
  name: 'askForInput',
  description: 'Ask the user for input (text or multi-modal) and wait for their response.',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The message to show to the user when asking for input.'
      }
    },
    required: ['prompt'],
    additionalProperties: false
  },

  run: async (args: AskForInputParams, meta?: any): Promise<any> => {
    const flow = meta?.flowAPI as FlowAPI
    if (!flow) {
      return { ok: false, error: 'FlowAPI not found in tool metadata' }
    }

    flow.log.info(`Asking user for input: ${args.prompt}`)

    // Wait for user input via FlowAPI
    // We pass the prompt so the UI can display it
    // We pass isTool: true so the UI knows not to add the input to the session history
    const userInput = await flow.waitForUserInput(args.prompt, true)

    return {
      ok: true,
      data: userInput
    }
  },

  toModelResult: (raw: any) => {
    if (raw?.ok && raw?.data) {
      return {
        minimal: {
          ok: true,
          response: raw.data
        },
        ui: raw.data
      }
    }
    return { minimal: raw }
  }
}

export default askForInputTool
