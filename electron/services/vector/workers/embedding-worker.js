import { parentPort } from 'worker_threads';

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
        // Additional configuration for WASM backend in worker threads
        transformersModule.env.useBrowserCache = false;
        transformersModule.env.allowLocalModels = true;
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
        parentPort.postMessage({
            id,
            type: 'error',
            payload: error.message
        });
    }
  });
}
