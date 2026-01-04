import { parentPort } from 'worker_threads';
import { pipeline } from '@xenova/transformers';

let embeddingPipeline = null;
let currentModel = null;

async function getPipeline(modelId) {
    if (embeddingPipeline && currentModel === modelId) {
        return embeddingPipeline;
    }
    
    // Clear old pipeline if it exists
    embeddingPipeline = null;
    
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
