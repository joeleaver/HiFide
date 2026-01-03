import { jest } from '@jest/globals';
import searchWorkspaceTool from '../searchWorkspace.js';
import { grepTool } from '../../text/grep.js';
import { getVectorService } from '../../../services/index.js';

jest.mock('../../text/grep.js');
jest.mock('../../../services/index.js', () => ({
    getVectorService: jest.fn(),
    getSettingsService: jest.fn().mockReturnValue({
        getApiKeys: jest.fn().mockReturnValue({ openai: 'test-key' })
    })
}));

describe('workspaceSearch semantic', () => {
    let mockVectorService: any;

    beforeEach(() => {
        mockVectorService = {
            init: jest.fn().mockResolvedValue(undefined),
            search: jest.fn().mockResolvedValue([])
        };
        (getVectorService as jest.Mock).mockReturnValue(mockVectorService);
        (grepTool.run as jest.Mock).mockResolvedValue({ ok: true, data: { matches: [] } });
    });

    it('should fall back to semantic search if grep finds nothing', async () => {
        mockVectorService.search.mockResolvedValue([
            {
                id: '1',
                score: 0.1,
                text: 'class SemanticMatch {}',
                type: 'code',
                metadata: { 
                    filePath: 'src/semantic.ts', 
                    startLine: 10,
                    symbolName: 'SemanticMatch',
                    symbolType: 'class'
                }
            }
        ]);

        const result = await searchWorkspaceTool.run({ query: 'semantic search' });

        expect(result.ok).toBe(true);
        expect(result.data.meta.mode).toBe('semantic');
        expect(result.data.results[0].path).toBe('src/semantic.ts');
        expect(result.data.results[0].lineNumber).toBe(10);
        expect(result.data.results[0].line).toContain('class SemanticMatch');
    });

    it('should filter matches by score', async () => {
        mockVectorService.search.mockResolvedValue([
            {
                id: '1',
                score: 0.9, // Above threshold
                text: 'bad match',
                type: 'code',
                metadata: { filePath: 'bad.ts' }
            }
        ]);

        const result = await searchWorkspaceTool.run({ query: 'semantic search' });

        expect(result.ok).toBe(true);
        // It should continue to path search since semantic search returned no results after filtering
        expect(result.data.meta.mode).not.toBe('semantic');
    });
});
