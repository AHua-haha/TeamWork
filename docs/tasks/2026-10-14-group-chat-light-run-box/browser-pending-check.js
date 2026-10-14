async (page) => {
  const input=page.getByRole('textbox',{name:'Message the team'});
  await input.fill('@Backend work'); await input.press('Enter');
  await page.getByRole('button',{name:'Stop team'}).waitFor();
  const reply=page.locator('.group-member').last();
  const entryId=await reply.getAttribute('data-entry-id');
  if (await reply.locator('.run-header-status').textContent()!=='Working') throw new Error('Pending run is not identified');
  await reply.locator('.group-run-header').click();
  await reply.locator('.group-work').waitFor();
  const pending=await reply.evaluate(article=>{
    const area=article.querySelector('.group-run-area'),work=article.querySelector('.group-work');
    const rect=area.getBoundingClientRect(),trace=work.getBoundingClientRect();
    return {outside:!area.contains(work),workTop:trace.top,lineBottom:rect.bottom,hasFinal:!!article.querySelector('.group-final')};
  });
  if (!pending.outside || pending.workTop<pending.lineBottom || pending.hasFinal) throw new Error('Pending work is not separate and below the fixed header divider');
  await page.getByRole('button',{name:'Stop team'}).click();
  await page.waitForFunction(id=>document.querySelector(`[data-entry-id="${id}"] .run-header-status`)?.textContent==='Cancelled',entryId);
  if (await reply.getAttribute('data-entry-id')!==entryId) throw new Error('Terminal update moved the reserved section');
  return {pending,terminal:await reply.locator('.run-header-status').textContent()};
}
