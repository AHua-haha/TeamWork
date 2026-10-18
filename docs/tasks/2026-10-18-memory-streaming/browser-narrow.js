async page => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.group-final').getByText('Streaming completes correctly.', { exact: true }).waitFor();
  const collapse = page.getByRole('button', { name: 'Collapse sidebar', exact: true });
  if (await collapse.isVisible()) await collapse.click();
  await page.screenshot({ path: 'output/playwright/memory-stream-mobile.png' });
  if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) throw new Error('Narrow page overflow');
  return { result: 'pass', checks: '390px reloaded durable group history visible with sidebar closed' };
}
