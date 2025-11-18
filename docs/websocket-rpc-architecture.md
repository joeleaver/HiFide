# WebSocket + JSON-RPC Architecture (Phase 0 RFC)

Status: Draft
Owner: Main process (Electron)
Scope (Phase 0): Transport, handshake, auth, minimal Terminal ping; no UI changes

## Goals
- Replace zubridge/IPC with a single WebSocket transport usable locally and remotely
- JSON-RPC 2.0 for request/response control plane; notifications for streaming
- Renderer fully owns UI state; backend owns domain state; clean multi-window support
- Cloud-ready via capability negotiation (local vs remote exec/provider planes)

## Transport
- Protocol: JSON-RPC 2.0 over WebSocket
- Library: vscode-jsonrpc + vscode-ws-jsonrpc (MessageConnection over WS frames);
  streaming via JSON-RPC notifications
- Local: ws://127.0.0.1:<ephemeralPort> with random token (loopback only)
- Remote (future): wss://<host>/ws with JWT
- Versioning: protocolVersion string exchanged in handshake; breaking changes bump version

## Authentication
- Local: 128-bit random token (hex) generated on boot; required via query `?token=` or `Authorization: Bearer <token>` (server accepts either)
- Cloud: JWT (issuer TBD). Token presented as Bearer or `?token=`. Server validates audience/workspace.

## Handshake
Client sends after WS open:
- Method: `handshake.init`
- Params:
  - protocolVersion: string (e.g., "0.1")
  - windowId: string
  - workspaceRoot?: string
  - capabilities?: { subscribe?: string[] }

Server replies:
- Result:
  - serverVersion: string
  - execPlane: 'local' | 'remote'
  - providerPlane: 'local' | 'cloud'
  - fsAuthority: 'local' | 'remote'
  - persistence: 'local' | 'cloud'
  - features: { terminal?: boolean; flow?: boolean; search?: boolean; kb?: boolean; providers?: boolean }

Keepalive/ping:
- Method: `handshake.ping` → Result: `{ pong: true }`

## Namespaces (Phase 0)
- handshake.*: ping/init
- terminal.* (Phase 1): create/attach/write/resize/dispose
- workspace.* (Phase 1+): open/getRoot/setRoot
- providers.* (later)

## Streaming
- Use JSON-RPC notifications: `{ jsonrpc:'2.0', method:'terminal.data', params:{ sessionId, data } }`
- Consumers subscribe per service (client side routes by `method` prefix)
- For large payloads (future), multiplexed binary frames or chunked base64 in params

## Multi-window
- Each BrowserWindow has its own WS connection identified by `windowId`
- Sessions/workspaces scoped to connection unless explicitly shared

## Security
- Bind local server to 127.0.0.1 only
- Random ephemeral token per boot; not persisted
- No external exposure in local mode without explicit opt-in

## Migration Plan (slices)
1) Terminal (this RFC enables ping; next adds terminal service)
2) Search
3) Flow execution
4) Providers (with cloud proxy path)
5) Settings

## Acceptance (Phase 0)
- Server boots and listens on loopback ephemeral port
- Preload exposes `{ url, token, windowId }` to renderer
- Renderer connects and `handshake.ping` returns `{ pong:true }`

## Notes
- Capability negotiation fields support two cloud paths:
  - Path A (Provider Proxy): execPlane=local, providerPlane=cloud
  - Path B (Remote Backend): execPlane=remote, providerPlane=cloud (or remote)
- FS/persistence authorities determine where indexing and session data live

