async (page) => {
  const results=[];
  for(const viewport of [{width:1600,height:1000},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    if(viewport.width<760 && await page.getByRole('button',{name:'Collapse sidebar',exact:true}).count()) await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
    await page.locator('.group-user').first().scrollIntoViewIfNeeded();
    const identity=await page.locator('.group-user').first().evaluate(article=>{
      const bubble=article.querySelector('.group-user-body'),stack=article.querySelector('.group-user-identity'),avatar=stack.querySelector('.group-avatar'),name=stack.querySelector('.group-identity-name');
      const b=bubble.getBoundingClientRect(),a=avatar.getBoundingClientRect(),n=name.getBoundingClientRect();
      return {text:bubble.textContent,name:name.textContent,nameBelow:n.top>=a.bottom,centered:Math.abs((n.left+n.right)-(a.left+a.right))<2,outside:!bubble.contains(stack)&&a.left>=b.right,overflow:document.documentElement.scrollWidth>innerWidth};
    });
    if(identity.text!=='@Backend @Frontend implement the group chat design' || identity.name!=='You' || !identity.nameBelow || !identity.centered || !identity.outside || identity.overflow)throw new Error('User identity layout or message text regression');
    const member=page.locator('.group-member').first(),header=member.locator('.group-run-header');
    if(await header.getAttribute('aria-expanded')==='true')await header.click();
    await header.click();
    await page.waitForFunction(()=>document.querySelector('.group-work')?.textContent.includes('verify the stored response ordering'));
    const work=await member.locator('.group-work').textContent();
    if(work.includes('Working history'))throw new Error('Visible Working history title remains');
    const geometry=await member.evaluate(article=>{
      const area=article.querySelector('.group-run-area').getBoundingClientRect(),trace=article.querySelector('.group-work').getBoundingClientRect(),body=article.querySelector('.group-member-body').getBoundingClientRect(),avatar=article.querySelector('.group-avatar').getBoundingClientRect();
      return {belowDivider:trace.top>=area.bottom,excludesAvatar:area.left>=avatar.right,bodyWidth:body.width};
    });
    if(!geometry.belowDivider || !geometry.excludesAvatar || geometry.bodyWidth>801)throw new Error('Fixed divider or reading width regression');
    await page.locator('.group-user').first().scrollIntoViewIfNeeded();
    await header.evaluate(e=>e.blur());
    await page.screenshot({path:`output/playwright/identity-labels-${viewport.width}.png`});
    results.push({viewport,identity,geometry});
  }
  return results;
}
