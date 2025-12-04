import { useMemo, useState, useRef, useCallback } from 'react'

const logSessionBarError = (label: string, err: unknown) => {
  console.warn(`[SessionControlsBar] ${label}`, err)
}
import { Group, Text, Menu, Button, TextInput, Card, ActionIcon, Tooltip, Loader } from '@mantine/core'
import { IconPlayerPlay, IconPlayerStop, IconChevronDown, IconChevronRight, IconAlertTriangle, IconX } from '@tabler/icons-react'
import { FlowService } from '../services/flow'
import { getBackendClient } from '../lib/backend/bootstrap'
import { useFlowRuntime, refreshFlowRuntimeStatus } from '../store/flowRuntime'
import { useSessionUi } from '../store/sessionUi'
import { splitFlowsByLibrary, getLibraryLabel } from '../utils/flowLibraries'
import SessionInput from './SessionInput'

export default function SessionControlsBar() {
  const flows = useSessionUi((s: any) => s.flows)
  const executedFlowId = useSessionUi((s: any) => s.executedFlowId)
  const currentSessionId = useSessionUi((s: any) => s.currentId)
  const providerValid = useSessionUi((s: any) => s.providerValid)
  const modelsByProvider = useSessionUi((s: any) => s.modelsByProvider)
  const providerId = useSessionUi((s: any) => s.providerId)
  const modelId = useSessionUi((s: any) => s.modelId)
  const setExecutedFlow = useSessionUi((s: any) => s.setExecutedFlow)
  const setProviderModel = useSessionUi((s: any) => s.setProviderModel)

  const [filter, setFilter] = useState('')
  const [flowError, setFlowError] = useState<string | null>(null)
  const [metaPending, setMetaPending] = useState(false)
  const [actionInFlight, setActionInFlight] = useState<'start' | 'stop' | null>(null)
  const pendingMetaPromises = useRef<Array<Promise<unknown>>>([])

  const trackMetaPromise = useCallback(<T,>(promise?: Promise<T>) => {
    if (!promise || typeof promise.then !== 'function') return promise
    const tracked = promise.finally(() => {
      pendingMetaPromises.current = pendingMetaPromises.current.filter((p) => p !== tracked)
      if (pendingMetaPromises.current.length === 0) {
        setMetaPending(false)
      }
    })
    pendingMetaPromises.current.push(tracked)
    setMetaPending(true)
    return tracked
  }, [])

  const waitForPendingMeta = useCallback(async () => {
    if (pendingMetaPromises.current.length === 0) return
    const pending = [...pendingMetaPromises.current]
    await Promise.allSettled(pending)
  }, [])


  const maybeRefreshModels = async (pid: string) => {
    try {
      const valid = !!(providerValid?.[pid])
      const has = Array.isArray(modelsByProvider?.[pid]) && (modelsByProvider?.[pid]?.length || 0) > 0
      if (!valid || has) return
      const client = getBackendClient(); if (!client) return
      const res: any = await client.rpc('provider.refreshModels', { provider: pid })
      if (res?.ok) {
        const models = Array.isArray(res.models) ? res.models : []
        const cur = useSessionUi.getState()
        const nextMap = { ...(cur.modelsByProvider || {}), [pid]: models }
        useSessionUi.getState().__setSettings(cur.providerValid || {}, nextMap)
      }
    } catch (err) {
      logSessionBarError('provider.refreshModels failed', err)
    }
  }

  const feStatus = useFlowRuntime((s: any) => s.status)
  const requestId = useFlowRuntime((s: any) => s.requestId)
  const isHydrating = useFlowRuntime((s: any) => s.isHydrating)

  const statusDotColor = useMemo(
    () => (feStatus === 'running' ? '#2fbfa5' : feStatus === 'waitingForInput' ? '#e0a043' : '#6b6b6b'),
    [feStatus]
  )

  const statusLabel = useMemo(() => {
    if (feStatus === 'running') return 'Running'
    if (feStatus === 'waitingForInput') return 'Waiting for input'
    return 'Stopped'
  }, [feStatus])

  const allFlows = Array.isArray(flows) ? (flows as any[]) : []
  const { system: systemFlows, user: userFlows, workspace: workspaceFlows } = splitFlowsByLibrary(allFlows)

  const providerOptions = useMemo(() => {
    const all = [
      { id: 'openai', name: 'OpenAI' },
      { id: 'anthropic', name: 'Anthropic' },
      { id: 'gemini', name: 'Gemini' },
      { id: 'fireworks', name: 'Fireworks' },
      { id: 'xai', name: 'xAI' },
    ] as const
    const anyValidated = Object.values(providerValid || {}).some(Boolean)
    return anyValidated ? all.filter((p) => (providerValid as any)[p.id]) : all
  }, [providerValid])

  const filteredProviders = useMemo(() => {
    const q = (filter || '').toLowerCase().trim()
    if (!q) return providerOptions
    return providerOptions.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
  }, [providerOptions, filter])

  const modelsForProvider = useMemo(() => {
    const raw = modelsByProvider?.[providerId || ''] || []
    if (providerId !== 'fireworks') return raw
    return raw.map((o: any) => ({ ...o, label: String(o.label || o.value).split('/').pop() || o.label || o.value }))
  }, [modelsByProvider, providerId])

  const currentProviderLabel = useMemo(() => {
    const p = providerOptions.find((x) => x.id === providerId)
    const m = modelsForProvider.find((x: any) => x.value === modelId)
    if (p && m) return `${p.name}: ${m.label || m.value}`
    if (p) return p.name
    return 'Provider / Model'
  }, [providerOptions, modelsForProvider, providerId, modelId])

  const handleFlowChange = useCallback(async (flowId: string) => {
    if (!flowId || !currentSessionId) return
    const update = trackMetaPromise(setExecutedFlow(flowId))
    if (!update || typeof update.then !== 'function') return
    try {
      await update
    } catch (err) {
      console.warn('[SessionControlsBar] setExecutedFlow failed', err)
    }
  }, [currentSessionId, setExecutedFlow, trackMetaPromise])

  const handleProviderModelChange = useCallback(async (pid: string, mid: string) => {
    if (!currentSessionId) return
    const update = trackMetaPromise(setProviderModel(pid, mid))
    if (!update || typeof update.then !== 'function') return
    try {
      await update
    } catch (err) {
      console.warn('[SessionControlsBar] setProviderModel failed', err)
    }
  }, [currentSessionId, setProviderModel, trackMetaPromise])

  const start = useCallback(async () => {
    if (actionInFlight) return
    setActionInFlight('start')
    try {
      await waitForPendingMeta()
      const res = await FlowService.start({})
      if (!res?.ok) {
        const code = (res as any)?.code
        let message = res?.error || 'Flow could not be started.'
        if (code === 'no-workspace') {
          message = 'No workspace is open. Open a folder before starting a flow.'
        } else if (code === 'no-current-session' || code === 'session-not-found') {
          message = 'No active session. Create or select a session first, then try again.'
        } else if (code === 'no-session-context') {
          message = 'This session has no conversation context yet. Send a message first, then start the flow.'
        }
        setFlowError(message)
        console.warn('[SessionControlsBar] flow.start failed', res?.error || 'unknown error', code)
        return
      }

      setFlowError(null)

      const rid = res.requestId
      console.log('[SessionControlsBar] flow.start succeeded, requestId:', rid)
      if (rid) {
        console.log('[SessionControlsBar] Setting requestId in flowRuntime store:', rid)
        try { useFlowRuntime.getState().setRequestId(rid) } catch (err) {
          logSessionBarError('setRequestId failed', err)
        }
        // Do not force status="running" here; let runtime events / snapshots drive it
        setTimeout(async () => {
          try {
            const snap: any = await FlowService.getStatus(rid)
            if (snap && !Array.isArray(snap)) {
              const rt = useFlowRuntime.getState()
              if (snap.status === 'waitingForInput') {
                try { rt.setStatus('waitingForInput') } catch (err) {
                  logSessionBarError('setStatus(waitingForInput) failed', err)
                }
              } else if (snap.status === 'running') {
                try { rt.setStatus('running') } catch (err) {
                  logSessionBarError('setStatus(running) failed', err)
                }
              }
            }
          } catch (err) {
            logSessionBarError('flow status snapshot fetch failed', err)
          }
        }, 200)
      } else {
        // Fallback: look for any active flow and hydrate from snapshot
        setTimeout(async () => {
          try {
            const act = await FlowService.getActive()
            if (Array.isArray(act) && act.length > 0) {
              const id = act[0]
              const snap: any = await FlowService.getStatus(id)
              const rt = useFlowRuntime.getState()
              try {
                rt.setRequestId(id)
              } catch (err) {
                logSessionBarError('setRequestId fallback failed', err)
              }

              if (snap && !Array.isArray(snap)) {
                if (snap.status === 'waitingForInput') {
                  try {
                    rt.setStatus('waitingForInput')
                  } catch (err) {
                    logSessionBarError('fallback setStatus(waitingForInput) failed', err)
                  }
                } else if (snap.status === 'running') {
                  try {
                    rt.setStatus('running')
                  } catch (err) {
                    logSessionBarError('fallback setStatus(running) failed', err)
                  }
                }
              }
            }
          } catch (err) {
            logSessionBarError('flow active status fetch failed', err)
          }
        }, 150)
      }
    } catch (e) {
      console.warn('[SessionControlsBar] start failed', e)
      setFlowError('Flow could not be started. Check your connection and try again.')
    } finally {
      setActionInFlight(null)
    }
  }, [actionInFlight, waitForPendingMeta])

  const stop = useCallback(async () => {
    if (actionInFlight) return
    setActionInFlight('stop')
    try {
      await waitForPendingMeta()
      await FlowService.cancel(requestId)
    } catch (err) {
      console.warn('[SessionControlsBar] stop failed', err)
    } finally {
      setActionInFlight(null)
      // Instead of forcing status, resync from backend truth
      try {
        await refreshFlowRuntimeStatus()
      } catch (err) {
        logSessionBarError('refreshFlowRuntimeStatus failed', err)
      }
    }
  }, [actionInFlight, requestId, waitForPendingMeta])

  return (
    <div style={{ borderTop: '1px solid #2a2a2a', backgroundColor: '#111', padding: '4px 8px', position: 'sticky', bottom: 0, zIndex: 5, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {flowError && (
        <Card
          padding="xs"
          radius="sm"
          withBorder
          style={{
            width: '100%',
            background: '#2a1313',
            borderColor: '#b91c1c',
            color: '#fecaca',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <Group gap="xs" align="center" style={{ flex: 1 }}>
            <IconAlertTriangle size={14} color="#fecaca" />
            <Text size="xs" c="#fecaca" style={{ whiteSpace: 'pre-wrap' }}>
              {flowError}
            </Text>
          </Group>
          <ActionIcon
            size="xs"
            variant="subtle"
            color="red"
            onClick={() => setFlowError(null)}
            aria-label="Dismiss flow error"
          >
            <IconX size={12} />
          </ActionIcon>
        </Card>
      )}

      <Group gap="xs" wrap="nowrap" justify="flex-start" style={{ width: '100%', alignItems: 'center' }}>
        {isHydrating ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 6px', borderRadius: 6, background: '#161616', border: '1px solid #2a2a2a' }}>
            <Loader size="xs" color="gray" />
            <Text size="xs" c="dimmed">Hydrating…</Text>
          </div>
        ) : metaPending ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 6px', borderRadius: 6, background: '#161616', border: '1px solid #2a2a2a' }}>
            <Loader size="xs" color="gray" />
            <Text size="xs" c="dimmed">Updating flow settings…</Text>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 6px', borderRadius: 6, background: '#161616', border: '1px solid #2a2a2a' }}>
            <span style={{ width: 6, height: 6, borderRadius: 6, backgroundColor: statusDotColor, display: 'inline-block' }} />
            <Text size="xs" c="dimmed">{statusLabel}</Text>
          </div>
        )}

        <div style={{ flex: 1 }} />
        {feStatus === 'stopped' ? (
          <Tooltip label={metaPending ? 'Applying changes…' : actionInFlight === 'start' ? 'Starting…' : 'Start'}>
            <ActionIcon
              variant="subtle"
              size="sm"
              color="teal"
              onClick={start}
              disabled={metaPending || actionInFlight !== null || isHydrating}
            >
              <IconPlayerPlay size={14} />
            </ActionIcon>
          </Tooltip>
        ) : (
          <Tooltip label={actionInFlight === 'stop' ? 'Stopping…' : 'Stop'}>
            <ActionIcon
              variant="subtle"
              size="sm"
              color="red"
              onClick={stop}
              disabled={actionInFlight !== null}
            >
              <IconPlayerStop size={14} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>

      {feStatus === 'waitingForInput' && (
        <Group gap="sm" wrap="nowrap" justify="flex-start" style={{ width: '100%' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <SessionInput />
          </div>
          <Card padding="xs" radius="sm" withBorder style={{ minWidth: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#181818', borderStyle: 'dashed', borderColor: '#3e3e42' }}>
            <Text size="xs" c="#999">Focus</Text>
          </Card>
        </Group>
      )}

      <Group gap="xs" wrap="nowrap" justify="flex-start" style={{ width: '100%', alignItems: 'center' }}>
        <Group gap="xs" wrap="nowrap">
          <Text size="xs" c="dimmed">Flow:</Text>
          <Menu withinPortal position="top-start" offset={4}>
            <Menu.Target>
              <Button size="xs" radius="xs" variant="subtle" rightSection={<IconChevronDown size={14} />}>
                {flows.find((f: any) => f.id === executedFlowId)?.name || 'Select flow'}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <TextInput
                placeholder="Type to filter flows"
                value={filter}
                onChange={(e) => setFilter(e.currentTarget.value)}
                size="xs"
                styles={{ input: { background: '#1e1e1e', color: '#ddd' } }}
              />
              <Menu.Divider />
              {(filter || '').trim().length > 0 ? (
                (() => {
                  const q = (filter || '').trim().toLowerCase()
                  const matches = allFlows.filter((f: any) =>
                    f.name.toLowerCase().includes(q) || f.id.toLowerCase().includes(q)
                  )
                  return matches.length > 0
                    ? matches.map((f: any) => {
                      const lib = getLibraryLabel(f.library)
                      const isCurrent = f.id === executedFlowId
                      return (
                        <Menu.Item key={f.id} onClick={() => handleFlowChange(f.id)}>
                          <Group gap={6}>
                            <Text size="xs" c="#999" style={{ width: 86 }}>{`[${lib}]`}</Text>
                            <Text size="sm">{f.name}{isCurrent ? ' ✓' : ''}</Text>
                          </Group>
                        </Menu.Item>
                      )
                    })
                    : (<Menu.Item disabled>No flows</Menu.Item>)
                })()
              ) : (
                <>
                  {systemFlows.length > 0 && (
                    <Menu withinPortal offset={6} position="right-start" trigger="hover" openDelay={80} closeDelay={120}>
                      <Menu.Target>
                        <Menu.Item rightSection={<IconChevronRight size={12} />}>System Library</Menu.Item>
                      </Menu.Target>
                      <Menu.Dropdown style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                        {systemFlows.map((f: any) => (
                          <Menu.Item key={f.id} onClick={() => handleFlowChange(f.id)}>
                            {f.name}{f.id === executedFlowId && ' ✓'}
                          </Menu.Item>
                        ))}
                      </Menu.Dropdown>
                    </Menu>
                  )}
                  {userFlows.length > 0 && (
                    <Menu withinPortal offset={6} position="right-start" trigger="hover" openDelay={80} closeDelay={120}>
                      <Menu.Target>
                        <Menu.Item rightSection={<IconChevronRight size={12} />}>User Library</Menu.Item>
                      </Menu.Target>
                      <Menu.Dropdown style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                        {userFlows.map((f: any) => (
                          <Menu.Item key={f.id} onClick={() => handleFlowChange(f.id)}>
                            {f.name}{f.id === executedFlowId && ' ✓'}
                          </Menu.Item>
                        ))}
                      </Menu.Dropdown>
                    </Menu>
                  )}
                  {workspaceFlows.length > 0 && (
                    <Menu withinPortal offset={6} position="right-start" trigger="hover" openDelay={80} closeDelay={120}>
                      <Menu.Target>
                        <Menu.Item rightSection={<IconChevronRight size={12} />}>Workspace Library</Menu.Item>
                      </Menu.Target>
                      <Menu.Dropdown style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                        {workspaceFlows.map((f: any) => (
                          <Menu.Item key={f.id} onClick={() => handleFlowChange(f.id)}>
                            {f.name}{f.id === executedFlowId && ' ✓'}
                          </Menu.Item>
                        ))}
                      </Menu.Dropdown>
                    </Menu>
                  )}
                  {(systemFlows.length + userFlows.length + workspaceFlows.length === 0) && (
                    <Menu.Item disabled>No flows</Menu.Item>
                  )}
                </>
              )}
            </Menu.Dropdown>
          </Menu>
        </Group>

        <Group gap="xs" wrap="nowrap">
          <Text size="xs" c="dimmed">Model:</Text>
          <Menu withinPortal position="top-start" offset={4}>
            <Menu.Target>
              <Button size="xs" radius="xs" variant="subtle" rightSection={<IconChevronDown size={14} />}>
                {currentProviderLabel}
              </Button>
            </Menu.Target>
            <Menu.Dropdown style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              <TextInput
                placeholder="Search provider or model"
                value={filter}
                onChange={(e) => setFilter(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const q = (filter || '').trim().toLowerCase()
                    let chosen: { pid: string; mid: string } | null = null
                    for (const p of filteredProviders) {
                      const models = ((modelsByProvider?.[p.id] || []) as any[])
                      for (const m of models) {
                        const rawLabel = m.label || m.value
                        const short = p.id === 'fireworks' ? String(rawLabel).split('/').pop() || rawLabel : rawLabel
                        const lbl = String(short)
                        if (!q || lbl.toLowerCase().includes(q) || String(m.value).toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)) {
                          chosen = { pid: p.id, mid: m.value }
                          break
                        }
                      }
                      if (chosen) break
                    }
                    if (chosen) {
                      e.preventDefault()
                      handleProviderModelChange(chosen.pid, chosen.mid)
                      setFilter('')
                    }
                  }
                }}
                size="xs"
                styles={{ input: { background: '#1e1e1e', color: '#ddd' } }}
              />
              <Menu.Divider />
              {(filter || '').trim().length > 0 ? (
                (() => {
                  const items = filteredProviders.flatMap((p) => (
                    (modelsByProvider?.[p.id] || []).map((m: any) => {
                      const label = p.id === 'fireworks' ? (m.label || m.value).toString().split('/').pop() || m.label || m.value : (m.label || m.value)
                      const q = (filter || '').trim().toLowerCase()
                      const matchProvider = p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
                      const matchModel = String(label || '').toLowerCase().includes(q) || String(m.value || '').toLowerCase().includes(q)
                      if (!matchProvider && !matchModel) return null
                      return (
                        <Menu.Item key={`${p.id}:${m.value}`} onClick={() => handleProviderModelChange(p.id, m.value)}>
                          <Group gap={6}>
                            <Text size="xs" c="#999" style={{ width: 72 }}>{p.name}</Text>
                            <Text size="sm">{label}</Text>
                          </Group>
                        </Menu.Item>
                      )
                    })
                  )).filter(Boolean) as any[]
                  return items.length > 0 ? items : (<Menu.Item disabled>No matches</Menu.Item>)
                })()
              ) : (
                filteredProviders.map((p) => (
                  <Menu key={`prov-${p.id}`} withinPortal offset={6} position="right-start" trigger="hover" openDelay={80} closeDelay={120}>
                    <Menu.Target>
                      <Menu.Item rightSection={<IconChevronRight size={12} />} onMouseEnter={() => { void maybeRefreshModels(p.id) }}>{p.name}</Menu.Item>
                    </Menu.Target>
                    <Menu.Dropdown style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                      {((modelsByProvider?.[p.id] || []) as any[]).map((m: any) => {
                        const label = p.id === 'fireworks' ? (m.label || m.value).toString().split('/').pop() || m.label || m.value : (m.label || m.value)
                        return (
                          <Menu.Item key={`${p.id}:${m.value}`} onClick={() => handleProviderModelChange(p.id, m.value)}>
                            {label}
                          </Menu.Item>
                        )
                      })}
                      {(((modelsByProvider?.[p.id] || []) as any[]).length === 0) && (
                        providerValid?.[p.id]
                          ? <Menu.Item onClick={() => { void maybeRefreshModels(p.id) }}>Refresh models…</Menu.Item>
                          : <Menu.Item disabled>No models</Menu.Item>
                      )}
                    </Menu.Dropdown>
                  </Menu>
                ))
              )}
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
    </div>
  )
}

