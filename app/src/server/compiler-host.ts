import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {prepareGeneration} from './compiler-generation.js';
import {type Config,safePath} from './config.js';
import {type Store,hash} from './db.js';
import {projectGrant,projectTaskGrant} from './dsh/project-workspace.js';
import {maintenance} from './runtime-status.js';

export function sameCompilerRoot(authorized:string,configured:string) {
 if(!path.isAbsolute(authorized)||!path.isAbsolute(configured))return false;
 const normalize=(p:string)=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
 return normalize(authorized)===normalize(configured)&&normalize(fs.realpathSync(authorized))===normalize(fs.realpathSync(configured));
}

export function compilerArguments(operation:string,root:string,output:string) {
 const compiler=path.join(root,'Tools/RRPG.ConfigCompiler/src/RRPG.ConfigCompiler/RRPG.ConfigCompiler.csproj');
 const tests=path.join(root,'Tools/RRPG.ConfigCompiler/tests/RRPG.ConfigCompiler.Tests/RRPG.ConfigCompiler.Tests.csproj');
 if(['build-test','initialworld-generate'].includes(operation))return [['build',compiler,'-c','Release','--no-restore'],['test',tests,'-c','Release','--no-restore','--logger','trx;LogFileName=compiler.trx','--results-directory',output]];
 throw Error('未知受控操作；不接受任意命令或参数');
}
// Explicit operator capability. Fixed argv is NOT an OS sandbox. No shell or model-supplied command.
export async function runCompilerHost(store:Store,cfg:Config,actor:string,taskId:string,operation:string,key:string) {
 if(actor!=='developer'||maintenance(cfg))throw Error('仅主开发可在非维护状态调用受控编译');
 const config=JSON.parse(fs.readFileSync(path.join(cfg.runtime,'dsh-config.json'),'utf8'));
 const grant=projectGrant(config.projectWorkspace,cfg.project),task=store.get('tasks',taskId);
 if(!task||!projectTaskGrant(task,store.all('tasks'),grant)||['completed','cancelled'].includes(task.status))throw Error('任务未获工程授权');
 const permission=config.compilerHost;
 if(permission?.enabled!==true||!permission.taskIds?.includes(taskId)||!permission.authorization||!sameCompilerRoot(permission.root,cfg.project))throw Error('该任务尚未获固定Compiler宿主操作授权；未执行');
 if(!path.isAbsolute(permission.dotnet)||!fs.existsSync(permission.dotnet))throw Error('维护配置的dotnet不可用');
 const id='compiler-host:'+hash({taskId,key}),previous=store.get('settings',id);
 if(previous){if(previous.operation!==operation)throw Error('请求标识已用于其他操作');return previous;}
 if(store.all('settings').some(r=>r.id.startsWith('compiler-host:')&&['running','unknown'].includes(r.status)))throw Error('已有宿主操作未结束或结果未知，不重放');
 if(store.all('executions').some(j=>['preparing','dispatching','running','verifying','cancelling','unknown'].includes(j.status)))throw Error('存在活动或未知执行，未并行写入');
 const output=safePath(cfg.runtime,path.join(cfg.runtime,'compiler-host',hash({taskId,key})));
 const commands=compilerArguments(operation,cfg.project,output);
 for(const args of commands)safePath(cfg.project,args[1]);
 const lock=path.join(cfg.runtime,'unity-project.lock.json');
 fs.writeFileSync(lock,JSON.stringify({executionId:id,pid:process.pid}),{flag:'wx'});
 fs.mkdirSync(output,{recursive:true});
 const record:any={id,taskId,operation,status:'running',startedAt:new Date().toISOString(),output,steps:[]};
 const persist=()=>{store.put('settings',record);store.event('compiler_host.updated',record);};persist();
 let uncertain=false;
 try {
  const generation=operation==='initialworld-generate'?prepareGeneration(cfg.project,output):undefined;
  if(generation)commands.push(...generation.commands);
  for(const [index,args]of commands.entries()){
   const log=path.join(output,`step-${index}.log`),stream=fs.createWriteStream(log,{flags:'wx'});
   const step:any={args,log,startedAt:new Date().toISOString()};record.steps.push(step);persist();
   await new Promise<void>((resolve,reject)=>{
    const child=spawn(permission.dotnet,args,{cwd:cfg.project,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    step.pid=child.pid;persist();let tail='';
    const capture=(data:Buffer)=>{stream.write(data);tail=(tail+data.toString()).slice(-6000);};child.stdout.on('data',capture);child.stderr.on('data',capture);
    const timer=setTimeout(()=>{uncertain=true;step.error='超过五分钟，保留进程与工程锁待核对，未盲重跑';persist();reject(Error(step.error));},300000);
    child.once('error',error=>{clearTimeout(timer);stream.end();reject(error);});
    child.once('close',code=>{clearTimeout(timer);stream.end(()=>{step.exitCode=code;step.tail=tail;step.finishedAt=new Date().toISOString();persist();code===0?resolve():reject(Error(`Compiler步骤${index+1}退出码${code}；${tail}`));});});
   });
  }
  if(generation)record.artifacts=generation.publish();
  record.status='completed';
 }catch(error){record.status=uncertain?'unknown':'failed';record.error=String(error);}
 finally {record.finishedAt=new Date().toISOString();persist();if(!uncertain&&JSON.parse(fs.readFileSync(lock,'utf8')).executionId===id)fs.unlinkSync(lock);}
 return record;
}
