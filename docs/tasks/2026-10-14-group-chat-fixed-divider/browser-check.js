async (page) => {
  const measure = () => page.locator('.group-member').first().evaluate(article => {
    const area=article.querySelector('.group-run-area'),header=article.querySelector('.group-run-header'),body=article.querySelector('.group-member-body'),work=article.querySelector('.group-work'),final=article.querySelector('.group-final'),avatar=article.querySelector('.group-avatar');
    const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    const r=rect(area),rule=getComputedStyle(area,'::after'),style=getComputedStyle(header);
    return {area:r,header:rect(header),body:rect(body),avatar:rect(avatar),work:work?rect(work):null,final:rect(final),workOutside:!area.contains(work),workBackground:work?getComputedStyle(work).backgroundColor:null,label:work?.querySelector('.group-work-label')?.textContent,composer:rect(document.querySelector('.group-composer-footer .composer')),line:{left:r.left+parseFloat(rule.left),right:r.right-parseFloat(rule.right),top:r.bottom-parseFloat(rule.height),bottom:r.bottom,width:parseFloat(rule.height)},headerBackground:style.backgroundColor,borders:[style.borderTopWidth,style.borderRightWidth,style.borderBottomWidth,style.borderLeftWidth],overflow:document.documentElement.scrollWidth>innerWidth};
  });
  const check = r=>{
    if(r.headerBackground!=='rgba(0, 0, 0, 0)' || r.borders.some(v=>v!=='0px'))throw new Error('Boxed header');
    if(r.line.width!==2 || Math.abs(r.line.left-r.body.left)>1 || r.line.left<=r.avatar.right || r.line.right<=r.body.right)throw new Error('Divider crosses avatar gutter or fails to span reading column');
    if(r.body.top<r.line.bottom-1 || r.final.top<r.line.bottom-1)throw new Error('Body above divider');
    if(r.work && (!r.workOutside || r.work.top<r.line.bottom || r.work.bottom>r.final.top || r.workBackground==='rgba(0, 0, 0, 0)' || r.label!=='Working history'))throw new Error('Working area not distinct and below fixed divider');
    if(r.body.width>801 || Math.abs(r.body.left-r.composer.left)>1 || Math.abs(r.body.right-r.composer.right)>1 || r.overflow)throw new Error('Width or overflow regression');
  };
  const results=[];
  for(const viewport of [{width:1600,height:1000},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    if(viewport.width<760 && await page.getByRole('button',{name:'Collapse sidebar',exact:true}).count()) await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
    const header=page.locator('.group-run-header').first();
    if(await header.getAttribute('aria-expanded')==='true')await header.click();
    await header.scrollIntoViewIfNeeded();
    const collapsed=await measure();check(collapsed);
    await header.click();
    await page.waitForFunction(()=>document.querySelector('.group-work')?.textContent.includes('verify the stored response ordering'));
    const expanded=await measure();check(expanded);
    if(Math.abs(expanded.area.height-collapsed.area.height)>1 || Math.abs((expanded.line.top-expanded.header.top)-(collapsed.line.top-collapsed.header.top))>1)throw new Error('Divider moves on expansion');
    if((await page.locator('.group-work').first().textContent()).includes('Group chat implementation'))throw new Error('Final text duplicated');
    await header.evaluate(e=>e.blur());
    await page.screenshot({path:`output/playwright/fixed-divider-${viewport.width}.png`});
    await header.focus();await header.press('Enter');
    if(await header.getAttribute('aria-expanded')!=='false')throw new Error('Keyboard disclosure failed');
    results.push({viewport,collapsed,expanded});
  }
  return results;
}
