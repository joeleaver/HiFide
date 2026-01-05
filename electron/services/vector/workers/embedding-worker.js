import { parentPort } from 'worker_threads';
import path from 'node:path';
import os from 'node:os';

// CRITICAL: Set environment variable BEFORE importing @xenova/transformers
// This prevents it from trying to load onnxruntime-node (which has ABI incompatibility with Electron)
// and forces it to use the WASM backend (onnxruntime-web) instead.
process.env.TRANSFORMERS_BACKEND = 'onnxruntime-web';

let transformersModule = null;
let embeddingPipeline = null;
let currentModel = null;

async function getTransformers() {
    if (!transformersModule) {
        // Dynamic import AFTER setting env var
        transformersModule = await import('@xenova/transformers');

        // Configuration for Electron/Node.js worker context
        transformersModule.env.useBrowserCache = false;
        transformersModule.env.allowLocalModels = true;
        // CRITICAL: Allow downloading models from Hugging Face
        transformersModule.env.allowRemoteModels = true;

        // Set explicit cache directory to avoid permission issues
        const cacheDir = path.join(os.homedir(), '.cache', 'hifide', 'transformers');
        transformersModule.env.cacheDir = cacheDir;

        console.log('[embedding-worker] Transformers.js configured:', {
            backend: process.env.TRANSFORMERS_BACKEND,
            cacheDir,
            allowRemoteModels: transformersModule.env.allowRemoteModels,
        });
    }
    return transformersModule;
}

async function getPipeline(modelId) {
    if (embeddingPipeline && currentModel === modelId) {
        return embeddingPipeline;
    }

    // Clear old pipeline if it exists
    embeddingPipeline = null;

    const { pipeline } = await getTransformers();
    embeddingPipeline = await pipeline('feature-extraction', modelId);
    currentModel = modelId;
    return embeddingPipeline;
}

if (parentPort) {
  parentPort.on('message', async (message) => {
    const { type, payload, id } = message;

    try {
        if (type === 'embed') {
            const { text, modelId } = payload;
            const pipe = await getPipeline(modelId);
            const output = await pipe(text, { pooling: 'mean', normalize: true });
            
            parentPort.postMessage({
                id,
                type: 'success',
                payload: Array.from(output.data)
            });
        } else if (type === 'ping') {
            parentPort.postMessage({ id, type: 'pong' });
        }
    } catch (error) {
        // Ensure error message is always a string for proper serialization
        const errorMessage = error?.message || String(error) || 'Unknown embedding error';
        console.error('[embedding-worker] Error:', errorMessage);
        parentPort.postMessage({
            id,
            type: 'error',
            payload: errorMessage
        });
    }
  });
}
