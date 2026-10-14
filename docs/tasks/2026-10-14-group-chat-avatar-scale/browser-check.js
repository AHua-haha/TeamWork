async (page) => {
  const results=[];
  const measure=()=>page.evaluate(()=>{
    const avatars=[...document.querySelectorAll('.group-avatar')];
    const boxes=[...document.querySelectorAll('.group-run-card,.group-user-body')];
    const names=[...document.querySelectorAll('.group-identity-name')];
    const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,cx:(r.left+r.right)/2,cy:(r.top+r.bottom)/2};};
    const capture=()=>({avatars:avatars.map(rect),boxes:boxes.map(rect),names:names.map(rect)});
    const scaled=capture(),previous=avatars.map(e=>e.style.transform);
    avatars.forEach(e=>e.style.transform='none');
    const baseline=capture();
    avatars.forEach((e,i)=>e.style.transform=previous[i]);
    const member=document.querySelector('.group-member'),user=document.querySelector('.group-user');
    const memberAvatar=rect(member.querySelector('.group-avatar')),userAvatar=rect(user.querySelector('.group-avatar')),card=rect(member.querySelector('.group-run-card')),bubble=rect(user.querySelector('.group-user-body'));
    const body=rect(member.querySelector('.group-member-body')),composer=rect(document.querySelector('.group-composer-footer .composer'));
    return {scaled,baseline,memberGap:card.left-memberAvatar.right,userGap:userAvatar.left-bubble.right,body,composer,card,bubble,userAvatar,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  const check=r=>{
    r.scaled.avatars.forEach((avatar,i)=>{
      const before=r.baseline.avatars[i];
      if(Math.abs(avatar.cx-before.cx)>.1 || Math.abs(avatar.cy-before.cy)>.1 || Math.abs(avatar.width-before.width*.8)>.1 || Math.abs(avatar.height-before.height*.8)>.1)throw new Error('Avatar size or center mismatch');
    });
    for(const key of ['boxes','names'])r.scaled[key].forEach((rect,i)=>{if(JSON.stringify(rect)!==JSON.stringify(r.baseline[key][i]))throw new Error('Message/name layout moved when avatar scaled');});
    if(Math.abs(r.memberGap-r.userGap)>1 || Math.abs(r.bubble.right-r.card.right)>1 || r.overflow || r.body.width>801 || Math.abs(r.body.left-r.composer.left)>1 || Math.abs(r.body.right-r.composer.right)>1)throw new Error('Gap, edge or reading layout regression');
    if(r.bubble.height<48 && Math.abs(r.bubble.cy-r.userAvatar.cy)>.1)throw new Error('Single-line bubble center no longer matches avatar');
  };
  for(const viewport of [{width:1600,height:1000},{width:390,height:844},{width:320,height:844}]){
    await page.setViewportSize(viewport);
    if(viewport.width<760 && await page.getByRole('button',{name:'Collapse sidebar',exact:true}).count())await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
    if(viewport.width<760)await page.waitForFunction(()=>document.querySelector('.context-panel').getBoundingClientRect().right<=1);
    await page.locator('.group-user').first().scrollIntoViewIfNeeded();
    const result=await measure();check(result);
    await page.screenshot({path:`output/playwright/avatar-scale-${viewport.width}.png`});
    results.push({viewport,diameter:result.scaled.avatars[0].width,centers:result.scaled.avatars.map((r,i)=>({x:r.cx-result.baseline.avatars[i].cx,y:r.cy-result.baseline.avatars[i].cy})),memberGap:result.memberGap,userGap:result.userGap});
  }
  await page.setViewportSize({width:1600,height:1000});
  await page.getByRole('button',{name:'Show design, team and files',exact:true}).click();
  const panel=await measure();check(panel);
  results.push({panelOpen:true,diameter:panel.scaled.avatars[0].width});
  return results;
}
