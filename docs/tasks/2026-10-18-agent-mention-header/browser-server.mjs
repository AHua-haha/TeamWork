import {parseMemberResponse} from '../../../backend/dist/src/member-response.js';
import {createServer} from 'node:http';
const workspaceId='stream-review', startedAt=Date.now();
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
const assistant=content=>({role:'assistant',content,api:'openai-responses',provider:'openai',model:'fixture',usage,stopReason:'stop',timestamp:startedAt});
const agents=Object.fromEntries(['a','b','c'].map(id=>[id,{records:[],chunks:[],clients:new Set(),status:'running',follows:0,serial:0,current:null}]));
const run=id=>({agentId:id,runId:`run-${id}`,status:agents[id].status,phase:agents[id].status==='running'?'model':'finished',step:1,startedAt,endedAt:agents[id].status==='running'?null:Date.now(),endPosition:agents[id].status==='running'?null:agents[id].records.length,activeMessageId:agents[id].current?.id??null,error:agents[id].status==='failed'?{code:'incomplete_response',message:'Output was truncated.'}:null});
const record=(id,messageId,message)=>({agentId:id,runId:`run-${id}`,position:agents[id].records.length+1,messageId,message,metadata:{}});
const groupClients=new Set(),changes=[];
const entries=['a','b','c'].map((id,i)=>({workspaceId,entryId:`entry-${id}`,position:i+1,revision:i+1,exchangeId:'exchange',time:startedAt,kind:'member',memberId:id,name:['Lead','Writer','Reviewer'][i],run:run(id),working:{after:0,through:null},finalRef:null,text:null}));
entries.forEach((entry,i)=>changes.push({cursor:i+1,entry:structuredClone(entry)}));
const members=entries.map((entry,i)=>({memberId:entry.memberId,workspaceId,revision:0,name:entry.name,role:entry.name,lead:i===0,responsibility:'Fixture run',harness:{designScope:{working:[],dependencies:[]},implementationScope:{paths:['src'],usePaths:[]},allowedCommands:[]},settings:{connectionId:'provider',modelId:'fixture',modelOptions:[],toolOptionIds:[],promptOptionIds:[],prompt:''},ready:true,issues:[],running:true}));
const write=(res,type,data)=>res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
const privateEvent=(id,type,data)=>({version:1,agentId:id,runId:`run-${id}`,type,...data});
const emit=(id,type,data)=>{for(const res of agents[id].clients)write(res,type,privateEvent(id,type,data));};
function chunk(id,input){
 const agent=agents[id];
 if(!agent.current)agent.current={id:`reply-${id}-${++agent.serial}`,message:assistant([])};
 const content=[];
 if(input.thinking)content.push({type:'thinking',thinking:input.thinking});
 if(input.text!==undefined)content.push({type:'text',text:input.text});
 for(const call of input.tools??[])content.push({type:'toolCall',...call});
 agent.current.message=assistant(content);
 if(!agent.chunks.length){const start={messageId:agent.current.id,sequence:0,event:{type:'start',partial:assistant([])}};agent.chunks.push(start);emit(id,'chunk',start);}
 const part={messageId:agent.current.id,sequence:agent.chunks.length,event:{type:input.tools?'toolcall_delta':'text_delta',contentIndex:Math.max(0,content.length-1),delta:input.text??'',partial:agent.current.message}};
 agent.chunks.push(part);emit(id,'chunk',part);
}
function commit(id){
 const agent=agents[id],current=agent.current;
 current.message.stopReason=current.message.content.some(b=>b.type==='toolCall')?'toolUse':'stop';
 const rec=record(id,current.id,current.message);agent.records.push(rec);emit(id,'message',{record:rec});
 for(const call of current.message.content.filter(b=>b.type==='toolCall')){const result=record(id,`result-${call.id}`,{role:'toolResult',toolCallId:call.id,toolName:call.name,content:[{type:'text',text:'Fixture result'}],isError:false,timestamp:Date.now()});agent.records.push(result);emit(id,'message',{record:result});}
 agent.chunks=[];agent.current=null;
}
function update(id,action){
 const agent=agents[id],entry=entries.find(e=>e.memberId===id);
 if(action==='publish'){
  agent.status='completed';const rec=agent.records.at(-1),indices=rec.message.content.flatMap((b,i)=>b.type==='text'&&b.text.trim()?[i]:[]);
  const response=parseMemberResponse(indices.map(i=>rec.message.content[i].text).join('\n'));
  entry.finalRef={agentId:id,runId:`run-${id}`,messageId:rec.messageId,position:rec.position,contentIndices:indices,bodyOffset:response.bodyOffset};entry.text=response.body;
 }
 if(action==='fail')agent.status='failed';
 entry.run=run(id);entry.working.through=agent.status==='running'?null:agent.records.length;entry.revision=changes.length+1;
 const change={cursor:entry.revision,entry:structuredClone(entry)};changes.push(change);for(const res of groupClients)write(res,'entry',{version:1,workspaceId,type:'entry',change});
 if(agent.status!=='running'){emit(id,'state',{run:run(id)});emit(id,'end',{historyPosition:agent.records.length,run:run(id)});for(const res of agent.clients)res.end();agent.clients.clear();}
}
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost'),path=url.pathname;
 const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 if(path==='/workspaces/test-control'){
  let raw='';for await(const part of req)raw+=part;const input=JSON.parse(raw||'{}');
  if(input.action==='text')chunk(input.id,input);
  if(input.action==='commit')commit(input.id);
  if(['publish','fail','refresh'].includes(input.action))update(input.id,input.action);
  if(input.action==='disconnect')for(const client of agents[input.id].clients)client.end();
  return json({agents:Object.fromEntries(Object.entries(agents).map(([id,a])=>[id,{follows:a.follows,status:a.status}])),entries});
 }
 if(path==='/config/app')return json({id:'settings',revision:0,value:{title:'RSI Agent',allowAgentCreation:true,maxInputBytes:20000}});
 if(path==='/config/connections'||path==='/agents')return json([]);
 const workspace={workspaceId,name:'Streaming review',directory:'/tmp/stream-review',createdAt:startedAt};
 if(path==='/workspaces')return json({workspaces:[workspace]});
 if(path===`/workspaces/${workspaceId}/team`)return json({workspaceId,members:members.map(m=>({...m,running:agents[m.memberId].status==='running'}))});
 if(path===`/workspaces/${workspaceId}/team/chat/timeline-follow`){
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});groupClients.add(res);
  for(const change of changes.filter(c=>c.cursor>Number(url.searchParams.get('after')||0)))write(res,'entry',{version:1,workspaceId,type:'entry',change});
  write(res,'sync',{version:1,workspaceId,type:'sync',cursor:changes.length});req.on('close',()=>groupClients.delete(res));return;
 }
 const match=/^\/agents\/([abc])\/follow$/.exec(path);
 if(match){const id=match[1],agent=agents[id];agent.follows++;res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});agent.clients.add(res);
  for(const rec of agent.records.filter(r=>r.position>Number(url.searchParams.get('after')||0)))write(res,'message',privateEvent(id,'message',{record:rec}));
  write(res,'sync',privateEvent(id,'sync',{historyPosition:agent.records.length,run:run(id)}));
  for(const chunk of agent.chunks)write(res,'chunk',privateEvent(id,'chunk',chunk));
  if(agent.status!=='running'){write(res,'end',privateEvent(id,'end',{historyPosition:agent.records.length,run:run(id)}));res.end();}
  req.on('close',()=>agent.clients.delete(res));return;
 }
 json({error:{code:'not_found',message:`Unexpected fixture request: ${req.method} ${path}`}},404);
});
server.listen(4278,'127.0.0.1',()=>console.log('Unified streaming fixture on 127.0.0.1:4278'));
process.on('SIGTERM',()=>{server.closeAllConnections();server.close();});
