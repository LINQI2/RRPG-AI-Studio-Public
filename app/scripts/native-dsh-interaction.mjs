// Configure one explicit official DSH Web Session, never a Studio runtime.
// No shell/file execution, credential copying, or automatic retry.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import process from 'node:process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const arg=(key)=>{const i=process.argv.indexOf(key);return i<0?undefined:process.argv[i+1];};
const readyFile=arg('--ready-file'),sessionId=arg('--session'),evidenceDir=arg('--evidence-dir');
const configure=process.argv.includes('--configure');
if(!readyFile||!sessionId||!evidenceDir)throw Error('需要 --ready-file、--session 和 --evidence-dir；默认只读，--configure 才发送一次配置。');
// Keep this initial implementation restricted to its explicit validation fixture.
const fixture=path.join(root,'reports','2026-10-30-native-bridge-review','web-live-20261031');
if(path.resolve(readyFile)!==path.join(fixture,'home','browser-ready.json'))throw Error('仅允许本轮原生客户端验证Host配置');
const output=path.resolve(evidenceDir);
if(output!==path.join(root,'reports','2026-10-30-native-bridge-review'))throw Error('证据目录超出本轮验证范围');
const ready=JSON.parse(fs.readFileSync(readyFile,'utf8'));
const authUrl=new URL(ready.authUrl);
if(authUrl.hostname!=='127.0.0.1'||authUrl.protocol!=='http:'||authUrl.origin!==ready.url)throw Error('只允许准确匹配的本机Host');
const auth=await fetch(authUrl,{redirect:'manual',signal:AbortSignal.timeout(5000)});
if(auth.status!==303)throw Error('官方Host认证失败');
const cookie=auth.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
if(!cookie)throw Error('官方Host未建立认证Cookie');
const journal=path.join(output,'INTERACTION_SETUP_EVIDENCE.json');
const records=fs.existsSync(journal)?JSON.parse(fs.readFileSync(journal,'utf8')):[];
const save=()=>fs.writeFileSync(journal,JSON.stringify(records,null,2));
async function rpc(method,args){
 const r=await fetch(ready.url+'/api/'+method,{method:'POST',headers:{cookie,origin:ready.url,'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'interaction-'+records.length,method,payload:{args}}),signal:AbortSignal.timeout(15000)});
 const b=await r.json();records.push({at:new Date().toISOString(),method,args,status:r.status,body:b});save();
 if(!b.result?.ok)throw Error(JSON.stringify(b));return b.result.value;
}
const list=await rpc('session/list',{_request:{}});
const session=list.items.find(x=>x.sessionId===sessionId);
if(!session||path.resolve(session.cwd)!==path.join(fixture,'workspace'))throw Error('会话或工程身份不匹配');
if(configure){
 if(session.running)throw Error('会话正在运行；不插队或重发');
 const rule=fs.readFileSync(path.join(root,'rules','native-bridge','interaction.md'),'utf8');
 const hash=createHash('sha256').update(rule).digest('hex');
 const requestId='native-interaction-'+hash.slice(0,20);
 if(records.some(x=>x.requestId===requestId))throw Error('该规则版本已尝试投递；先核对证据，不盲重发');
 const instruction=rule+'\n\n本次只进行协作方式设置及原生询问验收，不执行开发任务，不读取文件，不调用其他工具。请调用 ask_user_question，问题标题“协作方式”，说明这是当前验证会话的行为设置，不授予任何新权限。问题为“以后在已授权任务范围内，希望怎样推进？”；三个单选选项依次为“自主推进（推荐）”（普通技术问题自行处理，重大事项询问）、“新委派先确认”（新的工作包先确认，包内自主执行）、“暂停自动委派”（不发新指令，保留当前记录）。等待真实用户回答；不得代选、伪造回答或把未答当同意。答复后用简短中文确认选择及适用范围，然后结束本轮。';
 records.push({at:new Date().toISOString(),kind:'prompt-attempt',requestId,ruleHash:hash,sessionId});save();
 console.log(JSON.stringify(await rpc('session/prompt',{request:{sessionId,requestId,mode:'queue',clientTimeZone:'Asia/Shanghai',content:[{type:'text',text:instruction}]}})));
}else{
 const values=session.projections?.values;
 console.log(JSON.stringify({sessionId,running:session.running,seq:session.projections?.asOfSeq,userQuestions:values?.userQuestions,usage:values?.tokenUsage}));
 if(session.projections?.asOfSeq!==undefined){
 const page=await rpc('session/page',{request:{address:{kind:'session',sessionId},throughSeq:session.projections.asOfSeq,maxMessages:3}});
 console.log(JSON.stringify({recent:page.records.filter(r=>['assistant/message','turn/end'].includes(r.event?.type)).map(r=>({seq:r.event.seq,type:r.event.type,text:r.event.data?.message?.content?.filter(p=>p.type==='text').map(p=>p.text).join('\n'),reason:r.event.data?.reason}))}));
 }
}
