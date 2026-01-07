import { jest } from '@jest/globals';
import searchWorkspaceTool from '../searchWorkspace.js';
import { grepTool } from '../../text/grep.js';
import { getVectorService, getGlobalIndexingOrchestratorService, getWorkspaceService } from '../../../services/index.js';

jest.mock('../../text/grep.js');
jest.mock('../../../services/index.js', () => ({
    getVectorService: jest.fn(),
    getGlobalIndexingOrchestratorService: jest.fn(),
    getWorkspaceService: jest.fn(),
    getSettingsService: jest.fn().mockReturnValue({
        getApiKeys: jest.fn().mockReturnValue({ openai: 'test-key' })
    })
}));

describe('workspaceSearch semantic', () => {
    let mockVectorService: any;
    let mockOrchestratorService: any;

    beforeEach(() => {
        mockVectorService = {
            init: jest.fn().mockResolvedValue(undefined),
            search: jest.fn().mockResolvedValue([])
        };
        mockOrchestratorService = {
            getState: jest.fn().mockReturnValue({
                indexingEnabled: true,
                status: 'idle',
                code: { total: 100, indexed: 100 }
            })
        };
        (getVectorService as jest.Mock).mockReturnValue(mockVectorService);
        (getGlobalIndexingOrchestratorService as jest.Mock).mockReturnValue(mockOrchestratorService);
        (grepTool.run as jest.Mock).mockResolvedValue({ ok: true, data: { matches: [] } });
    });

    it('should include semantic results when score is above threshold', async () => {
        // VectorService returns fields at top level, not nested in metadata
        mockVectorService.search.mockResolvedValue([
            {
                id: '1',
                score: 0.85, // Above 0.4 threshold
                text: 'class SemanticMatch {}',
                type: 'code',
                filePath: 'src/semantic.ts',
                startLine: 10,
                symbolName: 'SemanticMatch',
                symbolType: 'class',
                metadata: {}
            }
        ]);

        const result = await searchWorkspaceTool.run({ query: 'semantic search' });

        expect(result.ok).toBe(true);
        // With unified search, mode reflects sources used - semantic should be included
        expect(result.data.meta.sources).toContain('semantic');
        expect(result.data.results[0].path).toBe('src/semantic.ts');
        expect(result.data.results[0].lineNumber).toBe(10);
        expect(result.data.results[0].line).toContain('class SemanticMatch');
    });

    it('should filter out semantic matches below score threshold', async () => {
        mockVectorService.search.mockResolvedValue([
            {
                id: '1',
                score: 0.3, // Below 0.4 threshold
                text: 'low score match',
                type: 'code',
                filePath: 'low.ts',
                startLine: 1,
                metadata: {}
            }
        ]);

        const result = await searchWorkspaceTool.run({ query: 'semantic search' });

        expect(result.ok).toBe(true);
        // Semantic results below threshold should be filtered out
        // So semantic should not be in sources (unless no results at all)
        if (result.data.meta.sources) {
            expect(result.data.meta.sources).not.toContain('semantic');
        }
    });
});
