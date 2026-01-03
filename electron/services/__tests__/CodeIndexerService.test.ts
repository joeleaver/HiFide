import { jest } from '@jest/globals';
import { CodeIndexerService } from '../vector/CodeIndexerService.js';
import { VectorService } from '../vector/VectorService.js';
import { Project } from 'ts-morph';
import path from 'node:path';

describe('CodeIndexerService', () => {
    let codeIndexerService: CodeIndexerService;
    let mockVectorService: jest.Mocked<VectorService>;

    beforeEach(() => {
        mockVectorService = {
            upsertItems: jest.fn().mockResolvedValue(undefined)
        } as any;
        codeIndexerService = new CodeIndexerService(mockVectorService as any);
    });

    it('should chunk a simple source file correctly', async () => {
        const filePath = '/test/file.ts';
        const content = `
            /**
             * Test class
             */
            export class TestClass {
                /**
                 * Test method
                 */
                testMethod(param: string): number {
                    return 1;
                }
            }

            /**
             * Test function
             */
            export function testFunction() {
                console.log("hello");
            }
        `;

        const project = new Project({ useInMemoryFileSystem: true });
        const sourceFile = project.createSourceFile(filePath, content);
        
        const chunks = (codeIndexerService as any).chunkSourceFile(sourceFile, 'file.ts');

        expect(chunks).toContainEqual(expect.objectContaining({
            symbolName: 'TestClass',
            symbolType: 'class'
        }));
        expect(chunks).toContainEqual(expect.objectContaining({
            symbolName: 'TestClass.testMethod',
            symbolType: 'method'
        }));
        expect(chunks).toContainEqual(expect.objectContaining({
            symbolName: 'testFunction',
            symbolType: 'function'
        }));

        const methodChunk = chunks.find(c => c.symbolName === 'TestClass.testMethod');
        expect(methodChunk.text).toContain('Test method');
        expect(methodChunk.text).toContain('testMethod(param: string)');
        expect(methodChunk.text).toContain('return 1;');
    });

    it('should extract interfaces and types', () => {
        const content = `
            /**
             * Test interface
             */
            export interface TestInterface {
                prop: string;
            }

            /**
             * Test type
             */
            export type TestType = {
                a: number;
            };
        `;
        const project = new Project({ useInMemoryFileSystem: true });
        const sourceFile = project.createSourceFile('test.ts', content);
        
        const chunks = (codeIndexerService as any).chunkSourceFile(sourceFile, 'test.ts');

        expect(chunks).toContainEqual(expect.objectContaining({
            symbolName: 'TestInterface',
            symbolType: 'interface'
        }));
        expect(chunks).toContainEqual(expect.objectContaining({
            symbolName: 'TestType',
            symbolType: 'type'
        }));
    });

    it('should extract class properties with JSDoc', () => {
        const content = `
            export class PropertyClass {
                /**
                 * Prop A
                 */
                propA: string;

                /**
                 * Prop B
                 */
                propB: number;

                noJsDoc: boolean;
            }
        `;
        const project = new Project({ useInMemoryFileSystem: true });
        const sourceFile = project.createSourceFile('test.ts', content);
        
        const chunks = (codeIndexerService as any).chunkSourceFile(sourceFile, 'test.ts');

        const propsChunk = chunks.find(c => c.symbolName === 'PropertyClass.properties');
        expect(propsChunk).toBeDefined();
        expect(propsChunk.text).toContain('Prop A');
        expect(propsChunk.text).toContain('Prop B');
        expect(propsChunk.text).not.toContain('noJsDoc');
    });
});
