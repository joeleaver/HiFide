/**
 * WebSocket RPC types
 */

export interface RpcConnection {
  sendNotification: (method: string, params: any) => void
}

