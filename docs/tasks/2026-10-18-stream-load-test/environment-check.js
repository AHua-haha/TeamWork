async page => ({
  url: page.url(),
  pageScripts: await page.evaluate(() => [...document.scripts].map(s => s.src).filter(Boolean)),
  completedResponses: await page.locator('.group-final').count(),
  sourceCommit: '475542a8ce4048d47f10d77d8e5cdd32ebf48951'
})
