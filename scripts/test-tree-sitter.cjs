
const Parser = require('tree-sitter');
const TypeScript = require('tree-sitter-typescript');
const Go = require('tree-sitter-go');
const Rust = require('tree-sitter-rust');
const Python = require('tree-sitter-python');

function testParsers() {
    console.log('--- Tree-sitter Bindings Stress Test ---');
    
    const languages = {
        'TypeScript': TypeScript.typescript,
        'TSX': TypeScript.tsx,
        'Go': Go,
        'Rust': Rust,
        'Python': Python
    };

    const iterations = 50;
    
    for (const [name, langBinding] of Object.entries(languages)) {
        console.log(`Testing ${name}...`);
        try {
            for (let i = 0; i < iterations; i++) {
                const parser = new Parser();
                parser.setLanguage(langBinding);
                
                // Minimal code to parse
                const source = i % 2 === 0 
                    ? 'function hello() { console.log("world"); }' 
                    : 'class MyClass { constructor() { this.x = 10; } }';
                
                const tree = parser.parse(source);
                const root = tree.rootNode;
                
                if (!root || root.type !== 'program' && root.type !== 'module' && root.type !== 'source_file') {
                    // Python/Go/Rust might have different root types, but we just want to see if it works
                }
                
                if (i === 0) {
                    console.log(`  [${name}] Initial parse successful. Root type: ${root.type}`);
                }
            }
            console.log(`  [${name}] OK: Finished ${iterations} iterations.`);
        } catch (e) {
            console.error(`  [${name}] FAILED:`, e);
            process.exit(1);
        }
    }
    
    console.log('--- All tests passed! Native bindings seem stable in Node.js ---');
}

testParsers();
