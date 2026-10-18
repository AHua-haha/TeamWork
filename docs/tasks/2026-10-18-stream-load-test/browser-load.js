async page => {
  const results = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole('textbox', { name: 'Message the team', exact: true }).waitFor();
  for (const spec of [
    { label: 'ui-visible-normal', duration: 20, rate: 45, chunkSize: 16, workers: 1 },
    { label: 'ui-folded-normal', duration: 20, rate: 45, chunkSize: 16, workers: 1 },
    { label: 'ui-visible-large-fast', duration: 15, rate: 100, chunkSize: 32, workers: 1 },
    { label: 'ui-four-parallel', duration: 15, rate: 45, chunkSize: 16, workers: 4 },
  ]) {
    await page.evaluate(() => {
      const state = { frames: [], longTasks: [], last: performance.now(), begin: Date.now(), handle: 0 };
      const frame = now => { state.frames.push(now - state.last); state.last = now; state.handle = requestAnimationFrame(frame); };
      state.handle = requestAnimationFrame(frame);
      const observer = new PerformanceObserver(list => state.longTasks.push(...list.getEntries().map(e => e.duration)));
      observer.observe({ type: 'longtask', buffered: false });
      window.__loadMeter = { state, observer };
    });
    const ack = await page.evaluate(async spec => (await fetch('/workspaces/load/start', { method: 'POST', body: JSON.stringify(spec) })).json(), spec);
    if (ack.runs?.length !== spec.workers) throw new Error('Member admission mismatch');
    await page.locator('.group-work:visible .work-text').first().waitFor();
    if (spec.label.includes('folded')) await page.getByRole('button', { name: 'Lead: Hide working history', exact: true }).click();
    const measured = await page.evaluate(async () => (await fetch('/workspaces/load/result')).json());
    await page.waitForFunction(count => document.querySelectorAll('.group-final').length === count, spec.workers);
    const browser = await page.evaluate(() => {
      const { state, observer } = window.__loadMeter;
      state.longTasks.push(...observer.takeRecords().map(e => e.duration)); observer.disconnect(); cancelAnimationFrame(state.handle);
      const percentile = (array, p) => { const sorted = array.toSorted((a,b) => a-b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]; };
      return { beganAt: state.begin, endedAt: Date.now(), frameCount: state.frames.length, frameGapP95Ms: percentile(state.frames, .95), longestFrameGapMs: Math.max(...state.frames), framesOver50Ms: state.frames.filter(v => v > 50).length, longTasks: state.longTasks.length, longTaskTotalMs: state.longTasks.reduce((a,b)=>a+b,0), longestTaskMs: state.longTasks.length ? Math.max(...state.longTasks) : 0, domElements: document.querySelectorAll('*').length };
    });
    const generatedEvents = Object.values(measured.ticks).reduce((n, list) => n + list.length, 0); delete measured.ticks;
    if (generatedEvents !== spec.duration * spec.rate * spec.workers) throw new Error('Generated event count mismatch');
    if (measured.progress.some(member => member.retainedEvents > 1024)) throw new Error('FIFO capacity exceeded');
    results.push({ ...measured, generatedEvents, browser });
    await page.screenshot({ path: `output/playwright/${spec.label}.png` });
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return results;
}
