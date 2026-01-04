import { Service } from '../base/Service.js';
import { IndexingEvent } from './types.js';

interface QueueItem extends IndexingEvent {
    priority: number; // 1 = high (user edit), 0 = low (initial scan)
}

interface QueueState {
    pendingCount: number;
    queue: QueueItem[]; // Exposed for debugging/UI
}

export class IndexingQueue extends Service<QueueState> {
    
    constructor() {
        super({
            pendingCount: 0,
            queue: []
        }, 'indexing_queue');
    }

    protected onStateChange(_updates: Partial<QueueState>, _prevState: QueueState): void {
        // Persist if needed
    }

    public push(events: IndexingEvent[], priority = 0) {
        let currentQueue = [...this.state.queue];

        for (const event of events) {
            const existingIndex = currentQueue.findIndex(item => item.path === event.path);
            
            if (existingIndex !== -1) {
                // Deduplicate: Update existing item
                // If it was 'add' and now 'change', keep 'add'? 
                // Actually, if it's 'unlink', it overrides everything.
                // If it's 'change' and existing is 'add', keep 'add' (implies scan + edit).
                
                const existing = currentQueue[existingIndex];
                
                if (event.type === 'unlink') {
                     currentQueue[existingIndex] = { ...event, priority: Math.max(existing.priority, priority) };
                } else if (existing.type === 'add') {
                     // Keep as add, but update timestamp/priority
                     currentQueue[existingIndex] = { ...existing, timestamp: event.timestamp, priority: Math.max(existing.priority, priority) };
                } else {
                     // Update to new event
                     currentQueue[existingIndex] = { ...event, priority: Math.max(existing.priority, priority) };
                }
            } else {
                currentQueue.push({ ...event, priority });
            }
        }

        // Sort by priority (desc) then timestamp (asc - FIFO for same priority)
        currentQueue.sort((a, b) => {
            if (b.priority !== a.priority) return b.priority - a.priority;
            return a.timestamp - b.timestamp;
        });

        this.setState({
            queue: currentQueue,
            pendingCount: currentQueue.length
        });
    }

    public pop(count = 1): QueueItem[] {
        if (this.state.queue.length === 0) return [];

        const currentQueue = [...this.state.queue];
        const items = currentQueue.splice(0, count);

        this.setState({
            queue: currentQueue,
            pendingCount: currentQueue.length
        });

        return items;
    }

    public peek(): QueueItem | undefined {
        return this.state.queue[0];
    }
    
    public clear() {
        this.setState({ queue: [], pendingCount: 0 });
    }

    public getQueueLength(): number {
        return this.state.queue.length;
    }
}
