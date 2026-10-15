async (page) => {
  await page.setViewportSize({width:1600,height:1000});
  await page.reload();
  await page.locator('.group-member').first().waitFor();
  await page.evaluate(()=>document.fonts.ready);
  const read = locator => locator.evaluate(e => {
    const s=getComputedStyle(e), r=e.getBoundingClientRect();
    return {background:s.backgroundColor,color:s.color,border:s.borderColor,borderWidth:s.borderWidth,height:r.height,outline:s.outlineStyle};
  });
  const status = async (name,background,color) => {
    const pill=page.locator(`.group-run-info[data-status="${name}"]`).first();
    const surface=await read(pill),label=await read(pill.locator('.run-header-status')),time=await read(pill.locator('time'));
    if(surface.background!==background || surface.borderWidth!=='0px' || label.color!==color || time.color!=='rgb(114, 122, 115)')throw new Error(`Incorrect ${name} status treatment`);
    return {name,surface,label,time};
  };
  const results=[];
  results.push(await status('completed','rgb(240, 246, 240)','rgb(82, 118, 90)'));
  results.push(await status('failed','rgb(250, 241, 240)','rgb(163, 99, 92)'));
  for(const width of [1600,390]){
    await page.setViewportSize({width,height:width===1600?1000:844});
    if(width<760 && await page.getByRole('button',{name:'Collapse sidebar',exact:true}).count())await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
    if(width<760)await page.waitForFunction(()=>document.querySelector('.context-panel').getBoundingClientRect().right<=1);
    const member=page.locator('.group-member').first(),toggle=member.locator('.group-work-toggle');
    await page.mouse.move(0,0);
    const folded=await read(toggle);
    if(folded.background!=='rgba(0, 0, 0, 0)' || folded.border!=='rgb(231, 234, 230)' || folded.color!=='rgb(114, 122, 115)' || folded.height!==24)throw new Error('Folded Work is not quiet and compact');
    const header=()=>member.locator('.group-run-area').evaluate(e=>{const r=e.getBoundingClientRect();return {y:r.top-e.closest('.group-member').getBoundingClientRect().top,height:r.height};});
    const headerBefore=await header();
    await toggle.hover();
    const hovered=await read(toggle);
    if(hovered.background!=='rgb(241, 243, 240)' || hovered.color!=='rgb(86, 98, 88)')throw new Error('Work hover treatment differs');
    await toggle.click();
    await page.waitForFunction(()=>document.querySelector('.group-work')?.textContent.includes('verify the stored response ordering'));
    await page.mouse.move(0,0);
    const expanded=await read(toggle),headerAfter=await header();
    if(expanded.background!=='rgb(238, 241, 237)' || expanded.color!=='rgb(80, 90, 82)' || headerBefore.y!==headerAfter.y || headerBefore.height!==headerAfter.height)throw new Error('Expanded Work treatment or header stability differs: '+JSON.stringify({expanded,headerBefore,headerAfter}));
    await page.screenshot({path:`output/playwright/quiet-pills-${width}-expanded.png`});
    await page.keyboard.press('Tab');
    await toggle.focus();
    if((await read(toggle)).outline!=='solid')throw new Error('Keyboard focus ring missing');
    await toggle.press('Enter');
    if(await toggle.getAttribute('aria-expanded')!=='false')throw new Error('Keyboard fold failed');
    await toggle.evaluate(e=>e.blur());
    await page.mouse.move(0,0);
    await page.screenshot({path:`output/playwright/quiet-pills-${width}-collapsed.png`});
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Horizontal page overflow');
    results.push({width,folded,hovered,expanded});
  }
  await page.setViewportSize({width:1600,height:1000});
  const input=page.getByRole('textbox',{name:'Message the team'});
  await input.fill('@Backend work');await input.press('Enter');
  await page.getByRole('button',{name:'Stop team'}).waitFor();
  results.push(await status('running','rgb(245, 246, 245)','rgb(114, 122, 115)'));
  await page.getByRole('button',{name:'Stop team'}).click();
  await page.locator('.group-run-info[data-status="cancelled"]').waitFor();
  results.push(await status('cancelled','rgb(245, 246, 245)','rgb(114, 122, 115)'));
  return results;
}
