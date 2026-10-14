async (page) => {
  const failed = await page.locator('[data-entry-id="failed-run"] .run-header-status').textContent();
  if (failed !== 'Failed') throw new Error('Failed run header status missing');
  const input=page.getByRole('textbox',{name:'Message the team'});
  await input.fill('@Backend work'); await input.press('Enter');
  await page.getByRole('button',{name:'Stop team'}).waitFor();
  const reply=page.locator('.group-member').last();
  if (await reply.locator('.run-header-status').textContent() !== 'Working') throw new Error('Running response header missing');
  const entryId=await reply.getAttribute('data-entry-id');
  await reply.locator('.group-run-header').click();
  if (await reply.locator('.group-run-header').getAttribute('aria-expanded') !== 'true') throw new Error('Running work cannot expand');
  await page.getByRole('button',{name:'Stop team'}).click();
  await page.waitForFunction(id => document.querySelector(`[data-entry-id="${id}"] .run-header-status`)?.textContent==='Cancelled', entryId);
  if (await reply.getAttribute('data-entry-id') !== entryId || await reply.locator('.group-final').count()) throw new Error('Cancelled response moved or invented a final');
  return {failed, cancelled:await reply.locator('.run-header-status').textContent(), entryId};
}
