async (page) => {
  const result = await page.evaluate(() => {
    const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,width:r.width}; };
    const pane=rect('.group-conversation'); const body=rect('.group-member-body');
    const avatar=rect('.group-member-avatar'); const user=rect('.group-user-body');
    const userAvatar=rect('.group-user-avatar'); const composer=rect('.group-composer-footer .composer');
    return {viewport:innerWidth,pane,body,avatar,user,userAvatar,composer,overflow:document.documentElement.scrollWidth>innerWidth,avatarInsideBody:!!document.querySelector('.group-member-body .group-avatar')};
  });
  if (result.body.width>801 || Math.abs(result.body.left-result.composer.left)>1 || Math.abs(result.body.right-result.composer.right)>1) throw new Error('Response/composer width or alignment mismatch: '+JSON.stringify(result));
  if (Math.abs((result.body.left+result.body.right)/2-(result.pane.left+result.pane.right)/2)>1) throw new Error('Response column is not centered');
  if (result.avatar.right+7>result.body.left || result.userAvatar.left<result.user.right+7 || result.avatarInsideBody) throw new Error('Avatars are not outside the message area');
  if (result.overflow) throw new Error('Horizontal page overflow');
  if (result.pane.width>=920 && Math.abs(result.body.width-800)>1) throw new Error('Wide response does not use 800px cap');
  await page.screenshot({path:`output/playwright/reading-layout-${result.viewport}-${Math.round(result.pane.width)}.png`});
  return result;
}
