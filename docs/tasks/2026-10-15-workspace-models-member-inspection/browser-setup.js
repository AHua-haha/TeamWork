async page => {
  const workspaceId = 'review';
  const workspace = {workspaceId, name:'Review project', directory:'/tmp/review-project', createdAt:Date.now(), context:{workspaceId,seq:0,user:{files:0,bytes:0},agent:{files:0,bytes:0},problems:[]}};
  const model = {connectionId:'provider',modelId:'model-a'};
  const settings = {...model,prompt:'Member instructions',promptOptionIds:[],toolOptionIds:[],modelOptions:[model]};
  const lead = {memberId:'lead',workspaceId,revision:1,name:'Lead',role:'Lead',responsibility:'Maintain design and coordinate implementation',harness:{designScope:{working:[],dependencies:[]},implementationScope:{paths:['src'],usePaths:['shared']},allowedCommands:[{kind:'executable',executable:'node'}]},lead:true,settings,issues:[],ready:true,running:false};
  const record = {revision:0,value:{models:[model],defaultModel:model},issues:[]};
  const inspection = {member:lead,configuration:{path:'.team/members/lead/member.json',files:{'member.json':JSON.stringify({version:2,name:'Lead'},null,2),'prompts/member.md':'Maintain the current project design.'},submittedAt:Date.now(),submittedBy:'user',digest:'test'},harnesses:[{id:'project',tools:['ls','read','write','edit','commit_scope','submit_member_config'],prompt:'Follow the accepted design.',parts:[{id:'design',paths:['.context/user'],exclude:[],commit:'user',prompt:'Design acceptance requires user review.'},{id:'implementation',paths:['src'],exclude:['shared'],commit:'agent',prompt:'Implement assigned designs.'}]},{id:'command',tools:['run_command'],prompt:'Only configured command rules apply.',parts:[]}]};
  let listed = [workspace], conflict = false;
  const writes = [], unexpected = [], errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route(/\/(?:config|agents|workspaces)(?:[/?]|$)/, async route => {
    const req=route.request(), path=new URL(req.url()).pathname, method=req.method();
    const reply=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
    if(method!=='GET') writes.push({method,path,body:req.postDataJSON()});
    if(path==='/config/app')return reply({id:'app',revision:0,value:{title:'RSI Agent',maxInputBytes:20000,allowAgentCreation:true}});
    if(path==='/agents')return reply([]);
    if(path==='/config/connections')return reply([{id:'provider',revision:0,value:{label:'Review provider',provider:'openai',baseUrl:'http://example.invalid',api:'openai-responses',keyConfigured:true}}]);
    if(path==='/config/connections/provider/models')return reply(['model-a','model-b'].map(modelId=>({source:'pi',modelId,label:modelId,api:'openai-responses',reasoning:true,reasoningLevels:['off','low','medium','high','xhigh'],defaultReasoning:'off',reasoningSentAs:{},contextWindow:100000,maxTokens:8000,verified:true})));
    if(path==='/workspaces' && method==='GET')return reply({workspaces:listed});
    if(path==='/workspaces' && method==='POST'){const input=req.postDataJSON(); listed=[{...workspace,...input}];return reply({...workspace,...input},201);}
    if(path===`/workspaces/${workspaceId}`)return reply(workspace);
    if(path===`/workspaces/${workspaceId}/models`){
      if(method==='GET')return reply(record);
      const input=req.postDataJSON();
      if(conflict || input.revision!==record.revision){conflict=false;return reply({error:{code:'config_conflict',message:'Workspace models changed; reload saved settings'}},409);}
      record.revision++;record.value=input.value;return reply(record);
    }
    if(path===`/workspaces/${workspaceId}/team`)return reply({workspaceId,members:[lead]});
    if(path===`/workspaces/${workspaceId}/team/members/lead`)return reply(inspection);
    if(path===`/workspaces/${workspaceId}/designs`)return reply({designs:[],truncated:false});
    if(path===`/workspaces/${workspaceId}/context`)return reply(workspace.context);
    if(path.endsWith('/tree'))return reply({path:'',entries:[],truncated:false});
    if(path.endsWith('/timeline-follow'))return route.fulfill({contentType:'text/event-stream',body:`event: sync\ndata: ${JSON.stringify({version:1,workspaceId,type:'sync',cursor:0})}\n\n`});
    if(path.endsWith('/context/follow'))return route.fulfill({contentType:'text/event-stream',body:`event: sync\ndata: ${JSON.stringify({version:1,workspaceId,type:'sync',seq:0})}\n\n`});
    unexpected.push({method,path});return reply({error:{message:`Unexpected mock request ${method} ${path}`}},404);
  });
  await page.exposeFunction('__reviewState', () => ({writes,unexpected,errors,record}));
  await page.exposeFunction('__reviewConflict', () => {conflict=true;});
  await page.goto('http://127.0.0.1:4274/?page=home');
}
