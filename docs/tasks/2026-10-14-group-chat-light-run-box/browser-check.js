async (page) => {
  const measure = () => page.locator('.group-member').first().evaluate(article => {
    const area=article.querySelector('.group-run-area'),header=article.querySelector('.group-run-header'),body=article.querySelector('.group-member-body'),card=article.querySelector('.group-run-card'),work=article.querySelector('.group-work'),final=article.querySelector('.group-final'),avatar=article.querySelector('.group-avatar'),chevron=article.querySelector('.run-header-chevron');
    const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    const r=rect(area),rule=getComputedStyle(area,'::after'),style=getComputedStyle(header),surface=getComputedStyle(card);
    const user=document.querySelector('.group-user'),bubble=user.querySelector('.group-user-body'),name=user.querySelector('.group-identity-name'),userAvatar=user.querySelector('.group-avatar');
    return {area:r,header:rect(header),body:rect(body),card:rect(card),avatar:rect(avatar),work:work?rect(work):null,final:rect(final),contained:card.contains(header)&&card.contains(body)&&(!work||card.contains(work)),workOutside:!area.contains(work),background:surface.backgroundColor,border:surface.borderWidth,shadow:surface.boxShadow,radius:surface.borderRadius,workBackground:work?getComputedStyle(work).backgroundColor:null,composer:rect(document.querySelector('.group-composer-footer .composer')),line:{left:r.left+parseFloat(rule.left),right:r.right-parseFloat(rule.right),top:r.bottom-parseFloat(rule.height),bottom:r.bottom,width:parseFloat(rule.height)},headerBackground:style.backgroundColor,borders:[style.borderTopWidth,style.borderRightWidth,style.borderBottomWidth,style.borderLeftWidth],startMargin:getComputedStyle(article.querySelector('.run-header-start')).marginLeft,chevron:{svg:!!chevron.querySelector('svg path'),text:chevron.textContent,transform:getComputedStyle(chevron).transform,left:rect(chevron).left},statusDot:!!article.querySelector('.run-header-dot'),user:{text:bubble.textContent,name:name.textContent,nameBelow:rect(name).top>=rect(userAvatar).bottom,avatarOutside:rect(userAvatar).left>=rect(bubble).right},overflow:document.documentElement.scrollWidth>innerWidth};
  });
  const check = r=>{
    if(!r.contained || r.background!=='rgb(246, 247, 246)' || r.border!=='0px' || r.shadow!=='none' || r.radius!=='14px')throw new Error('Light run box treatment or grouping mismatch');
    if(r.avatar.right>=r.card.left)throw new Error('Avatar overlaps the box');
    if(r.headerBackground!=='rgba(0, 0, 0, 0)' || r.borders.some(v=>v!=='0px'))throw new Error('Header has a separate box');
    if(r.statusDot || !r.chevron.svg || r.chevron.text || r.startMargin!=='0px')throw new Error('Left metadata/standard icon mismatch');
    if(r.line.width!==2 || Math.abs(r.line.left-r.body.left)>1 || r.line.left<=r.avatar.right || r.line.right<=r.body.right || r.line.right>r.card.right)throw new Error('Divider crosses avatar or card edges');
    if(r.body.top<r.line.bottom-1 || r.final.top<r.line.bottom-1)throw new Error('Body above divider');
    if(r.work && (!r.workOutside || r.work.top<r.line.bottom || r.work.bottom>r.final.top || r.workBackground===r.background))throw new Error('Working area not distinct below fixed divider');
    if(r.body.width>801 || Math.abs(r.body.left-r.composer.left)>1 || Math.abs(r.body.right-r.composer.right)>1 || r.overflow)throw new Error('Reading/composer alignment or overflow regression');
    if(r.user.text!=='@Backend @Frontend implement the group chat design' || r.user.name!=='You' || !r.user.nameBelow || !r.user.avatarOutside)throw new Error('User bubble/identity regression');
  };
  const results=[];
  for(const viewport of [{width:1600,height:1000},{width:390,height:844},{width:320,height:844}]){
    await page.setViewportSize(viewport);
    if(viewport.width<760 && await page.getByRole('button',{name:'Collapse sidebar',exact:true}).count())await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
    const header=page.locator('.group-run-header').first();
    if(await header.getAttribute('aria-expanded')==='true')await header.click();
    await header.scrollIntoViewIfNeeded();
    const collapsed=await measure();check(collapsed);
    if(collapsed.chevron.transform!=='none')throw new Error('Folded chevron points down');
    await header.evaluate(e=>e.blur());
    await page.screenshot({path:`output/playwright/light-run-box-${viewport.width}-collapsed.png`});
    await header.click();
    await page.waitForFunction(()=>document.querySelector('.group-work')?.textContent.includes('verify the stored response ordering'));
    const expanded=await measure();check(expanded);
    if(Math.abs(expanded.area.height-collapsed.area.height)>1 || expanded.chevron.transform!=='matrix(0, 1, -1, 0, 0, 0)' || expanded.card.height<=collapsed.card.height)throw new Error('Disclosure moves divider or fails to expand card/icon');
    const trace=await page.locator('.group-work').first().textContent();
    if(trace.includes('Group chat implementation') || trace.includes('Working history'))throw new Error('Trace duplicates final/title');
    await header.evaluate(e=>e.blur());
    await page.screenshot({path:`output/playwright/light-run-box-${viewport.width}-expanded.png`});
    await header.focus();await header.press('Enter');
    if(await header.getAttribute('aria-expanded')!=='false')throw new Error('Keyboard collapse failed');
    results.push({viewport,collapsed,expanded});
  }
  await page.setViewportSize({width:1600,height:1000});
  await page.getByRole('button',{name:'Show design, team and files',exact:true}).click();
  await page.locator('.group-run-header').first().scrollIntoViewIfNeeded();
  const panelOpen=await measure();check(panelOpen);
  results.push({panelOpen});
  return results;
}
