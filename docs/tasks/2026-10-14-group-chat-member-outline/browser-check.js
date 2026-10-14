async (page) => {
  const measure = () => page.locator('.group-member').first().evaluate(article=>{
    const area=article.querySelector('.group-run-area'),info=article.querySelector('.group-run-info'),button=article.querySelector('.group-work-toggle'),card=article.querySelector('.group-run-card'),body=article.querySelector('.group-member-body'),work=article.querySelector('.group-work'),final=article.querySelector('.group-final'),chevron=article.querySelector('.run-header-chevron');
    const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    return {area:rect(area),info:rect(info),button:rect(button),card:rect(card),body:rect(body),work:work?rect(work):null,final:rect(final),avatar:rect(article.querySelector('.group-avatar')),composer:rect(document.querySelector('.group-composer-footer .composer')),cardBackground:getComputedStyle(card).backgroundColor,cardBorder:getComputedStyle(card).borderLeftWidth,cardOutline:getComputedStyle(card).borderLeftColor,buttonOutline:getComputedStyle(button).borderLeftColor,buttonFill:getComputedStyle(button).backgroundColor,tagFill:getComputedStyle(info).backgroundColor,areaBackground:getComputedStyle(area).backgroundColor,divider:getComputedStyle(area,'::after').content,statusColor:getComputedStyle(info.querySelector('.run-header-status')).color,metadataColor:getComputedStyle(info.querySelector('time')).color,buttonColor:getComputedStyle(button).color,tagName:info.tagName,tagTabIndex:info.getAttribute('tabindex'),chevron:{svg:!!chevron.querySelector('svg path'),transform:getComputedStyle(chevron).transform,width:rect(chevron).width},hasDot:!!article.querySelector('.run-header-dot'),workInside:!work||card.contains(work),overflow:document.documentElement.scrollWidth>innerWidth};
  });
  const check=r=>{
    if(r.cardBackground!=='rgb(255, 255, 255)' || r.cardBorder!=='1px' || r.cardOutline!==r.buttonOutline || r.buttonFill===r.tagFill || r.buttonFill===r.cardBackground)throw new Error('Member outline/white surface/tinted Work mismatch');
    if(r.info.height!==24 || r.button.height!==24 || r.info.left!==r.body.left)throw new Error('Pill size or reading alignment mismatch');
    if(r.body.width>=220 && (Math.abs(r.info.top-r.button.top)>1 || Math.abs(r.button.left-r.info.right-6)>1))throw new Error('Pill button is not adjacent and centered');
    if(r.info.right>r.area.right+1 || r.button.right>r.area.right+1 || r.areaBackground!=='rgba(0, 0, 0, 0)' || r.divider!=='none')throw new Error('Pill overflow or old header band/divider remains');
    if(r.tagName!=='DIV' || r.tagTabIndex!==null || r.statusColor!=='rgb(61, 120, 80)' || r.metadataColor!=='rgb(48, 55, 51)' || r.buttonColor!=='rgb(48, 55, 51)')throw new Error('Passive tag or semantic colors mismatch');
    if(!r.chevron.svg || r.chevron.width!==12 || r.hasDot || r.avatar.right>=r.card.left)throw new Error('Icon/identity regression');
    if(r.work && (!r.workInside || r.work.top<r.area.bottom || r.work.bottom>r.final.top))throw new Error('Work grouping mismatch');
    if(r.body.width>801 || Math.abs(r.body.left-r.composer.left)>1 || Math.abs(r.body.right-r.composer.right)>1 || r.overflow)throw new Error('Reading/composer width or overflow regression');
  };
  const results=[];
  for(const viewport of [{width:1600,height:1000},{width:390,height:844},{width:320,height:844}]){
    await page.setViewportSize(viewport);
    if(viewport.width<760 && await page.getByRole('button',{name:'Collapse sidebar',exact:true}).count())await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
    const member=page.locator('.group-member').first(),toggle=member.locator('.group-work-toggle');
    if(await toggle.getAttribute('aria-expanded')==='true')await toggle.click();
    await member.locator('.group-run-info').click();
    if(await toggle.getAttribute('aria-expanded')!=='false')throw new Error('Passive tag toggles work');
    const collapsed=await measure();check(collapsed);
    if(collapsed.chevron.transform!=='none')throw new Error('Folded chevron points down');
    await page.screenshot({path:`output/playwright/member-outline-${viewport.width}-collapsed.png`});
    await toggle.click();
    await page.waitForFunction(()=>document.querySelector('.group-work')?.textContent.includes('verify the stored response ordering'));
    const expanded=await measure();check(expanded);
    if(expanded.area.height!==collapsed.area.height || expanded.chevron.transform!=='matrix(0, 1, -1, 0, 0, 0)')throw new Error('Work expansion changes pill alignment or icon');
    const trace=await member.locator('.group-work').textContent();
    if(trace.includes('Working history') || trace.includes('Group chat implementation'))throw new Error('Work title/final duplication');
    await toggle.evaluate(e=>e.blur());
    await page.screenshot({path:`output/playwright/member-outline-${viewport.width}-expanded.png`});
    await toggle.focus();await toggle.press('Enter');
    if(await toggle.getAttribute('aria-expanded')!=='false')throw new Error('Keyboard collapse failed');
    results.push({viewport,collapsed,expanded});
  }
  await page.setViewportSize({width:1600,height:1000});
  await page.getByRole('button',{name:'Show design, team and files',exact:true}).click();
  await page.locator('.group-run-info').first().scrollIntoViewIfNeeded();
  const panelOpen=await measure();check(panelOpen);results.push({panelOpen});
  const failed=await page.locator('.group-run-info[data-status=failed]').evaluate(info=>getComputedStyle(info.querySelector('.run-header-status')).color);
  if(failed!=='rgb(176, 75, 67)')throw new Error('Failed status no longer red');
  await page.locator('.group-member').nth(1).screenshot({path:'output/playwright/member-outline-short-response.png'});
  const outlines=await page.locator('.group-run-card').evaluateAll(cards=>cards.slice(0,2).map(card=>getComputedStyle(card).borderColor));
  if(outlines[0]===outlines[1])throw new Error('Outline colors do not follow member identity');
  results.push({outlines});
  return results;
}
