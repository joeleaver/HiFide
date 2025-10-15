## Watch Mode persistence + pre-run estimator (MVP)

- Persistence
  - Added flowState IPC (flowState:load/save) in main; stores JSON under .hifide-private/flow-state.json (dir ensured; auto-gitignored elsewhere).
  - Exposed window.flowState in preload.
  - Renderer auto-loads on mount and auto-saves (debounced) on changes to breakpoints, redactor/budget/errorDetection config, and selected provider.

- Pre-run estimate panel
  - Displays live token and $ estimate using heuristic: input ≈ chars/4; output ≈ 400.
  - Uses selected provider/model pricing from app store to compute cost; color-coded vs Budget USD.
  - Shown in Watch panel, updates as user types and as provider/model changes.


## Phase 2 wrap-up (done)

- Node badges + mini-IO
  - Badges on nodes reflect last status: ok/warn/blocked/masked. Updates live from flow events.
  - Lightweight, no schema changes.
- ErrorDetection custom patterns
  - Textarea in Watch panel; merged into policy and enforced in main with user-supplied case-insensitive literals.
- Graph layout persistence
  - Node positions auto-save to .hifide-private/flow-state.json; restored on load.

## Phase 3 (done)

- Generic graph executor: executeFlowDef traverses nodes/edges; flow:run prefers FlowDefinition.
- Node kinds live: capabilityGuard, conditional, parallelSplit/parallelJoin (concurrent with join barrier), modelRouter, toolSelector (MVP), retryWithBackoff (policy), cache (policy), toolSandbox (no-op).
- Capability registry: providerCapabilities in main; IPC capabilities:get + preload bridge window.capabilities.get().

## Phase 4 (in progress)



- Spans: nodeEnd now includes durationMs; renderer can overlay timing badges.
- Trace export: new flow:trace:export IPC; preload bridge window.flowTrace.export(events, label) writes .hifide-private/traces/*.json.
- Retries: retryWithBackoff node sets a policy (maxAttempts, backoffMs); chat respects it (retries only if no output streamed).
- Cache: cache node sets a policy; chat caches by provider+model+input and returns cached result instantly on hit.
- ToolSelector (MVP): sets toolsAllowed allowlist for upcoming tool-enabled nodes.
- Renderer: Watch panel “Export trace” button; node mini timing badges (durationMs) on nodeEnd; chat node cost mini‑badge estimated using pricing and actual streamed output.

- Notes
  - Non-invasive: does not alter execution flow; BudgetGuard still enforces warn/block at runtime.
  - File path: .hifide-private/flow-state.json; schema kept minimal and resilient.

# Flow Editor – Master Plan (Consolidated)

Status: Draft v1.0 • Owner: Flow Team • Last Updated: 2025-10-13

## Quick Status — Completed vs Remaining

- Completed
  - Phase 2: Node badges + mini-IO; ErrorDetection custom patterns; Graph layout persistence; Pre‑run estimator; Watch highlight at breakpoints; BudgetGuard warn/block; Watch state persistence.
  - Phase 3: Generic graph executor (executeFlowDef); Node kinds capabilityGuard, conditional, modelRouter, toolSelector (MVP), retryWithBackoff (policy), cache (policy), toolSandbox (no‑op); parallelSplit/parallelJoin with true concurrency and a single join barrier.
  - Capability registry: providerCapabilities in main; IPC capabilities:get; preload bridge window.capabilities.get().
  - Phase 4 (partial): Per‑node spans (durationMs); Trace export IPC + UI; Chat retry policy (only if no output streamed); Persistent cache with TTL (disk‑backed) + inspector UI; ToolSelector allowlist wiring (policy only); Renderer badges for duration + cost; join‑aware parallel execution with per‑node join strategy (first|last|concat); cache‑hit indicator in Watch.

- Remaining (Phase 4 and beyond)
  - Badges/Tooltip polish: optional popover with detailed input/output token counts and cost components; compact formatting edge cases; stacking options.
  - Parallelism controls: optional concurrency cap per split (join strategy shipped: first/last/concat; merge = concat/first/last).
  - Tool‑enabled nodes: wire ToolSelector allowlist into actual tool execution nodes when introduced.
  - Testing & Simulation: record/replay, seeded scenarios, deterministic replays.
  - Validation & Types: JSON Schema for node I/O, FlowValidator compile‑time checks, NodeRegistry typing.
  - Advanced nodes (post‑MVP): structuredOutput, storeResult, loop/while/until, parallelMerge/aggregate, functionCall/tool nodes.
  - Scheduling/Ratelimits: concurrency budgeting, provider backoff integration, backpressure signals.
  - Editor UX: templates/wizards, What‑if cost estimator (advanced), context sidecar introspection.
  - Cache persistence: persistent cache across runs with TTL/invalidations and small inspector UI.
  - Tool‑enabled nodes: wire ToolSelector allowlist into actual tool execution nodes when introduced.
  - Testing & Simulation: record/replay, seeded scenarios, deterministic replays.
  - Validation & Types: JSON Schema for node I/O, FlowValidator compile‑time checks, NodeRegistry typing.
  - Advanced nodes (post‑MVP): structuredOutput, storeResult, loop/while/until, parallelMerge/aggregate, functionCall/tool nodes.
  - Scheduling/Ratelimits: concurrency budgeting, provider backoff integration, backpressure signals.
  - Editor UX: templates/wizards, What‑if cost estimator (advanced), context sidecar introspection.

## 1) Executive Summary
A node-based visual editor to design, run, and iterate custom agent conversation flows. It enables multi‑model orchestration, typed node I/O, provider‑agnostic operation with capability-aware fallbacks, robust safety/policy controls, streaming execution, observability, testing/simulation, and project/user storage. This document consolidates the original 6 specs plus the v2 improvements into a single, implementable plan.

## 2) Goals and Non‑Goals
- Goals
  - Visual flow design (ReactFlow), JSON storage, typed ports, runtime validation
  - Provider‑agnostic flows with provider capability checks and fallbacks
  - Multi‑model orchestration (classification vs generation, parallel branches)
  - Prefer lightweight models (e.g., gpt‑nano/mini) for intent classification and tool selection; avoid brittle regex heuristics

  - Safety/policy: approvals, budgets, tool allowlists, sandbox/dry‑run, retries
  - Observability: per‑node spans, token/cost attribution, heatmaps, traces
  - Deep visibility and debugging: watch the run traverse nodes, step/pause/resume, inspect per-node inputs/outputs/logs, and replay traces

  - Simulation mode and record/replay; reproducible runs
  - Backward compatibility with current llm:auto; opt‑in via project flow
- Non‑Goals (MVP)
  - Marketplace, user-defined JS nodes (will require sandbox), live collaborative editing

## 3) Current State (baseline)
- Router in electron/main.ts: regex intent (plan/edit/terminal/chat), context injection, chat/agent paths per provider
- Provider adapters: openai/anthropic/gemini with chatStream/agentStream
- Context: .hifide-public/context.* and local indexer
- UI: AgentView, ActivityBar, StatusBar; Zustand app store; session management

## 4) Design Principles
- Safety‑first, least privilege; small, composable nodes; deterministic where possible
- Provider‑agnostic core; capability-aware fallbacks; explicit provider-specific nodes later
- Typed boundaries (JSON Schema) + runtime validation
- Streaming UX with clear cost/usage feedback
- Testability (simulation, record/replay) and observability by default

## 5) Data Model (storage & types)
- FlowDefinition
  - id, name, description, version (semver)
  - nodes: FlowNode[]; edges: FlowEdge[]
  - variables?: Record<string, any>
  - metadata?: { createdAt, updatedAt, author?, tags? }
- FlowNode
  - id, type, position {x,y}
  - data: { label: string; config: Record<string, any> }
  - io?: { inputSchema?: JSONSchema; outputSchema?: JSONSchema; pure?: boolean }
- FlowEdge
  - id, source, target, sourceHandle?, targetHandle?, label?, condition?
- Storage Locations
  - Built‑in templates: electron/app/flows/defaults/*.json
  - Project active: .hifide-public/flows/active-flow.json
  - User library: %USERPROFILE%/.hifide/flows/*.json
- Versioning & Migrations
  - FlowDefinition.version + optional node.typeVersion
  - FlowMigrator to step flows to current schema; warn on breaking changes

## 6) Provider Capability Model
- CapabilityRegistry per provider: { toolCalling, jsonMode, streaming, promptCaching, vision, maxInputTokens, rateLimits, structuredOutput, nativePlanMode? }
- Validate at design time (editor warnings) and runtime (CapabilityGuard node)
- Fallbacks: alternate provider/model or route; clear error if impossible
- Active Provider & Cheapest Classifier
  - Active provider: session/app setting; if unset, select first validated provider with API key; persisted; flows can pin a provider
  - Cheapest classification-capable model: derive from pricing config + capability tags; auto-select per IntentClassifier/ToolSelector; always overridable on node
  - Offline models: provider entries may be local/offline with costUSD=0 and offline=true; capability checks still apply


## 7) Node Catalog (MVP + Advanced)
- Input
  - userMessage, systemMessage, contextLoader, messageHistory
  - historySummarizer/contextCompactor (maintain window within model limits while preserving salient details)

- LLM
  - chat, agent, structuredOutput
- Processing/Control
  - intentClassifier (LLM-first; lightweight models like gpt-nano), router, conditional, transform, merge
- Output
  - observationIngest (write sidecar summaries/observations into ConversationStream in a controlled order)

  - parallelSplit, parallelMerge
  - loop/while/until (explicit feedback edges with controller), converge (until threshold met), feedbackMerge

- Safety/Policy (NEW)
  - approvalGate (auto-approve policy integration), budgetGuard, capabilityGuard
  - errorDetection (quality/guardrail): detect errors/hallucinations/unsafe or low-confidence outputs using rules + lightweight LLM; routes to retry/escalate/approval
  - redactor (privacy): mask secrets/PII before sending to external providers; configurable patterns and LLM assist

  - ToolSelector config: default to a small/cheap model; optional confidence threshold to escalate to a larger model; explicit allowlist of tools

- Orchestration (NEW)
  - modelRouter (minCost/minLatency/bestWithinBudget), toolSelector (LLM-based tool choice with lightweight models), retryWithBackoff, cache, toolSandbox
- Tools
  - toolFilter, toolExecutor (future: granular)
- Output
  - streamResponse, storeResult

Each node declares input/output JSON Schemas; the editor validates connections, and runtime validates inputs. Pure nodes can be cached per run.

## 8) Execution Engine
- Components
  - FlowExecutor: traverse DAG with branching, loops (guarded), streaming
  - FlowValidator: compile-time checks (entry, orphans, cycles, schema match)
  - ExecutionContext: run state; variables; message history; provider/model defaults; tool access; stream callback; span/log emitters
  - NodeRegistry: maps node.type → executor (typed IO)
  - ConversationStream: central, persisted stream of messages/context/cache for the primary conversation path; side-path nodes may read and append observations without derailing the primary stream

  - ToolRunner: transactional, idempotent, dry‑run, retries, audit trail
  - Scheduler: concurrency limits (per run & per provider), backpressure via provider rate limiter
- Semantics
  - Central stream vs side-paths: designate a primary conversational path that persists to the ConversationStream; ancillary nodes (analytics, retrieval, classification) operate as sidecars and may feed summaries back without bloating or fragmenting the main stream

  - Per-node timeouts and retry policies (retryWithBackoff node or node config)
  - Determinism: pure node outputs cacheable; impure require ToolRunner
  - Multi‑turn: RunState persisted (resume tokens) to re‑enter flows on next user turn
  - Cycles/loops: supported via explicit Loop/While/Until nodes and feedback edges; loops must declare an exit condition (convergence predicate) or be driven by external events (e.g., user messages) via the ConversationStream; optional maxIterations/timeBudget for safety; expose break/continue ports; per‑iteration state and accumulators; side‑effect nodes inside loops must declare idempotency keys and (optional) compensating actions

  - Model selection: AI-consuming nodes may specify provider/model overrides; the main ConversationStream pins a single model decided at entry to preserve context and cannot switch mid-run
  - Loop error policy: per-loop configuration for onError = { retry: { attempts, backoff }, continue, break }; default: retry 1 with backoff, then surface error
  - Cache/invalidation: pure node cache keys = hash(inputs, config, model, swVersion); per-node TTL; invalidate from UI; traces record cache hits


  - Side‑effects: gated by approvals/budgets/allowlists; summarized in activity

## 9) Safety & Policy
- Approvals: approvalGate node honors app store autoApproveEnabled/threshold
- Budgets: budgetGuard enforces token/$/time; exposes remainingBudget downstream
- Tool allowlists: per-flow policy and per-node toolFilter; terminal limited unless explicitly allowed
- Dry‑run/sandbox: toolSandbox for CI/simulation; logs instead of executing
- Rate limits: integrate provider ratelimit module; backoff & queueing via Scheduler

## 10) Observability & Analytics
- Per-node spans: { nodeId, type, start, end, status, retries, error }
- Token/cost attribution per node using pricing config; aggregate per run
- Watch Mode: live traversal highlighting, per-node IO inspector, step/pause/resume, breakpoints, and replay timeline to demystify agent runs

- Traces: exportable JSON (timeline); visible on canvas as overlays (heatmap)
- Run summary: slowest/most expensive nodes; cache hit rate; parallelism stats
- What‑if Cost Estimator: pre‑run projection using node configs, pricing tables, and branch probabilities; highlights expensive nodes and suggests cheaper routes


## 11) UX & Editor (ReactFlow)
- Pro mode with curated examples
  - Full catalog, parallelism, guards, retries
  - Example flows and wizards provide progressive disclosure without a separate "simple" mode
- Editor elements: NodePalette, FlowCanvas, PropertiesPanel, Toolbar
- On-canvas validation warnings; cost/latency badges; error overlays
- Templates & wizards for common patterns (intent-based routing, planning-first)

## 12) Testing & Simulation
- Simulation Mode (no external side effects): provider and tool mocks; seeded randomness; deterministic outputs
- Record/Replay: capture external responses to replay locally; optional snapshot assertions (de‑emphasized)
- CI: run simulation tests; forbid real tool side‑effects

## 13) Storage & Lifecycle
- Load active flow precedence: Project > User default > Built‑in default
- FlowManager API: load/save/migrate/list; provenance (author, createdAt)
- Backups and signed hashes (future) for shared flows

## 14) Performance
- Scheduler concurrency caps; per-provider queues; singleflight for repeated context loads; memoized index search per run
- Stream aggregation with backpressure to UI

## 15) Migration Strategy (compat)
- Keep current ipc llm:auto as default path
- If project flow exists, route to FlowExecutor; else legacy router
- Provide default template that replicates current behavior

## 16) Implementation Phases & Milestones
- Phase 1: Foundation (2 weeks)
  - Add ReactFlow UI (FlowEditorView, palette, properties)
  - Minimal nodes: userMessage, chat, streamResponse
  - FlowDefinition types; FlowManager; default simple-chat template
  - Stub FlowExecutor that calls provider.chatStream; streaming to UI
  - Watch Mode plumbing: subscribe/emit node events/spans; basic step/pause/resume controls in UI
  - Auto-select cheapest classification-capable model helper; per-node override surface
- Phase 2: Core Nodes (2 weeks)
  - contextLoader, messageHistory, intentClassifier (LLM-first), router/conditional/transform, toolFilter
  - Design-time validation (entry/orphans/schema); connection validation in editor
- Phase 3: Engine & Safety (2 weeks)
  - Full FlowExecutor with branching & parallel (split/merge), timeouts
  - ToolRunner (idempotency, retries), approvalGate, budgetGuard, capabilityGuard
  - Provider capability registry
- Phase 4: Orchestration & Obs (1 week)
  - modelRouter, toolSelector, retryWithBackoff, cache, toolSandbox
  - Per-node spans, token/cost overlays, trace export
- API surfaces (implemented MVP)
  - window.flows: list(), load(idOrPath), save(id, def)
  - window.flowExec: run({ requestId, flowId?, flowDef?, input?, model?, provider?, sessionId? }), stop(requestId), onEvent(listener)


- Phase 1 progress (landed in repo)
  - ReactFlow editor scaffold and FlowEditor route
  - Built-in simple-chat template and FlowManager list/load/save
  - MVP FlowExecutor IPC: flow:run/flow:stop with nodeStart/nodeEnd/io/done events
  - Watch Mode subscription in UI and live IO inspector
  - FlowDefinition types (FlowNode/FlowEdge/FlowDefinition) for MVP nodes
  - React Flow types note: v11 ships types (no @types/reactflow)
  - Active Provider UI now resolves and displays the selected model; renderer prefers pricing-aware selection from app store, falling back to main IPC.

  - Next in Phase 1: Active Provider selector in toolbar; cheapest-classifier helper (IPC)
  - Watch Mode controls: Pause/Resume IPC stubs added; UI to follow with step/breakpoints in next commit


- Phase 5: Testing & Multi‑turn (1+ week)
  - Pause/Resume now gate streaming: chunks buffer while paused and flush on resume/done (MVP); breakpoints can be set per-node for simple-chat (userMessage/chat/streamResponse); Step button scaffolded.

- Cheapest-classifier helper implemented (IPC: models:cheapestClassifier) using a conservative heuristic today; will incorporate pricing tables and capability tags in a subsequent pass.

  - Simulation Mode and record/replay; RunState resume
  - Performance tuning; polish; docs + templates

- Phase 2 scaffolding started
  - NodeKind extended: approvalGate, budgetGuard, errorDetection, redactor (types only for now)
  - Next: add UI config panes for these nodes and stub executors that emit spans/IO; then wire business logic incrementally (approval via autoApprove policy; budget via pricing+tokens; errorDetection via LLM+rules; redactor via rules)

- Simple Chat template updated to include: userMessage → redactor → chat → approvalGate → streamResponse. Executor emits nodeStart/nodeEnd and IO for redactor/approvalGate (MVP, no-op logic for now). Breakpoints and Step respected at these boundaries.

- Watch UI now includes breakpoint toggles for: userMessage, redactor, chat, approvalGate, streamResponse; Step button (MVP) resumes one boundary then auto-pauses.

- ApprovalGate logic: if auto-approve is disabled, execution pauses at approvalGate and the UI (Resume/Step) controls continue; if enabled, gate auto-approves and continues. Policy is passed in run args from renderer (autoApproveEnabled/threshold).

- BudgetGuard (MVP stub) added before chat: emits nodeStart/nodeEnd and respects pause/breakpoint/step; UI now shows a breakpoint toggle for it. Future work: wire pricing+tokens and block when exceeding budget.

- Redactor implemented (MVP): masks emails, API keys (sk-), AWS AKIA keys, and 16+ digit numbers before chat; emits a count-only IO note (no sensitive content). Rules are toggleable from the Watch panel.
- BudgetGuard estimation (MVP): pre-run cost estimate using simple token heuristic (chars/4 + 400 output) and current model pricing. If maxUSD provided and estimate exceeds it, flow errors at budgetGuard and stops; otherwise continues and emits an OK note with estimated $.
- ErrorDetection (MVP): inserted between chat and approvalGate. Heuristic flags if output contains suspicious terms (password/api key/secret) or 16+ digit numbers. Config in Watch panel: enable + block on flag. Breakpoints supported. If block on flag is set and a flag is detected, flow errors at errorDetection and stops; otherwise continues and emits an IO note.

- Watch Mode UX polish (MVP):
  - Show status text near controls: Running vs Paused at <node>.
  - Highlight paused-at nodes with dashed amber outline; running nodes with solid blue.
  - Disable Run when the selected provider has no valid API key; show helper tooltip.
  - BudgetGuard now supports Warn vs Block on exceed (toggle in Watch panel).


Deliverables per phase: working UI, node catalog subset, engine features, tests, docs.

## 17) Risks & Mitigations
- Complexity/UX → templates, curated example flows, and progressive disclosure with inline hints
- Provider differences → capability registry + guards + fallbacks
- Costs/runaway loops → budgets, timeouts, iteration limits, circuit breakers
- Debuggability → traces, spans, overlays, replay
- Breaking changes → migrations, versioning, provenance

## 18) Success Metrics
- Default flow exactly replicates legacy behavior
- Create & run a custom flow in <10 minutes
- Execution overhead <100ms vs legacy route
  - Watch controls: subscribe to node events/spans; step/pause/resume; request node IO snapshots during a run

- 50–80% cost reduction for flows using classification routing
- >90% stability in simulation suite; green CI on simulation runs

## 19) API Surfaces (Renderer/Main)
- Preload additions
  - window.flows: { list(), load(id|path), save(def), migrate(def), capabilities(): ProviderCaps }
  - ConversationStream APIs: persisted per session (windowed messages, attached context, caches); nodes can read and append observations via flowExec without fragmenting the primary chat

  - window.flowExec: { run(flowId, sessionId, userMessage, options), stop(requestId) }
- Main process
  - FlowManager: fs I/O for user/project/built‑in flows; migrations
  - FlowExecutor IPC channel: start/stop; stream chunks; tool events; spans; token usage
  - Provider capability registry; pricing access; ratelimiter integration
- Zustand additions (app store)
  - view: add 'flowEditor'; settings: autoApprove*, pricing, default models; session token usage already present

## 20) Default Templates
- simple-chat.json (linear chat)
- default-agent.json (replicates legacy: intent routing, context, tools when edit)
- planning-mode.json (planning, approval, then execution)

- Loop Controller Config (example)
  - { maxIterations: 10, timeBudgetMs: 5000, convergeWhen: { metric: "score", threshold: 0.95, comparator: ">=" }, onBreak: "halt", onContinue: "next" }

## 21) Minimal Schemas (examples)
- IntentClassifier Output
  - { intent: enum['plan','edit','chat'], confidence: number [0..1] }
- BudgetGuard Output
  - { remaining: { tokens, costUSD, ms }, violated?: string }
- ModelRouter Output
  - { provider: string, model: string, rationale?: string }

## 22) Editor Validation Rules
- Must contain exactly one entry node (userMessage)
- All terminal paths must end in an output node (streamResponse or storeResult)
- Edge type compatibility via JSON Schema (assignable check)
- No cycles unless guarded by loop node with iteration cap

## 23) File Structure (planned)
- src/components/FlowEditor/{ FlowEditorView.tsx, Toolbar.tsx, NodePalette.tsx, FlowCanvas.tsx, PropertiesPanel.tsx, nodes/* }
- src/store/flowEditor.ts (editor state)
- src/services/flowExecution/{ FlowExecutor.ts, FlowValidator.ts, ExecutionContext.ts, NodeRegistry.ts, executors/* }
- electron/app/flows/{ defaults/*, flowManager.ts }
- docs/{ flow-editor-*.md, this master plan }

## 24) Package Management
- Dependencies: reactflow (runtime) — installed
- Notes: React Flow v11 ships TypeScript types; no separate @types package needed
- Installed via:
  - pnpm add reactflow

## 25) Step‑by‑Step Kickoff Checklist
1. Create FlowDefinition types and FlowManager (load/save/migrate) with built‑in templates
2. Add FlowEditor route & scaffold UI (palette/canvas/properties/toolbar)
3. Implement minimal nodes (userMessage, chat, streamResponse) and stub FlowExecutor
4. Add default simple-chat template and run end‑to‑end (stream to UI)
5. Introduce editor validation and connection checks
6. Add contextLoader, messageHistory, intentClassifier (LLM-first lightweight model)
7. Add router/conditional; replicate legacy default flow as template
8. Integrate provider capability registry + capabilityGuard
9. Add approvalGate, budgetGuard; wire to app store auto-approve & pricing
10. Implement parallelSplit/merge + Scheduler limits
11. Add modelRouter, toolSelector and retryWithBackoff; cache and toolSandbox
12. Build Simulation Mode and record/replay; CI
13. Observability overlays and trace export; performance tuning
14. Documentation and examples; GA behind feature flag

## 26) Open Questions
- Subflows/reusable composites in MVP?
- Degree of user scripting (custom compute) vs curated nodes for v1?
- On‑disk signing of shared flows for provenance?
- How strict to be with design‑time schema compatibility (coercions)?

---
This master plan supersedes and consolidates the prior documents. Proceed with Phase 1 once dependency installation is approved, using this plan as the implementation source of truth.

