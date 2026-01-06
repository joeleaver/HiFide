import { parentPort } from 'worker_threads';
import path from 'node:path';
import os from 'node:os';

let transformersModule = null;
let embeddingPipeline = null;
let currentModel = null;
let pipelineInitPromise = null; // Lock to prevent concurrent initialization

async function getTransformers() {
    if (!transformersModule) {
        console.log('[embedding-worker] Loading transformers module on platform:', process.platform);

        // Dynamic import of @huggingface/transformers v3
        transformersModule = await import('@huggingface/transformers');

        // Set explicit cache directory to avoid permission issues
        const cacheDir = path.join(os.homedir(), '.cache', 'hifide', 'transformers');
        transformersModule.env.cacheDir = cacheDir;

        // Configuration for Electron/Node.js worker context
        transformersModule.env.useBrowserCache = false;
        transformersModule.env.allowLocalModels = true;
        // CRITICAL: Allow downloading models from Hugging Face
        transformersModule.env.allowRemoteModels = true;

        // Configure ONNX backend for WASM with single thread for worker_threads compatibility
        // v3 uses env.backends.onnx for configuration
        if (transformersModule.env.backends && transformersModule.env.backends.onnx) {
            transformersModule.env.backends.onnx.wasm = transformersModule.env.backends.onnx.wasm || {};
            transformersModule.env.backends.onnx.wasm.numThreads = 1;
        }

        console.log('[embedding-worker] Transformers.js v3 configured:', {
            platform: process.platform,
            cacheDir,
            allowRemoteModels: transformersModule.env.allowRemoteModels,
            backends: transformersModule.env.backends ? 'available' : 'not available',
        });
    }
    return transformersModule;
}

async function getPipeline(modelId) {
    // Validate modelId is a string
    if (typeof modelId !== 'string' || !modelId) {
        throw new Error(`Invalid modelId: expected string, got ${typeof modelId}: ${JSON.stringify(modelId)}`);
    }

    // If pipeline is already initialized for this model, return it
    if (embeddingPipeline && currentModel === modelId) {
        return embeddingPipeline;
    }

    // If initialization is already in progress, wait for it
    if (pipelineInitPromise && currentModel === modelId) {
        console.log('[embedding-worker] Waiting for pipeline initialization to complete...');
        await pipelineInitPromise;
        return embeddingPipeline;
    }

    console.log('[embedding-worker] Creating pipeline for model:', modelId);

    // Clear old pipeline if it exists
    embeddingPipeline = null;
    currentModel = modelId;

    // Create initialization promise to prevent concurrent downloads
    pipelineInitPromise = (async () => {
        const { pipeline } = await getTransformers();
        // Use CPU backend for Node.js/Electron worker compatibility
        // On Windows: dml (DirectML) or cpu are available
        // On Linux: cpu is the safe fallback
        // Configure options based on model
        const options = { device: 'cpu' };
        if (modelId.includes('nomic-embed-text')) {
            // nomic models need fp16 for compatibility with onnxruntime-node
            options.dtype = 'fp16';
        }
        if (modelId.includes('code-rank-embed-onnx')) {
            // This model has model.onnx at root, not in onnx/ subfolder
            // Tell transformers.js to look in root directory
            options.subfolder = '';
        }
        embeddingPipeline = await pipeline('feature-extraction', modelId, options);
        console.log('[embedding-worker] Pipeline created successfully for:', modelId);
    })();

    await pipelineInitPromise;
    pipelineInitPromise = null;
    return embeddingPipeline;
}

if (parentPort) {
  parentPort.on('message', async (message) => {
    const { type, payload, id } = message;

    try {
        if (type === 'embed') {
            const { text, modelId } = payload || {};

            // Validate inputs
            if (typeof text !== 'string') {
                throw new Error(`Invalid text: expected string, got ${typeof text}`);
            }
            if (typeof modelId !== 'string' || !modelId) {
                throw new Error(`Invalid modelId: expected non-empty string, got ${typeof modelId}: ${JSON.stringify(modelId)}`);
            }

            console.log('[embedding-worker] Embedding request:', {
                modelId,
                textLength: text.length,
                textPreview: text.substring(0, 50) + '...'
            });

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
        const errorStack = error?.stack || '';
        console.error('[embedding-worker] Error:', errorMessage);
        console.error('[embedding-worker] Stack:', errorStack);
        parentPort.postMessage({
            id,
            type: 'error',
            payload: errorMessage
        });
    }
  });
}
