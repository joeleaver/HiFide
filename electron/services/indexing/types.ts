export interface IndexingEvent {
    type: 'add' | 'change' | 'unlink';
    path: string;
    timestamp: number;
}

export interface WatcherOptions {
    ignored?: string[];
    debounceMs?: number;
}
