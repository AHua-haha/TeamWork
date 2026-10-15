async (page) => {
  await page.setViewportSize({width:1600,height:1000});
  await page.reload();
  await page.locator('.group-member').first().waitFor();
  await page.evaluate(()=>document.fonts.ready);
  const measure=()=>page.locator('.group-member').first().evaluate(article=>{
    const area=article.querySelector('.group-run-area'),info=article.querySelector('.group-run-info'),button=article.querySelector('.group-work-toggle'),card=article.querySelector('.group-run-card'),body=article.querySelector('.group-member-body'),work=article.querySelector('.group-work'),final=article.querySelector('.group-final'),avatar=article.querySelector('.group-avatar'),user=document.querySelector('.group-user'),bubble=user.querySelector('.group-user-body'),userAvatar=user.querySelector('.group-avatar');
    const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,cy:(r.top+r.bottom)/2};};
    return {area:rect(area),info:rect(info),button:rect(button),card:rect(card),body:rect(body),work:work?rect(work):null,final:rect(final),avatar:rect(avatar),referenceSize:parseFloat(getComputedStyle(avatar).height),bubble:rect(bubble),userAvatar:rect(userAvatar),outside:!card.contains(area)&&!card.contains(button),workInside:!work||card.contains(work),dividerColor:getComputedStyle(card).borderTopColor,dividerWidth:getComputedStyle(card).borderTopWidth,dividerStyle:getComputedStyle(card).borderTopStyle,headerBorder:getComputedStyle(area).borderBottomWidth,dividerOffset:card.getBoundingClientRect().top-article.getBoundingClientRect().top,background:getComputedStyle(card).backgroundColor,outline:getComputedStyle(card).borderLeftWidth,statusColor:getComputedStyle(info.querySelector('.run-header-status')).color,metadataColor:getComputedStyle(info.querySelector('time')).color,chevron:getComputedStyle(button.querySelector('.run-header-chevron')).transform,composer:rect(document.querySelector('.group-composer-footer .composer')),overflow:document.documentElement.scrollWidth>innerWidth};
  });
  const check=r=>{
    if(!r.outside || Math.abs(r.area.left-r.card.left)>1 || Math.abs(r.info.left-r.card.left)>1 || Math.abs(r.card.top-r.area.bottom)>1)throw new Error('Outside pills do not align with the box edge');
    if(r.background!=='rgba(0, 0, 0, 0)' || r.outline!=='0px')throw new Error('Open response has a background or enclosing border');
    if(r.dividerColor!=='rgb(233, 237, 232)' || r.dividerWidth!=='1px' || r.dividerStyle!=='solid' || Math.abs(r.area.right-r.card.right)>1 || r.area.left<=r.avatar.right || r.card.top-r.button.bottom<8 || r.headerBorder!=='0px')throw new Error('Light full-width divider geometry mismatch');
    if(r.info.height<24 || r.button.height!==24 || r.info.right>r.area.right+1 || r.button.right>r.area.right+1)throw new Error('Pill size/wrapping mismatch');
    if(r.statusColor!=='rgb(82, 118, 90)' || r.metadataColor!=='rgb(114, 122, 115)')throw new Error('Status colors changed');
    if(Math.abs(r.avatar.cy-r.card.top-r.referenceSize/2)>.1 || Math.abs(r.userAvatar.cy-r.bubble.top-r.referenceSize/2)>.1 || Math.abs((r.card.left-r.avatar.right)-(r.userAvatar.left-r.bubble.right))>1 || Math.abs(r.bubble.right-r.card.right)>1)throw new Error('Avatar reference/gap or message edge regression');
    if(r.work && (!r.workInside || r.work.top<r.card.top || r.work.bottom>r.final.top))throw new Error('Expanded work is outside the message box');
    if(r.body.width>801 || Math.abs(r.body.left-r.composer.left)>1 || Math.abs(r.body.right-r.composer.right)>1 || r.overflow)throw new Error('Reading/composer alignment or page overflow regression');
  };
  const results=[];
  for(const viewport of [{width:1600,height:1000},{width:390,height:844},{width:320,height:844}]){
    await page.setViewportSize(viewport);
    if(viewport.width<760 && await page.getByRole('button',{name:'Collapse sidebar',exact:true}).count())await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
    if(viewport.width<760)await page.waitForFunction(()=>document.querySelector('.context-panel').getBoundingClientRect().right<=1);
    const member=page.locator('.group-member').first(),toggle=member.locator('.group-work-toggle');
    if(await toggle.getAttribute('aria-expanded')==='true')await toggle.click();
    await member.locator('.group-run-info').click();
    if(await toggle.getAttribute('aria-expanded')!=='false')throw new Error('Passive tag opens work');
    const collapsed=await measure();check(collapsed);
    const surfaces=await page.locator('.group-run-card').evaluateAll(cards=>cards.map(card=>({color:getComputedStyle(card).backgroundColor,border:getComputedStyle(card).borderLeftWidth})));
    if(surfaces.length<3 || surfaces.some(s=>s.color!=='rgba(0, 0, 0, 0)' || s.border!=='0px'))throw new Error('Member/status surfaces differ');
    await page.screenshot({path:`output/playwright/message-top-divider-${viewport.width}-collapsed.png`});
    await toggle.click();
    await page.waitForFunction(()=>document.querySelector('.group-work')?.textContent.includes('verify the stored response ordering'));
    const expanded=await measure();check(expanded);
    if(Math.abs(expanded.dividerOffset-collapsed.dividerOffset)>1 || expanded.area.height!==collapsed.area.height || expanded.chevron!=='matrix(0, 1, -1, 0, 0, 0)' || expanded.card.height<=collapsed.card.height)throw new Error('Disclosure changes outside header or fails to expand inside card');
    const trace=await member.locator('.group-work').textContent();
    if(trace.includes('Working history') || trace.includes('Group chat implementation'))throw new Error('Private trace duplicates title/final');
    await toggle.evaluate(e=>e.blur());
    await page.screenshot({path:`output/playwright/message-top-divider-${viewport.width}-expanded.png`});
    await toggle.focus();await toggle.press('Enter');
    if(await toggle.getAttribute('aria-expanded')!=='false')throw new Error('Keyboard fold failed');
    results.push({viewport,collapsed,expanded});
  }
  await page.setViewportSize({width:1600,height:1000});
  await page.getByRole('button',{name:'Show design, team and files',exact:true}).click();
  const panelOpen=await measure();check(panelOpen);results.push({panelOpen});
  return results;
}
