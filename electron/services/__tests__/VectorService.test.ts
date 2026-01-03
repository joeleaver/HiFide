import { jest } from '@jest/globals';
import { VectorService } from '../vector/VectorService.js';
import * as lancedb from '@lancedb/lancedb';
import OpenAI from 'openai';

jest.mock('@lancedb/lancedb');
jest.mock('openai');
jest.mock('../index.js', () => ({
    getSettingsService: jest.fn().mockReturnValue({
        getApiKeys: jest.fn().mockReturnValue({ openai: 'test-key' })
    })
}));

describe('VectorService', () => {
    let vectorService: VectorService;
    let mockDb: any;
    let mockTable: any;

    beforeEach(() => {
        mockTable = {
            add: jest.fn().mockResolvedValue(undefined),
            vectorSearch: jest.fn().mockReturnValue({
                limit: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                toArray: jest.fn().mockResolvedValue([])
            }),
            openTable: jest.fn()
        };
        mockDb = {
            tableNames: jest.fn().mockResolvedValue([]),
            createTable: jest.fn().mockResolvedValue(mockTable),
            openTable: jest.fn().mockResolvedValue(mockTable)
        };
        (lancedb.connect as jest.Mock).mockResolvedValue(mockDb);
        
        vectorService = new VectorService();
    });

    it('should initialize correctly', async () => {
        await vectorService.init('/tmp/test');
        expect(lancedb.connect).toHaveBeenCalled();
    });

    it('should search correctly', async () => {
        await vectorService.init('/tmp/test');
        
        // Mock embeddings
        (vectorService as any).openai = {
            embeddings: {
                create: jest.fn().mockResolvedValue({
                    data: [{ embedding: [0.1, 0.2] }]
                })
            }
        };

        mockTable.vectorSearch.mockReturnValue({
            limit: jest.fn().mockReturnThis(),
            toArray: jest.fn().mockResolvedValue([
                { id: '1', _distance: 0.1, text: 'match', type: 'code', metadata: '{}' }
            ])
        });

        const results = await vectorService.search('test query');
        expect(results).toHaveLength(1);
        expect(results[0].text).toBe('match');
    });
});
