export {};

/**
 * Preload API type definitions
 *
 * Only includes APIs that are actually exposed via electron/preload.ts
 *
 * Note: Almost all APIs have been migrated to WebSocket JSON-RPC.
 * The preload bridge now only exposes menu event handling for OS integration.
 *
 * Removed APIs (now via WebSocket RPC):
 * - window.workspace.* - Use workspace.* and settings.* RPC methods
 * - window.wsBackend - Read query params directly from location.search
 * - window.app.setView - Use view.set RPC method
 * - window.fs.* - Unused (removed for security)
 * - window.sessions.* - Use session.* RPC methods
 * - window.capabilities.* - Use provider.* RPC methods
 * - window.agent.* - Use session.* RPC methods
 * - window.tsRefactor* - Unused TypeScript refactoring APIs
 * - window.edits.* - Use edits.* RPC methods
 * - window.indexing.* - Use indexing.* RPC methods
 * - window.flowProfiles.* - Use flow.* RPC methods
 * - window.ratelimits.* - Use provider.* RPC methods
 */
declare global {
  interface Window {
    // Menu event handling (only remaining preload API)
    menu?: {
      popup: (args: { menu: string; x: number; y: number }) => Promise<any>;
      on: (name: string, listener: (payload?: any) => void) => () => void;
      off: (name: string, listener: (payload?: any) => void) => void;
    };
  }
}







