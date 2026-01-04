
import { parentPort } from 'node:worker_threads';
import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import Go from 'tree-sitter-go';
import Rust from 'tree-sitter-rust';
import Python from 'tree-sitter-python';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const parsers = {};

function initParsers() {
    const languages = {
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
            // Silently fail in worker
        }
    }
}

function chunkTree(tree, relPath) {
    const chunks = [];

    const walk = (node) => {
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

async function processFile(filePath, workspaceRoot) {
    const content = await fs.readFile(filePath, 'utf-8');
    const hash = crypto.createHash('md5').update(content).digest('hex');
    const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
    const ext = path.extname(filePath);

    const parser = parsers[ext];
    let chunks = [];

    if (parser) {
        try {
            const tree = parser.parse(content);
            chunks = chunkTree(tree, relPath);
        } catch (e) {
            // Fallback to basic if parse fails
        }
    } 
    
    if (chunks.length === 0) {
        chunks.push({
            text: `File: ${relPath}\nContent:\n${content}`,
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
}

initParsers();

if (parentPort) {
    parentPort.on('message', async (message) => {
        const action = message.action || message.type;
        if (action === 'process_file' || action === 'index_file') {
            try {
                const result = await processFile(message.filePath || message.filePathOrId, message.workspaceRoot);
                parentPort.postMessage({ 
                    action: 'process-complete', 
                    taskId: message.taskId,
                    result
                });
            } catch (error) {
                parentPort.postMessage({ action: 'error', error: error.message, taskId: message.taskId });
            }
        }
    });
}
