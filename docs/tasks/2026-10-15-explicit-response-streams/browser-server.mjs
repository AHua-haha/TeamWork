import {createServer} from 'node:http';
const workspaceId='stream-review', startedAt=Date.now();
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
const assistant=(text,content=[{type:'text',text}])=>({role:'assistant',content,api:'openai-responses',provider:'openai',model:'fixture',usage,stopReason:'stop',timestamp:startedAt});
const run=(id,status='running')=>({agentId:id,runId:`run-${id}`,status,phase:status==='running'?'model':'finished',step:1,startedAt,endedAt:status==='running'?null:Date.now(),endPosition:status==='running'?null:id==='a'?6:2,activeMessageId:status==='running'?`reply-${id}`:null,error:null});
const record=(id,position,messageId,message)=>({agentId:id,runId:`run-${id}`,position,messageId,message,metadata:{}});
const tool=(id,position,name,args)=>record(id,position,`tool-${position}`,assistant('',[{type:'toolCall',id:`call-${position}`,name,arguments:args}]));
const result=(id,position,name,text)=>record(id,position,`result-${position}`,{role:'toolResult',toolCallId:`call-${position-1}`,toolName:name,content:[{type:'text',text}],isError:false,timestamp:startedAt});
const agents={a:{records:[tool('a',1,'read',{path:'src/workspace.ts'}),result('a',2,'read','export class WorkspaceService {}'),tool('a',3,'run_command',{argv:['node','--version','--example-long-command-description-to-check-truncation-in-a-narrow-pane']}),result('a',4,'run_command','v26.2.0')],chunks:[],clients:new Set(),status:'running',follows:0,workingText:''},b:{records:[],chunks:[],clients:new Set(),status:'running',follows:0,workingText:''}};
const groupClients=new Set(), changes=[];
const entries=['a','b'].map((id,i)=>({workspaceId,entryId:`entry-${id}`,position:i+1,revision:i+1,exchangeId:'exchange',time:startedAt,kind:'member',memberId:id,name:id==='a'?'Lead':'Writer',run:run(id),working:{after:0,through:null},finalRef:null,text:null}));
entries.forEach((entry,i)=>changes.push({cursor:i+1,entry:structuredClone(entry)}));
const members=entries.map((entry,i)=>({memberId:entry.memberId,workspaceId,revision:0,name:entry.name,role:entry.name,lead:i===0,responsibility:'Fixture run',harness:{designScope:{working:[],dependencies:[]},implementationScope:{paths:['src'],usePaths:[]},allowedCommands:[]},settings:{connectionId:'provider',modelId:'fixture',modelOptions:[],toolOptionIds:[],promptOptionIds:[],prompt:''},ready:true,issues:[],running:true}));
const write=(res,type,data)=>res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
const privateEvent=(id,type,data)=>({version:1,agentId:id,runId:`run-${id}`,type,...data});
const emit=(id,type,data)=>{for(const res of agents[id].clients)write(res,type,privateEvent(id,type,data));};
function chunk(id,text,kind='working'){
 const agent=agents[id];if(kind==='working')agent.workingText=text;
 const work=id==='a'?[{type:'thinking',thinking:'Inspect the current design before reporting.'}]:[];
 if(agent.workingText)work.push({type:'text',text:agent.workingText});
 const partial=assistant('',kind==='response'?[...work,{type:'toolCall',id:`response-${id}`,name:'final_response',arguments:{text}}]:work);
 const output=kind==='response'?{response:{toolCallId:`response-${id}`,text}}:undefined;
 if(!agent.chunks.length){const initial={...partial,content:[]};agent.chunks.push({messageId:`reply-${id}`,sequence:0,event:{type:'start',partial:initial}});emit(id,'chunk',agent.chunks[0]);}
 const part={messageId:`reply-${id}`,sequence:agent.chunks.length,event:{type:kind==='response'?'toolcall_delta':'text_delta',contentIndex:partial.content.length-1,delta:text,partial},output};
 agent.chunks.push(part);emit(id,'chunk',part);
}
function commit(id){const agent=agents[id],latest=agent.chunks.at(-1);const rec={...record(id,agent.records.length+1,`reply-${id}`,latest.event.partial),output:latest.output};agent.records.push(rec);agent.chunks=[];emit(id,'message',{record:rec});
 const ack=record(id,agent.records.length+1,`ack-${id}`,{role:'toolResult',toolCallId:`response-${id}`,toolName:'final_response',content:[{type:'text',text:'Response prepared for publication.'}],isError:false,timestamp:Date.now()});agent.records.push(ack);emit(id,'message',{record:ack});
 agent.status='completed';emit(id,'state',{run:run(id,'completed')});emit(id,'end',{historyPosition:agent.records.length,run:run(id,'completed')});for(const res of agent.clients)res.end();agent.clients.clear();}
function publish(id){const agent=agents[id],entry=entries.find(e=>e.memberId===id),rec=agent.records.at(-2);entry.run=run(id,'completed');entry.working.through=agent.records.at(-1).position;entry.finalRef={agentId:id,runId:`run-${id}`,messageId:rec.messageId,position:rec.position,toolCallId:`response-${id}`};entry.text=rec.output.response.text;entry.revision=changes.length+1;const change={cursor:entry.revision,entry:structuredClone(entry)};changes.push(change);for(const res of groupClients)write(res,'entry',{version:1,workspaceId,type:'entry',change});}
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost'), path=url.pathname;
 const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 if(path==='/workspaces/test-control'){
  let raw='';for await(const part of req)raw+=part;const input=JSON.parse(raw||'{}');
  if(input.action==='text')chunk(input.id,input.text,input.kind);
  if(input.action==='commit')commit(input.id);
  if(input.action==='publish')publish(input.id);
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
 const match=/^\/agents\/([ab])\/follow$/.exec(path);
 if(match){const id=match[1],agent=agents[id];agent.follows++;res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});agent.clients.add(res);
  for(const rec of agent.records.filter(r=>r.position>Number(url.searchParams.get('after')||0)))write(res,'message',privateEvent(id,'message',{record:rec}));
  write(res,'sync',privateEvent(id,'sync',{historyPosition:agent.records.length,run:run(id,agent.status)}));
  for(const chunk of agent.chunks)write(res,'chunk',privateEvent(id,'chunk',chunk));
  if(agent.status!=='running'){write(res,'end',privateEvent(id,'end',{historyPosition:agent.records.length,run:run(id,agent.status)}));res.end();}
  req.on('close',()=>agent.clients.delete(res));return;
 }
 json({error:{code:'not_found',message:`Unexpected fixture request: ${req.method} ${path}`}},404);
});
server.listen(4276,'127.0.0.1',()=>console.log('Streaming fixture on 127.0.0.1:4276'));
process.on('SIGTERM',()=>{server.closeAllConnections();server.close();});
