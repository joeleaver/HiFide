import Parser from 'tree-sitter';
import { getVectorService } from '../index.js';
import { Service } from '../base/Service.js';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';

// Native languages
import TypeScript from 'tree-sitter-typescript';
import Go from 'tree-sitter-go';
import Rust from 'tree-sitter-rust';
import Python from 'tree-sitter-python';

interface IndexerState {
    indexedFiles: Record<string, string>; // path -> hash
}

export class CodeIndexerService extends Service<IndexerState> {
    private parsers: Record<string, any> = {};
    private initialized = false;

    constructor() {
        super({
            indexedFiles: {}
        }, 'code_indexer');
    }

    async init() {
        if (this.initialized) return;

        try {
            console.log('[CodeIndexerService] Initializing Native Tree-Sitter native bindings...');
            
            const languages: Record<string, any> = {
                '.ts': TypeScript.typescript,
                '.tsx': TypeScript.tsx,
                '.js': TypeScript.typescript, // Native tree-sitter-typescript handles JS as well
                '.jsx': TypeScript.tsx,
                '.go': Go,
                '.rs': Rust,
                '.py': Python
            };

            for (const [ext, langBinding] of Object.entries(languages)) {
                try {
                    const parser = new Parser();
                    parser.setLanguage(langBinding);
                    this.parsers[ext] = parser;
                } catch (e: any) {
                    console.warn(`[CodeIndexerService] Could not load native parser for ${ext}:`, e.message);
                }
            }

            this.initialized = true;
            console.log('[CodeIndexerService] Native Tree-Sitter initialized.');
        } catch (e) {
            console.error(`[CodeIndexerService] Failed to initialize native engine:`, e);
            throw e;
        }
    }

    protected onStateChange(): void {
        this.persistState();
    }

    async indexWorkspace(workspaceRoot: string, force = false) {
        if (!workspaceRoot) return;

        const vectorService = getVectorService();

        // Ensure engine and parsers are ready
        await this.init();

        if (force) {
            console.log('[CodeIndexerService] Forced re-index: clearing existing hashes...');
            this.setState({ indexedFiles: {} });
            await this.persistState();
            // Clear status for clean start
            vectorService.updateIndexingStatus('code', 0, 0);
            // Wait a moment for persistence to settle
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.log(`[CodeIndexerService] Starting discovery in: ${workspaceRoot} (force: ${force})`);
        const { discoverWorkspaceFiles } = await import('../../utils/fileDiscovery.js');
        const files = await discoverWorkspaceFiles({
            cwd: workspaceRoot,
            includeGlobs: [
                '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', 
                '**/*.go', '**/*.rs', '**/*.py', '**/*.java', 
                '**/*.cpp', '**/*.c', '**/*.h', 
                '**/*.json', '**/*.html', '**/*.md', '**/*.css',
                '**/*.yml', '**/*.yaml'
            ],
            absolute: true,
            respectGitignore: false // Temporary override to diagnose "3 files" issue
        });

        console.log(`[CodeIndexerService] Discovered ${files.length} files to index.`);
        
        vectorService.updateIndexingStatus('code', 0, files.length);

        const batchSize = 10;
        for (let i = 0; i < files.length; i += batchSize) {
            const batch = files.slice(i, i + batchSize);
            await Promise.all(batch.map((file: string) => this.indexFile(workspaceRoot, file, force)));
            
            const indexedCount = Math.min(i + batchSize, files.length);
            vectorService.updateIndexingStatus('code', indexedCount, files.length);
        }

        vectorService.updateIndexingStatus('code', files.length, files.length);
    }

    async indexFile(workspaceRoot: string, filePath: string, force = false) {
        const vectorService = getVectorService();
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const hash = crypto.createHash('md5').update(content).digest('hex');
            
            const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
            const ext = path.extname(filePath);

            if (!force && this.state.indexedFiles[relPath] === hash) {
                return;
            }

            const parser = this.parsers[ext];
            let chunks: Array<{
                text: string;
                symbolName: string;
                symbolType: string;
                startLine: number;
                endLine: number;
            }> = [];

            if (parser) {
                const tree = parser.parse(content);
                chunks = this.chunkTree(tree, relPath);
            } else {
                // Fallback for non-code files (JSON, MD, HTML, etc.)
                chunks.push({
                    text: `File: ${relPath}\nContent:\n${content}`,
                    symbolName: path.basename(filePath),
                    symbolType: 'file',
                    startLine: 1,
                    endLine: content.split('\n').length
                });
            }
            
            if (chunks.length > 0) {
                await vectorService.upsertItems(chunks.map(c => ({
                    id: `code:${relPath}:${c.symbolName}:${c.startLine}`,
                    text: c.text,
                    type: 'code',
                    filePath: relPath,
                    symbolName: c.symbolName,
                    symbolType: c.symbolType,
                    startLine: c.startLine,
                    endLine: c.endLine,
                    metadata: JSON.stringify({
                        filePath: relPath,
                        startLine: c.startLine,
                        endLine: c.endLine,
                        symbolName: c.symbolName,
                        symbolType: c.symbolType
                    })
                })));
            }

            this.setState({
                indexedFiles: {
                    ...this.state.indexedFiles,
                    [relPath]: hash
                }
            });
        } catch (error) {
            console.error(`[CodeIndexerService] Failed to index file ${filePath}:`, error);
        }
    }

    private chunkTree(tree: any, relPath: string) {
        const chunks: Array<{
            text: string;
            symbolName: string;
            symbolType: string;
            startLine: number;
            endLine: number;
        }> = [];

        const walk = (node: any) => {
            if (node.type === 'class_declaration' || node.type === 'struct_declaration' || node.type === 'interface_declaration') {
                const nameNode = node.childForFieldName('name');
                const name = nameNode ? nameNode.text : 'anonymous';
                chunks.push({
                    text: `${node.type.replace('_declaration', '')}: ${name}\nFile: ${relPath}\n${node.text}`,
                    symbolName: name,
                    symbolType: node.type.split('_')[0],
                    startLine: node.startPosition.row + 1,
                    endLine: node.endPosition.row + 1
                });
            } else if (node.type === 'function_declaration' || node.type === 'method_declaration' || node.type === 'function_definition') {
                const nameNode = node.childForFieldName('name');
                const name = nameNode ? nameNode.text : 'anonymous';
                chunks.push({
                    text: `${node.type.includes('method') ? 'Method' : 'Function'}: ${name}\nFile: ${relPath}\n${node.text}`,
                    symbolName: name,
                    symbolType: node.type.includes('method') ? 'method' : 'function',
                    startLine: node.startPosition.row + 1,
                    endLine: node.endPosition.row + 1
                });
            }

            for (let i = 0; i < node.childCount; i++) {
                walk(node.child(i));
            }
        };

        walk(tree.rootNode);
        return chunks;
    }
}