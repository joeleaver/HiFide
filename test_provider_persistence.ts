
import { ProviderService } from './electron/services/ProviderService';
import { PersistenceManager } from './electron/services/base/PersistenceManager';
import mock from 'mock-require';

// Mock electron-store
const store: Record<string, any> = {};
class MockStore {
  constructor(options: any) {
    console.log('MockStore initialized', options);
  }
  get(key: string, def: any) {
    return store[key] !== undefined ? store[key] : def;
  }
  set(key: string, val: any) {
    console.log(`Store set: ${key} =`, JSON.stringify(val, null, 2));
    store[key] = val;
  }
  has(key: string) {
    return key in store;
  }
  delete(key: string) {
    delete store[key];
  }
  clear() {
    for (const k in store) delete store[k];
  }
  get store() {
    return store;
  }
}

mock('electron-store', MockStore);

// Mock getDefaultPricingConfig to return empty or minimal defaults
mock('./electron/data/defaultModelSettings.js', {
  getDefaultPricingConfig: () => ({
    openrouter: {},
    fireworks: {},
    openai: {},
    anthropic: {},
    gemini: {},
    xai: {}
  })
});

// Mock settings service
mock('./electron/services/index.js', {
  getSettingsService: () => ({
    getApiKeys: () => ({ openrouter: 'test-key' })
  })
});

// Mock fetch
(global as any).fetch = async () => ({
    ok: true,
    json: async () => ({ data: [] })
});

async function runTest() {
  console.log('--- STARTING RUN 1 ---');
  let service = new ProviderService();
  
  console.log('Initial OpenRouter allowed:', service.getOpenRouterAllowedModels());
  console.log('Initial OpenRouter models:', service.getModelsForProvider('openrouter'));

  console.log('Adding model "openrouter/google/gemini-2.0-flash-001"...');
  await service.addOpenRouterModel('openrouter/google/gemini-2.0-flash-001');

  console.log('Post-add OpenRouter allowed:', service.getOpenRouterAllowedModels());
  console.log('Post-add OpenRouter models:', service.getModelsForProvider('openrouter'));

  // Verify persistence
  console.log('Store state after run 1:', JSON.stringify(store, null, 2));

  // Simulate restart
  console.log('--- STARTING RUN 2 (Restart) ---');
  
  // Re-instantiate service. It should load from 'store'.
  service = new ProviderService();

  console.log('Run 2 OpenRouter allowed:', service.getOpenRouterAllowedModels());
  console.log('Run 2 OpenRouter models:', service.getModelsForProvider('openrouter'));

  if (service.getModelsForProvider('openrouter').length === 0) {
      console.error('FAIL: Models missing after restart');
  } else {
      console.log('SUCCESS: Models persisted');
  }
}

runTest().catch(console.error);
