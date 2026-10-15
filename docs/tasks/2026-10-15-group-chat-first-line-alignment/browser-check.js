async (page) => {
  await page.setViewportSize({width:1600,height:1000});
  await page.reload();
  const member=page.locator('.group-member').first();
  await member.waitFor();
  await page.evaluate(()=>document.fonts.ready);
  const markdown=member.locator('.group-final .markdown');
  const original=await markdown.innerHTML();
  const measure=()=>member.evaluate(article=>{
    const card=article.querySelector('.group-run-card'),avatar=article.querySelector('.group-avatar'),first=article.querySelector('.group-final .markdown').firstElementChild;
    const r=first.getBoundingClientRect(),s=getComputedStyle(first),a=avatar.getBoundingClientRect(),c=card.getBoundingClientRect(),header=article.querySelector('.group-run-area').getBoundingClientRect();
    const user=document.querySelector('.group-user'),bubble=user.querySelector('.group-user-body').getBoundingClientRect(),u=user.querySelector('.group-avatar').getBoundingClientRect();
    const composer=document.querySelector('.group-composer-footer .composer').getBoundingClientRect(),body=article.querySelector('.group-member-body').getBoundingClientRect();
    const center=a.top+a.height/2,lineCenter=r.top+parseFloat(s.paddingTop)+parseFloat(s.borderTopWidth)+parseFloat(s.lineHeight)/2;
    return {tag:first.tagName,center,lineCenter,lineHeight:parseFloat(s.lineHeight),firstHeight:r.height,avatarOffset:center-c.top,referenceSize:parseFloat(getComputedStyle(article.querySelector('.group-avatar')).height),userOffset:u.top+u.height/2-bubble.top,headerBottom:header.bottom,cardTop:c.top,pillBottom:Math.max(...[...article.querySelectorAll('.group-run-pill')].map(e=>e.getBoundingClientRect().bottom)),divider:getComputedStyle(card).borderTopWidth,dividerColor:getComputedStyle(card).borderTopColor,cardLeft:c.left,cardRight:c.right,avatarRight:a.right,userAvatarLeft:u.left,bubbleRight:bubble.right,bodyLeft:body.left,bodyRight:body.right,composerLeft:composer.left,composerRight:composer.right,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  const check=r=>{
    if(Math.abs(r.center-r.lineCenter)>.1)throw new Error('First line misses avatar center: '+JSON.stringify(r));
    if(Math.abs(r.avatarOffset-r.referenceSize/2)>.1 || Math.abs(r.userOffset-r.avatarOffset)>.1)throw new Error('Existing avatar center moved');
    if(Math.abs(r.headerBottom-r.cardTop)>.1 || r.cardTop-r.pillBottom<8 || r.divider!=='1px' || r.dividerColor!=='rgb(233, 237, 232)')throw new Error('Divider/pill geometry changed');
    if(Math.abs((r.cardLeft-r.avatarRight)-(r.userAvatarLeft-r.bubbleRight))>1 || Math.abs(r.bubbleRight-r.cardRight)>1 || Math.abs(r.bodyLeft-r.composerLeft)>1 || Math.abs(r.bodyRight-r.composerRight)>1 || r.overflow)throw new Error('Horizontal alignment changed');
  };
  const results=[];
  for(const width of [1600,390]){
    await page.setViewportSize({width,height:width===1600?1000:844});
    if(width<760 && await page.getByRole('button',{name:'Collapse sidebar',exact:true}).count())await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
    if(width<760)await page.waitForFunction(()=>document.querySelector('.context-panel').getBoundingClientRect().right<=1);
    for(const tag of ['p','h1','h2','h3','h4','h5','h6']){
      // Controlled presentation fixture: exercise actual rendered typography for each leading text block.
      await markdown.evaluate((root,tag)=>{
        const block=document.createElement(tag);
        block.textContent=tag==='p'?'关于我的具体模型，我的系统配置里没有直接标明模型名称，所以我不确定自己是哪个具体型号。 This longer paragraph wraps while its avatar remains anchored to the first line.':'A heading begins this response';
        root.replaceChildren(block);
      },tag);
      const geometry=await measure();check(geometry);results.push({width,...geometry});
      if(tag==='p'){
        if(geometry.firstHeight<=geometry.lineHeight)throw new Error('Paragraph fixture did not wrap');
        await member.locator('.group-run-info').scrollIntoViewIfNeeded();
        await page.screenshot({path:`output/playwright/first-line-${width}-paragraph.png`});
      }
    }
    await markdown.evaluate((root,html)=>{root.innerHTML=html;},original);
    const toggle=member.locator('.group-work-toggle');
    await toggle.click();
    await member.locator('.group-work').waitFor();
    const work=await member.evaluate(article=>({divider:article.querySelector('.group-run-card').getBoundingClientRect().top,work:article.querySelector('.group-work').getBoundingClientRect().top}));
    if(work.work<work.divider)throw new Error('Work moved above the divider');
    await toggle.click();
    check(await measure());
  }
  return results;
}
