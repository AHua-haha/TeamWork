async (page) => {
  // Use the observed composer/Stop controls to verify admission and cancellation quickly,
  // before this controlled fixture's scheduled final response can complete.
  const input = page.getByRole('textbox', {name: 'Message the team'});
  const before = await page.locator('article[data-entry-id]').count();
  await input.fill('@Backend work'); await input.press('Enter');
  await page.getByRole('button', {name: 'Stop team'}).waitFor();
  const count = await page.locator('article[data-entry-id]').count();
  if (count !== before + 2) throw new Error('User and response reservation did not appear immediately');
  if (await input.inputValue()) throw new Error('Accepted draft was not cleared');
  await page.getByRole('button', {name: 'Stop team'}).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.group-terminal')].some(node => node.textContent.includes('Cancelled')));
  const cancelled = await page.locator('.group-terminal').allTextContents();
  const ids = await page.locator('article[data-entry-id]').evaluateAll(nodes => nodes.map(node => node.dataset.entryId));
  await page.reload(); await input.waitFor();
  await page.waitForFunction(expected => document.querySelectorAll('article[data-entry-id]').length === expected, count);
  const reloaded = await page.locator('article[data-entry-id]').evaluateAll(nodes => nodes.map(node => node.dataset.entryId));
  if (JSON.stringify(ids) !== JSON.stringify(reloaded)) throw new Error('Reload changed reserved order');
  return {count, cancelled, reloaded};
}
