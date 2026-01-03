import { Project, SourceFile } from 'ts-morph';
import { VectorService } from './VectorService.js';
import { discoverWorkspaceFiles } from '../../utils/fileDiscovery.js';
import { Service } from '../base/Service.js';
import path from 'node:path';
import crypto from 'node:crypto';

interface IndexerState {
    indexedFiles: Record<string, string>; // path -> hash
}

export class CodeIndexerService extends Service<IndexerState> {
    private project: Project;

    constructor(private vectorService: VectorService) {
        super({
            indexedFiles: {}
        }, 'code_indexer');
        this.project = new Project({
            useInMemoryFileSystem: true
        });
    }

    protected onStateChange(): void {
        this.persistState();
    }

    async indexWorkspace(workspaceRoot: string) {
        const files = await discoverWorkspaceFiles({
            cwd: workspaceRoot,
            includeGlobs: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
            absolute: true
        });

        const batchSize = 10;
        for (let i = 0; i < files.length; i += batchSize) {
            const batch = files.slice(i, i + batchSize);
            await Promise.all(batch.map(file => this.indexFile(workspaceRoot, file)));
        }
    }

    async indexFile(workspaceRoot: string, filePath: string) {
        try {
            const content = await import('node:fs/promises').then(fs => fs.readFile(filePath, 'utf-8'));
            const hash = crypto.createHash('md5').update(content).digest('hex');
            
            const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
            
            if (this.state.indexedFiles[relPath] === hash) {
                return; // Already indexed and unchanged
            }

            const sourceFile = this.project.createSourceFile(filePath, content, { overwrite: true });
            const chunks = this.chunkSourceFile(sourceFile, relPath);
            
            if (chunks.length > 0) {
                await this.vectorService.upsertItems(chunks.map(c => ({
                    id: `code:${relPath}:${c.symbolName}:${c.startLine}`,
                    text: c.text,
                    type: 'code',
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

            // Cleanup memory
            this.project.removeSourceFile(sourceFile);
        } catch (error) {
            console.error(`[CodeIndexerService] Failed to index file ${filePath}:`, error);
        }
    }

    private chunkSourceFile(sourceFile: SourceFile, relPath: string) {
        const chunks: Array<{
            text: string;
            symbolName: string;
            symbolType: string;
            startLine: number;
            endLine: number;
        }> = [];

        // 1. Module Level
        const fileText = sourceFile.getFullText();
        if (fileText.length < 1000) { // Only chunk whole file if it's small
             chunks.push({
                text: `Module: ${relPath}\n${fileText}`,
                symbolName: 'module',
                symbolType: 'module',
                startLine: 1,
                endLine: sourceFile.getEndLineNumber()
            });
        }

        // 2. Classes
        sourceFile.getClasses().forEach(cls => {
            const className = cls.getName() || 'anonymous';
            const jsDoc = this.getJsDoc(cls);
            
            // Class Header
            chunks.push({
                text: `Class: ${className}. ${jsDoc}\nFile: ${relPath}`,
                symbolName: className,
                symbolType: 'class',
                startLine: cls.getStartLineNumber(),
                endLine: cls.getEndLineNumber()
            });

            // Methods
            cls.getMethods().forEach(method => {
                const methodName = method.getName();
                const mJsDoc = this.getJsDoc(method);
                chunks.push({
                    text: `Method: ${className}.${methodName}. ${mJsDoc}\nBody:\n${method.getText()}\nFile: ${relPath}`,
                    symbolName: `${className}.${methodName}`,
                    symbolType: 'method',
                    startLine: method.getStartLineNumber(),
                    endLine: method.getEndLineNumber()
                });
            });

            // Properties (grouped)
            const props = cls.getProperties().filter(p => this.getJsDoc(p).length > 0);
            if (props.length > 0) {
                chunks.push({
                    text: `Properties of Class ${className}:\n${props.map(p => `- ${p.getName()}: ${this.getJsDoc(p)}`).join('\n')}\nFile: ${relPath}`,
                    symbolName: `${className}.properties`,
                    symbolType: 'properties',
                    startLine: props[0].getStartLineNumber(),
                    endLine: props[props.length - 1].getEndLineNumber()
                });
            }
        });

        // 3. Standalone Functions
        sourceFile.getFunctions().forEach(fn => {
            const fnName = fn.getName() || 'anonymous';
            const jsDoc = this.getJsDoc(fn);
            chunks.push({
                text: `Function: ${fnName}. ${jsDoc}\nBody:\n${fn.getText()}\nFile: ${relPath}`,
                symbolName: fnName,
                symbolType: 'function',
                startLine: fn.getStartLineNumber(),
                endLine: fn.getEndLineNumber()
            });
        });

        // 4. Interfaces and Types
        sourceFile.getInterfaces().forEach(iface => {
            const name = iface.getName();
            chunks.push({
                text: `Interface: ${name}. ${this.getJsDoc(iface)}\nDefinition:\n${iface.getText()}\nFile: ${relPath}`,
                symbolName: name,
                symbolType: 'interface',
                startLine: iface.getStartLineNumber(),
                endLine: iface.getEndLineNumber()
            });
        });

        sourceFile.getTypeAliases().forEach(type => {
            const name = type.getName();
            chunks.push({
                text: `Type: ${name}. ${this.getJsDoc(type)}\nDefinition:\n${type.getText()}\nFile: ${relPath}`,
                symbolName: name,
                symbolType: 'type',
                startLine: type.getStartLineNumber(),
                endLine: type.getEndLineNumber()
            });
        });

        return chunks;
    }

    private getJsDoc(node: any): string {
        try {
            if (typeof node.getJsDocs === 'function') {
                return node.getJsDocs().map((d: any) => d.getDescription()).join('\n');
            }
        } catch {}
        return '';
    }
}
