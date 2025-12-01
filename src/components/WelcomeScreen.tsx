import { useEffect, useState, useMemo } from 'react'
import { Button, Group, Title, Text, Card, Stack, Divider, ScrollArea, Badge, Loader } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { getBackendClient } from '@/lib/backend/bootstrap'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js'
import { ApiKeysForm } from './ApiKeysForm'
import { useApiKeyManagement } from '../hooks/useApiKeyManagement'

interface RecentFolder { path: string; lastOpened: number }

export default function WelcomeScreen() {
  const [recents, setRecents] = useState<RecentFolder[]>([])
  const [loadingRecents, setLoadingRecents] = useState(false)
  const [whatsNewHtml, setWhatsNewHtml] = useState<string | null>(null)
  const [whatsNewLoading, setWhatsNewLoading] = useState(false)

  // Use the reusable API key management hook
  const { apiKeys, setApiKeys, providerValid, saving, validating, saveAndValidate, hydrate } = useApiKeyManagement(false)

  // Check if any provider is validated (not just if keys are entered)
  const hasValidatedKey = useMemo(() => {
    return Object.values(providerValid || {}).some((valid) => valid === true)
  }, [providerValid])

  // Markdown renderer for What's New (code highlighting + sanitized HTML)
  const md = useMemo(() => {
    const m = new MarkdownIt({
      html: false,
      linkify: true,
      typographer: true,
      highlight: (str: string, lang: string) => {
        try {
          if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(str, { language: lang }).value
          }
        } catch {}
        return ''
      }
    })
    return m
  }, [])



  const refreshRecents = async () => {
    const client = getBackendClient()
    if (!client) return
    setLoadingRecents(true)
    try {
      try { await (client as any).whenReady?.(5000) } catch {}
      const res: any = await client.rpc('workspace.listRecentFolders', {})
      if (res?.ok && Array.isArray(res.folders)) {
        setRecents(res.folders as RecentFolder[])
      }
    } catch (e) {
      console.error('[welcome] listRecentFolders failed:', e)
    } finally {
      setLoadingRecents(false)
    }
  }



  const fetchWhatsNew = async () => {
    setWhatsNewLoading(true)
    try {
      const tryPaths = ['/WHATSNEW.md', '/whatsnew.md', '/docs/WHATSNEW.md']
      let text: string | null = null
      for (const p of tryPaths) {
        try {
          const res = await fetch(p, { cache: 'no-store' })
          if (res.ok) {
            text = await res.text()
            break
          }
        } catch {}
      }
      if (!text) {
        try {
          const res = await fetch('https://raw.githubusercontent.com/joeleaver/hifide/main/WHATSNEW.md')
          if (res.ok) text = await res.text()
        } catch {}
        if (!text) {
          try {
            const res2 = await fetch('https://raw.githubusercontent.com/joeleaver/hifide/main/README.md')
            if (res2.ok) text = await res2.text()
          } catch {}
        }
      }
      if (text) {
        const html = md.render(text)
        const safe = DOMPurify.sanitize(html)
        setWhatsNewHtml(safe)
      } else {
        setWhatsNewHtml(null)
      }
    } finally {
      setWhatsNewLoading(false)
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const c = getBackendClient() as any
        await c?.whenReady?.(5000)
      } catch {}
      await Promise.allSettled([refreshRecents(), hydrate(), fetchWhatsNew()])
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openFolderDialogAndLoad = async () => {
    try {
      const client = getBackendClient()
      if (!client) throw new Error('Backend not ready')
      try { await (client as any).whenReady?.(5000) } catch {}

      const result: any = await client.rpc('workspace.openFolderDialog', {})
      if (result?.ok && result.path) {
        const res: any = await client.rpc('workspace.open', { root: result.path })
        if (res && res.ok === false) {
          notifications.show({ color: 'red', title: 'Open folder failed', message: String(res.error || 'Failed to open workspace') })
          return
        }
        // View will switch to 'flow' on workspace.ready
      }
    } catch (e) {
      notifications.show({ color: 'red', title: 'Open folder failed', message: String(e) })
    }
  }

  const openRecent = async (path: string) => {
    try {
      const client = getBackendClient()
      if (!client) throw new Error('Backend not ready')
      try { await (client as any).whenReady?.(5000) } catch {}
      const res: any = await client.rpc('workspace.open', { root: path })
      if (res && res.ok === false) {
        notifications.show({ color: 'red', title: 'Open recent failed', message: String(res.error || 'Failed to open workspace') })
        return
      }
      // View will switch to 'flow' on workspace.ready
    } catch (e) {
      notifications.show({ color: 'red', title: 'Open recent failed', message: String(e) })
    }
  }



  return (
    <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'stretch', background: '#1e1e1e' }}>
      <div style={{ width: 980, padding: 24, overflow: 'auto' }}>
        {hasValidatedKey ? (
          <>
            <Group justify="space-between" mb="sm">
              <div>
                <Title order={2} c="#fff">Welcome to HiFide</Title>
                <Text c="#aaa" size="sm">The agentic-first IDE. Open a folder to get started.</Text>
              </div>
              <Button size="md" onClick={openFolderDialogAndLoad}>Open Folder…</Button>
            </Group>

            <Group align="flex-start" grow gap="lg">
              <Card withBorder shadow="sm" padding="md" radius="md" style={{ background: '#232323' }}>
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Title order={4} c="#eee">Recent Workspaces</Title>
                    <Button size="compact-xs" variant="subtle" onClick={refreshRecents} loading={loadingRecents}>Refresh</Button>
                  </Group>
                  <Divider my={2} />
                  {recents.length === 0 ? (
                    <Text c="#888" size="sm">No recent workspaces yet.</Text>
                  ) : (
                    <ScrollArea h={220} offsetScrollbars>
                      <Stack gap={6}>
                        {recents.map((r) => (
                          <Card key={r.path} withBorder padding="sm" radius="sm" style={{ background: '#1b1b1b', cursor: 'pointer' }} onClick={() => openRecent(r.path)}>
                            <Group justify="space-between">
                              <div>
                                <Text c="#ddd" size="sm" style={{ wordBreak: 'break-all' }}>{r.path}</Text>
                                <Text c="#666" size="xs">Last opened {new Date(r.lastOpened).toLocaleString()}</Text>
                              </div>
                              <Button size="compact-xs" variant="light" onClick={(e) => { e.stopPropagation(); openRecent(r.path) }}>Open</Button>
                            </Group>
                          </Card>
                        ))}
                      </Stack>
                    </ScrollArea>
                  )}
                </Stack>
              </Card>

              <Card withBorder shadow="sm" padding="md" radius="md" style={{ background: '#232323', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 200px)' }}>
                <Group justify="space-between" align="center">
                  <Title order={4} c="#eee">What's new</Title>
                  {whatsNewLoading ? <Badge color="blue" variant="light">Loading</Badge> : null}
                </Group>
                <Divider my={2} />
                {whatsNewLoading ? (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Loader size="sm" />
                  </div>
                ) : whatsNewHtml ? (
                  <ScrollArea offsetScrollbars style={{ flex: 1 }}>
                    <div style={{ color: '#ddd' }} dangerouslySetInnerHTML={{ __html: whatsNewHtml }} />
                  </ScrollArea>
                ) : (
                  <div style={{ flex: 1 }}>
                    <Text c="#888" size="sm" mt="xs">Add WHATSNEW.md to the repository root (or public/) to show release notes here.</Text>
                  </div>
                )}
              </Card>
            </Group>
          </>
        ) : (
          <>
            <Group justify="space-between" mb="sm">
              <div>
                <Title order={2} c="#fff">Welcome to HiFide</Title>
                <Text c="#aaa" size="sm">The agentic-first IDE. Open a folder to get started.</Text>
              </div>
            </Group>

            <Card withBorder shadow="sm" padding="md" radius="md" style={{ background: '#232323' }}>
              <Stack gap="sm">
                <Title order={4} c="#eee">Quick setup: API keys</Title>
                <Divider my={2} />
                <ApiKeysForm
                  apiKeys={apiKeys}
                  onChange={setApiKeys}
                  providerValid={providerValid}
                  showValidation={true}
                  compact={true}
                />
                <Button
                  fullWidth
                  size="md"
                  variant="filled"
                  loading={saving || validating}
                  onClick={saveAndValidate}
                  style={{ marginTop: 8 }}
                >
                  Save & Validate Keys
                </Button>
              </Stack>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}

