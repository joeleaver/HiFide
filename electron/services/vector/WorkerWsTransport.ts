import { JSONRPCServer, JSONRPCClient, JSONRPCServerAndClient } from 'json-rpc-2.0';
import { WebSocket as WsWebSocket } from 'ws';
// import { createRequire } from 'node:module';

// const require = createRequire(import.meta.url);

/**
 * A JSON-RPC transport that uses a WebSocket connection.
 * Can be used in both Node.js (Worker Threads) and Browser (Renderer).
 */
export class WorkerWsTransport {
    private rpc: JSONRPCServerAndClient;
    private ws: WebSocket | any;

    constructor(private url: string, private token: string) {
        this.rpc = new JSONRPCServerAndClient(
            new JSONRPCServer(),
            new JSONRPCClient(async (request) => {
                await this.ensureConnected();
                this.ws.send(JSON.stringify(request));
            })
        );
    }

    private connectionPromise: Promise<void> | null = null;

    async ensureConnected(): Promise<void> {
        if (this.ws && (this.ws.readyState === 1 || this.ws.readyState === (typeof WebSocket !== 'undefined' ? WebSocket.OPEN : 1))) {
            return;
        }

        if (this.connectionPromise) return this.connectionPromise;

        this.connectionPromise = new Promise((resolve, reject) => {
            /* const protocol = */ this.url.startsWith('ws') ? [] : undefined;
            // Handle both 'ws' package and browser WebSocket
            const socket = new (typeof WebSocket !== 'undefined' ? (WebSocket as any) : WsWebSocket)(
                `${this.url}?token=${this.token}`
            );

            socket.onopen = () => {
                this.ws = socket;
                this.connectionPromise = null;
                resolve();
            };

            socket.onmessage = (event: any) => {
                const data = typeof event.data === 'string' ? event.data : event.data.toString();
                try {
                    const parsed = JSON.parse(data);
                    this.rpc.receiveAndSend(parsed).then((response: any) => {
                        if (response) {
                            socket.send(JSON.stringify(response));
                        }
                    });
                } catch (err) {
                    console.error('[WorkerWsTransport] RPC parse error:', err, data.slice(0, 100));
                }
            };

            socket.onerror = (err: any) => {
                this.connectionPromise = null;
                reject(err);
            };

            socket.onclose = () => {
                this.connectionPromise = null;
                this.ws = null;
            };
        });

        return this.connectionPromise;
    }

    get rpcClient(): JSONRPCServerAndClient {
        return this.rpc;
    }

    addMethod(method: string, handler: (params: any) => any) {
        this.rpc.addMethod(method, handler);
    }

    async request(method: string, params?: any): Promise<any> {
        await this.ensureConnected();
        return this.rpc.request(method, params);
    }

    notify(method: string, params?: any) {
        this.rpc.notify(method, params);
    }

    async close() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}
