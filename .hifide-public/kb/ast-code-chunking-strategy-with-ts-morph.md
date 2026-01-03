---
id: 84f55e24-3eaa-43fb-8faa-e79c8574b63b
title: AST Code Chunking Strategy with ts-morph
tags: [ts-morph, ast, chunking, indexing]
files: []
createdAt: 2026-01-03T06:38:57.821Z
updatedAt: 2026-01-03T06:38:57.821Z
---

## Goal
Use `ts-morph` to extract logical chunks from TypeScript/JavaScript files for semantic indexing.

## Chunking Strategy

### 1. File Level
- Extract module-level comments and exports.
- **Chunk**: "Module: [fileName]. [Summary/JSDoc]"

### 2. Class Level
- **Class Header**: "Class: [ClassName]. [JSDoc]. Extends [BaseClass]. Implements [Interfaces]."
- **Methods**: Each method is a separate chunk.
  - **Chunk**: "Method: [ClassName].[MethodName]([Params]). [JSDoc]. Body: [MethodBody]"
- **Properties**: Group public properties into a single chunk if they have JSDoc.

### 3. Function Level
- **Standalone Functions**: Similar to methods.
  - **Chunk**: "Function: [FunctionName]([Params]). [JSDoc]. Body: [FunctionBody]"

### 4. Interface / Type Level
- **Interfaces/Types**: Extract name and properties.
  - **Chunk**: "Type/Interface: [Name]. [JSDoc]. Definition: [Definition]"

## Implementation with `ts-morph`
```typescript
import { Project, SyntaxKind } from 'ts-morph';

const project = new Project();
const sourceFile = project.addSourceFileAtPath(filePath);

// Extract classes
sourceFile.getClasses().forEach(cls => {
    const className = cls.getName();
    const jsDoc = cls.getJsDocs().map(d => d.getDescription()).join('
');
    // ... create chunk
    
    cls.getMethods().forEach(method => {
        const methodName = method.getName();
        const body = method.getBody()?.getText();
        // ... create chunk
    });
});
```

## Metadata to Store
- `filePath`
- `startLine`, `endLine`
- `symbolName`
- `symbolType` (class, method, etc.)
- `hash` (to detect changes)
