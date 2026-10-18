async page => {
  const assert=(value,message)=>{if(!value)throw new Error(message);};
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const control=input=>page.evaluate(async input=>{const response=await fetch('/workspaces/test-control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});return response.json();},input);
  const a=page.locator('[data-entry-id="entry-a"]'),b=page.locator('[data-entry-id="entry-b"]'),c=page.locator('[data-entry-id="entry-c"]');
  await page.setViewportSize({width:1440,height:980});
  await a.getByRole('button',{name:'Lead: Hide working history',exact:true}).waitFor();
  await control({action:'text',id:'a',text:'Earlier work.',tools:[{id:'read-1',name:'read',arguments:{path:'src/example.ts'}}]});
  await a.getByText('Earlier work.',{exact:true}).waitFor();
  await control({action:'commit',id:'a'});
  for(const text of ['<','<ment','<mentions>\n["Writer"]\n','<mentions>\n["Writer"]\n</mentions>\n\n']) {
    await control({action:'text',id:'a',text});
    assert(!(await a.innerText()).includes('<mentions>'),'Routing markup is hidden while streaming');
    assert(!(await a.innerText()).includes('["Writer"]'),'Recipient array is hidden while streaming');
  }
  const body='Streaming report @Nobody and @joplin/lib are ordinary content.';
  const raw='<mentions>\n["Writer"]\n</mentions>\n\n'+body;
  await control({action:'text',id:'a',text:raw});
  await a.getByText(body,{exact:true}).waitFor();
  assert(await a.locator('.group-final').count()===0,'Streaming does not establish acceptance');
  await control({action:'commit',id:'a'});
  await control({action:'publish',id:'a'});
  await a.getByRole('button',{name:'Lead: Show working history',exact:true}).waitFor();
  assert(await a.locator('.group-final').getByText(body,{exact:true}).count()===1,'Accepted body appears once');
  assert(!(await a.innerText()).includes('<mentions>'),'Accepted output has no header');
  await a.getByRole('button',{name:'Lead: Show working history',exact:true}).click();
  await a.getByText('Earlier work.',{exact:true}).waitFor();
  assert(await a.getByText(body,{exact:true}).count()===1,'Reopened work does not duplicate accepted body');
  await control({action:'text',id:'b',text:'<mentions>\n</mentions>\n\nEmpty header body.'});
  await b.getByText('Empty header body.',{exact:true}).waitFor();
  await control({action:'commit',id:'b'});await control({action:'publish',id:'b'});
  await b.getByRole('button',{name:'Writer: Show working history',exact:true}).waitFor();
  await control({action:'text',id:'c',text:'No header @Nobody body.'});
  await c.getByText('No header @Nobody body.',{exact:true}).waitFor();
  await control({action:'commit',id:'c'});await control({action:'publish',id:'c'});
  await c.getByRole('button',{name:'Reviewer: Show working history',exact:true}).waitFor();
  await page.reload();
  await a.getByRole('button',{name:'Lead: Show working history',exact:true}).waitFor();
  await a.getByRole('button',{name:'Lead: Show working history',exact:true}).click();
  await a.getByText('Earlier work.',{exact:true}).waitFor();
  assert(await a.getByText(body,{exact:true}).count()===1,'Reload reconstructs body exactly once');
  assert(!(await page.locator('.group-timeline').innerText()).includes('<mentions>'),'No routing headers are rendered');
  await page.screenshot({path:'/Users/ahua/workspace/rsi-agent/output/playwright/mention-header-desktop.png',fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)),'No narrow page overflow');
  await page.screenshot({path:'/Users/ahua/workspace/rsi-agent/output/playwright/mention-header-mobile.png',fullPage:true,animations:'disabled'});
  assert(!errors.length,JSON.stringify(errors));
  console.log('PASS: partial/complete headers hidden, body streams, final acceptance/reopen/reload renders once, empty/omitted headers work, mobile layout preserved.');
}
