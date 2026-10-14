async (page) => {
  const header = page.locator('.group-run-header').first();
  const measure = () => page.evaluate(() => {
    const article=document.querySelector('.group-member');
    const area=article.querySelector('.group-run-area');
    const button=article.querySelector('.group-run-header');
    const body=article.querySelector('.group-member-body');
    const work=article.querySelector('.group-work');
    const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    const section=rect(area), rule=getComputedStyle(area,'::after'), style=getComputedStyle(button);
    return {viewport:innerWidth,article:rect(article),area:section,header:rect(button),body:rect(body),composer:rect(document.querySelector('.group-composer-footer .composer')),work:work?rect(work):null,contained:work?area.contains(work):true,finalOutside:!area.contains(article.querySelector('.group-final')),line:{left:section.left+parseFloat(rule.left),right:section.right-parseFloat(rule.right),top:section.bottom-parseFloat(rule.bottom)-parseFloat(rule.height),bottom:section.bottom-parseFloat(rule.bottom),thickness:parseFloat(rule.height),color:rule.backgroundColor},background:style.backgroundColor,borders:[style.borderTopWidth,style.borderRightWidth,style.borderBottomWidth,style.borderLeftWidth],overflow:document.documentElement.scrollWidth>innerWidth};
  });
  const check = result => {
    if (result.background!=='rgba(0, 0, 0, 0)' || result.borders.some(width=>width!=='0px')) throw new Error('Header still has a fill or box border');
    if (result.line.thickness!==2 || result.line.left>=result.article.left || result.line.right<=result.article.right) throw new Error('Bottom line does not extend across the full message');
    if (result.body.top<result.line.bottom-1 || !result.finalOutside) throw new Error('Final body is inside the header or above its separator');
    if (result.work && (!result.contained || result.work.bottom>result.line.top)) throw new Error('Expanded work is outside the header area');
    if (result.body.width>801 || Math.abs(result.body.left-result.composer.left)>1 || Math.abs(result.body.right-result.composer.right)>1 || result.overflow) throw new Error('Reading alignment or overflow changed');
  };
  if (await header.getAttribute('aria-expanded')==='true') await header.click();
  await header.scrollIntoViewIfNeeded();
  await header.evaluate(element=>element.blur());
  const collapsed=await measure(); check(collapsed);
  await page.screenshot({path:`output/playwright/header-area-${collapsed.viewport}-collapsed.png`});
  await header.click({position:{x:14,y:16}});
  await page.locator('.group-work').first().waitFor();
  await page.waitForFunction(()=>document.querySelector('.group-work')?.textContent.includes('verify the stored response ordering'));
  const expanded=await measure(); check(expanded);
  if (expanded.area.height<=collapsed.area.height || expanded.line.top-expanded.area.top<=collapsed.line.top-collapsed.area.top) throw new Error('Separator did not move beneath expanded work');
  if ((await page.locator('.group-work').first().textContent()).includes('Group chat implementation')) throw new Error('Final text repeated in private work');
  await header.evaluate(element=>element.blur());
  await page.screenshot({path:`output/playwright/header-area-${expanded.viewport}-expanded.png`});
  await header.focus(); await header.press('Enter');
  if (await header.getAttribute('aria-expanded')!=='false') throw new Error('Keyboard collapse failed');
  return {collapsed,expanded};
}
