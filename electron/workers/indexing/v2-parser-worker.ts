import { parentPort /* , workerData */ } from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import Go from 'tree-sitter-go';
import Rust from 'tree-sitter-rust';
import Python from 'tree-sitter-python';

// Map extensions to languages
const parsers: Record<string, Parser> = {};

function initParsers() {
    try {
        const languages: Record<string, any> = {
            '.ts': TypeScript.typescript,
            '.tsx': TypeScript.tsx,
            '.js': TypeScript.typescript,
            '.jsx': TypeScript.tsx,
            '.go': Go,
            '.rs': Rust,
            '.py': Python
        };

        for (const [ext, langBinding] of Object.entries(languages)) {
            try {
                const parser = new Parser();
                parser.setLanguage(langBinding);
                parsers[ext] = parser;
            } catch (e) {
                // console.error(`[ParserWorker] Failed to init parser for ${ext}`, e);
            }
        }
    } catch (e) {
        console.error('[ParserWorker] Failed to load tree-sitter', e);
    }
}

initParsers();

interface Chunk {
    text: string;
    symbolName: string;
    symbolType: string;
    startLine: number;
    endLine: number;
    id?: string;
    type?: string;
    filePath?: string;
    metadata?: string;
}

function chunkTree(tree: Parser.Tree, relPath: string, content: string): Chunk[] {
    const chunks: Chunk[] = [];
    const stack: Parser.SyntaxNode[] = [tree.rootNode];
    
    // Safety: limit chunks per file
    const MAX_CHUNKS = 500; 

    while (stack.length > 0 && chunks.length < MAX_CHUNKS) {
        const node = stack.pop();
        if (!node) continue;
        
        const type = node.type;
        const isFunction = ['function_declaration', 'method_declaration', 'function_definition', 'arrow_function'].includes(type);
        const isClass = ['class_declaration', 'struct_declaration', 'interface_declaration'].includes(type);

        if (isFunction || isClass) {
            const startLine = node.startPosition.row + 1;
            const endLine = node.endPosition.row + 1;
            /* const lineCount = */ endLine - startLine;

            // Skip tiny functions or huge ones? 
            // For now, keep them but maybe truncate the body in the future.
            
            const nameNode = node.childForFieldName('name');
            const name = nameNode ? nameNode.text : 'anonymous';
            
            // Extract text slice
            const nodeText = content.slice(node.startIndex, node.endIndex);
            
            // If nodeText is > 4KB, truncate it for embedding purposes?
            // The vector DB usually has a token limit (e.g. 8191 tokens). 4KB chars is ~1000 tokens. Safe.
            // But if it's 50KB, we should probably split it.
            // For V2, let's just cap the text length to 8KB (approx 2000 tokens) to be safe.
            
            const effectiveText = nodeText.length > 8192 
                ? nodeText.slice(0, 8192) + '\n... [truncated]' 
                : nodeText;

            chunks.push({
                text: `${type}: ${name}\nFile: ${relPath}\n${effectiveText}`,
                symbolName: name,
                symbolType: type,
                startLine,
                endLine
            });
        }

        // Don't recurse if we just chunked this node? 
        // No, we might want to find inner classes/functions. 
        // But if we chunked a function, do we want to chunk its inner functions separately?
        // Usually yes.
        for (let i = node.childCount - 1; i >= 0; i--) {
            const child = node.child(i);
            if(child) stack.push(child);
        }
    }
    return chunks;
}

async function processFile(filePath: string, workspaceRoot: string) {
    try {
        const stats = await fs.stat(filePath);
        
        // 1. Memory Safety: Skip large files immediately
        if (stats.size > 1024 * 1024) { // 1MB
            return { skipped: true, reason: 'size_limit' };
        }

        const content = await fs.readFile(filePath, 'utf-8');
        const hash = crypto.createHash('md5').update(content).digest('hex');
        const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
        
        const ext = path.extname(filePath);
        const parser = parsers[ext];

        let chunks: Chunk[] = [];

        if (parser) {
            try {
                const tree = parser.parse(content);
                chunks = chunkTree(tree, relPath, content);
            } catch (e) {
                // Fallback to text chunking
            }
        }

        if (chunks.length === 0) {
            // Text chunking (naive)
            // Just one chunk for now if small enough
            chunks.push({
                text: `File: ${relPath}\n${content}`,
                symbolName: path.basename(filePath),
                symbolType: 'file',
                startLine: 1,
                endLine: content.split('\n').length
            });
        }

        return {
            relPath,
            hash,
            chunks: chunks.map(c => ({
                ...c,
                id: `code:${relPath}:${c.symbolName}:${c.startLine}`,
                type: 'code',
                filePath: relPath,
                metadata: JSON.stringify({
                    filePath: relPath,
                    startLine: c.startLine,
                    endLine: c.endLine,
                    symbolName: c.symbolName,
                    symbolType: c.symbolType
                })
            }))
        };

    } catch (error) {
        return { error: String(error) };
    }
}

if (parentPort) {
    const port = parentPort;
    port.on('message', async (msg) => {
        if (msg.type === 'parse') {
            const result = await processFile(msg.filePath, msg.workspaceRoot);
            port.postMessage({ type: 'result', id: msg.id, result });
        }
    });
}
