# Agent SDKs and Orchestration Strategy

## Summary
- We will keep a provider-agnostic internal orchestrator (tools + policies + planning) to ensure consistent behavior and deep local tool integration (FS, terminal, indexer).
- We can optionally support provider-native agent runtimes behind adapters ("brain providers").

## Provider-native options (2024–2025 landscape)
- OpenAI GPT Agents SDK: agent definitions, tools, state, and memory; strong tool-calling and structured outputs.
- Google Gemini: tool use/function calling; Vertex AI Agent Builder and Extensions for enterprise workflows.
- Anthropic Claude: tool use in Messages API, computer-use beta for UI control; structured output.

## Trade-offs
- Pros of native agent SDKs: built-in planning, memory, evaluation; lower prompt plumbing; potential better reasoning alignment.
- Cons: vendor lock-in, uneven parity across providers, less control over local tools, harder to enforce our permission policies.

## Recommended approach
1. Default: internal orchestrator with unified tool schema and policies.
2. Add optional "Agent Runtime Adapters":
   - `runtime: internal | openai-agent | gemini-agent | anthropic-agent`
   - Map our tool schema to provider-specific tool/function formats.
   - Respect the same permission/auto-approve policies; fall back to internal if unsupported.
3. Expose configuration in UI:
   - Choice of runtime per workspace/session.
   - Tunables: planning depth, retrieval budget, auto-approve threshold, tool allow-list.

## Node-editor configuration
- Represent the agent as a graph (nodes: planner, retrieval, tool-exec, verifier, policy gate, reporter).
- Implement with React Flow; persist as JSON per project.
- Allow per-node provider choice (e.g., planner on Anthropic, verifier prompts on Gemini).

## Next steps
- Define adapter interfaces and minimal parity matrix for tools across providers.
- Implement `runtime: internal` first; add OpenAI/Gemini/Anthropic adapters incrementally.

