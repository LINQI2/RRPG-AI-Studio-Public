import {test,expect} from 'vitest';
import {compilerArguments,sameCompilerRoot} from '../src/server/compiler-host.js';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {prepareGeneration,initialWorldOutputs} from '../src/server/compiler-generation.js';
test('same authorized root accepts Windows separators without accepting another directory',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'compiler-root-'));
 expect(sameCompilerRoot(root,root)).toBe(true);
 if(process.platform==='win32')expect(sameCompilerRoot(root.replaceAll('\\','/'),root.toUpperCase())).toBe(true);
 expect(sameCompilerRoot(root,path.dirname(root))).toBe(false);
 expect(sameCompilerRoot('.',root)).toBe(false);
});
test('generation publishes only its domain, preserves existing workbook and rejects changed inputs',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'compiler-scope-')),output=fs.mkdtempSync(path.join(os.tmpdir(),'compiler-evidence-'));
 fs.mkdirSync(path.join(root,'Development/Config'),{recursive:true});fs.mkdirSync(path.join(root,'Development/SourceAssets'),{recursive:true});
 fs.writeFileSync(path.join(root,'Development/Config/RRPG_InitialWorld.xlsx'),'existing');
 const g=prepareGeneration(root,output);expect(g.commands.some(c=>c.includes('initialworld-seed'))).toBe(false);
 for(const name of [...initialWorldOutputs,'Other.json'])fs.writeFileSync(path.join(output,'staging/Development/Generated/StaticConfig',name),'{}');
 expect(g.publish()).toHaveLength(3);expect(fs.existsSync(path.join(root,'Development/Generated/StaticConfig/Other.json'))).toBe(false);
 expect(fs.readFileSync(path.join(root,'Development/Config/RRPG_InitialWorld.xlsx'),'utf8')).toBe('existing');
 const next=prepareGeneration(root,fs.mkdtempSync(path.join(os.tmpdir(),'compiler-evidence-')));fs.writeFileSync(path.join(root,'Development/Config/RRPG_InitialWorld.xlsx'),'human change');
 expect(()=>next.publish()).toThrow(/变化/);
});
test('compiler host permits only fixed argv without shell commands or arbitrary operations',()=>{
 const args=compilerArguments('build-test','D:/authorized','D:/evidence');
 expect(args).toHaveLength(2);expect(args[0][0]).toBe('build');expect(args[1][0]).toBe('test');
 expect(args.every(a=>a.includes('--no-restore'))).toBe(true);
 expect(args[1]).toContain('trx;LogFileName=compiler.trx');
 expect(()=>compilerArguments('powershell','D:/authorized','D:/evidence')).toThrow();
 expect(()=>compilerArguments('initialworld-seed','D:/authorized','D:/evidence')).toThrow();
 expect(compilerArguments('initialworld-generate','D:/authorized','D:/evidence')[0][0]).toBe('build');
});
