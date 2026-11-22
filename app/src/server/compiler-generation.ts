import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {safePath} from './config.js';
export const initialWorldOutputs=['InitialWorld.json','InitialPopulation.json','InitialBuilding.json'];
const digest=(file:string)=>fs.existsSync(file)?createHash('sha256').update(fs.readFileSync(file)).digest('hex'):null;
export function prepareGeneration(root:string,output:string){
 const staging=path.join(output,'staging'),inputs:Record<string,string|null>={},targets:Record<string,string|null>={};
 function copy(relative:string){
  const source=safePath(root,path.join(root,relative)),stat=fs.lstatSync(source);
  if(stat.isSymbolicLink())throw Error('生成输入含重解析路径');
  if(stat.isDirectory()){for(const name of fs.readdirSync(source))copy(path.join(relative,name));return;}
  const target=path.join(staging,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);inputs[relative]=digest(source);
 }
 for(const name of fs.readdirSync(path.join(root,'Development/Config')).filter(n=>n.endsWith('.xlsx')&&!n.startsWith('~$')))copy('Development/Config/'+name);
 copy('Development/SourceAssets');
 const workbook='Development/Config/RRPG_InitialWorld.xlsx';
 for(const relative of [workbook,...initialWorldOutputs.map(n=>'Development/Generated/StaticConfig/'+n)])targets[relative]=digest(safePath(root,path.join(root,relative)));
 fs.mkdirSync(path.join(staging,'Development/Generated/StaticConfig'),{recursive:true});
 const dll=path.join(root,'Tools/RRPG.ConfigCompiler/src/RRPG.ConfigCompiler/bin/Release/net10.0/rrpg-config.dll');safePath(root,dll);
 const commands=[...(targets[workbook]===null?[[dll,'initialworld-seed','--root',staging]]:[]),[dll,'build','--root',staging],[dll,'validate','--root',staging]];
 return {commands,publish(){
  for(const [relative,hash]of Object.entries({...inputs,...targets}))if(digest(safePath(root,path.join(root,relative)))!==hash)throw Error('生成期间输入或目标变化，未发布：'+relative);
  const publish=[...(targets[workbook]===null?[workbook]:[]),...initialWorldOutputs.map(n=>'Development/Generated/StaticConfig/'+n)];
  for(const relative of publish){const source=path.join(staging,relative);if(!fs.existsSync(source))throw Error('生成缺产物：'+relative);if(relative.endsWith('.json'))JSON.parse(fs.readFileSync(source,'utf8'));}
  // Keep every previous target before publishing only this domain, never unrelated mirrors.
  for(const relative of publish){const target=safePath(root,path.join(root,relative));if(fs.existsSync(target)){const backup=path.join(output,'before',relative);fs.mkdirSync(path.dirname(backup),{recursive:true});fs.copyFileSync(target,backup,fs.constants.COPYFILE_EXCL);}}
  const written=[];
  for(const relative of publish){const target=safePath(root,path.join(root,relative));fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(staging,relative),target);written.push({path:relative,sha256:digest(target)});fs.writeFileSync(path.join(output,'published.json'),JSON.stringify(written,null,2));}
  return written;
 }};
}
