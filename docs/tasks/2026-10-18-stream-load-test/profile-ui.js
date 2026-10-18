async page => {
  const session = await page.context().newCDPSession(page);
  await session.send('Profiler.enable'); await session.send('Profiler.setSamplingInterval', { interval: 1000 }); await session.send('Profiler.start');
  await page.evaluate(async () => (await fetch('/workspaces/load/start', { method: 'POST', body: JSON.stringify({ label: 'ui-profile', duration: 12, rate: 100, chunkSize: 32, workers: 1 }) })).json());
  const measured = await page.evaluate(async () => (await fetch('/workspaces/load/result')).json());
  const { profile } = await session.send('Profiler.stop'); await session.detach();
  const nodes = new Map(profile.nodes.map(n=>[n.id,n])), parents = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child,node.id);
  const buckets = {}, self = new Map();
  for (let i=0;i<profile.samples.length;i++) {
    const id=profile.samples[i], leaf=nodes.get(id), time=(profile.timeDeltas[i]??1000)/1000;
    self.set(id,(self.get(id)??0)+time);
    const stack=[]; for(let n=id;n;n=parents.get(n)) stack.push(nodes.get(n).callFrame);
    let category;
    if(leaf.callFrame.functionName==='(idle)')category='idle';
    else if(leaf.callFrame.functionName==='(garbage collector)')category='garbage collection';
    else if(stack.some(f=>f.url.includes('/markdown-parser')))category='Markdown parsing';
    else if(stack.some(f=>f.url.includes('/group-work')))category='working activity projection';
    else if(stack.some(f=>f.url.includes('react-dom')||f.url.includes('react_jsx')))category='React rendering/reconciliation';
    else if(stack.some(f=>f.url.includes('/client/')))category='stream client/projection';
    else category='other/browser integration';
    buckets[category]=(buckets[category]??0)+time;
  }
  const activeMs=Object.entries(buckets).filter(([k])=>k!=='idle').reduce((n,[k,v])=>n+v,0);
  delete measured.ticks;
  return { measured, profile: { activeSampleMs:activeMs, categories: Object.entries(buckets).map(([category,ms])=>({category,ms,percentOfActive: category==='idle'?null:100*ms/activeMs})), topSelfFunctions:[...self.entries()].sort((a,b)=>b[1]-a[1]).filter(([id])=>nodes.get(id).callFrame.functionName!=='(idle)').slice(0,20).map(([id,ms])=>({function:nodes.get(id).callFrame.functionName,url:nodes.get(id).callFrame.url,ms})) } };
}
