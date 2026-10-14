async (page) => {
  const header = page.locator('.group-run-header').first();
  if (await header.getAttribute('aria-expanded') === 'true') await header.click();
  await header.click({position:{x:14,y:16}});
  await page.locator('.group-work').first().waitFor();
  const control = await header.getAttribute('aria-controls');
  if (await page.locator(`#${control}`).count() !== 1) throw new Error('Header does not control its work section');
  if ((await page.locator('.group-work').first().textContent()).includes('Group chat implementation')) throw new Error('Final text repeated in work');
  await header.focus(); await header.press('Enter');
  if (await header.getAttribute('aria-expanded') !== 'false') throw new Error('Enter did not collapse work');
  await header.press('Space');
  if (await header.getAttribute('aria-expanded') !== 'true') throw new Error('Space did not expand work');
  if (!await page.getByRole('heading',{name:'Group chat implementation', exact:true}).isVisible()) throw new Error('Final response disappeared');
  await header.click();
  await header.evaluate(element => element.blur());
  const layout = await page.evaluate(() => {
    const rect = selector => {const r=document.querySelector(selector).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width};};
    const bar=document.querySelector('.group-run-header');
    return {viewport:innerWidth,body:rect('.group-member-body'),avatar:rect('.group-member-identity .group-avatar'),name:rect('.group-member-name'),header:rect('.group-run-header'),composer:rect('.group-composer-footer .composer'),color:getComputedStyle(bar).color,background:getComputedStyle(bar).backgroundColor,start:bar.querySelector('time').dateTime,status:bar.querySelector('.run-header-status').textContent,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  if (layout.name.top<layout.avatar.bottom || layout.name.right>layout.body.left || layout.body.width>801) throw new Error('Identity is not beneath/outside avatar or reading width changed');
  if (Math.abs(layout.body.left-layout.header.left)>1 || Math.abs(layout.body.right-layout.header.right)>1 || Math.abs(layout.body.left-layout.composer.left)>1) throw new Error('Run header/composer alignment mismatch');
  if (layout.overflow || !layout.start || layout.status!=='Completed' || layout.background==='rgba(0, 0, 0, 0)') throw new Error('Missing run metadata/color or page overflow');
  await page.screenshot({path:`output/playwright/run-headers-${layout.viewport}.png`});
  return layout;
}
