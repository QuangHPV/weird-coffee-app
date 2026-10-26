import { test, expect } from '@playwright/test';
import { appFixture } from './fixture.js';

for (const role of ['admin', 'member']) {
  test(`${role} can archive and restore with accessible icons`, async ({ page }) => {
    const app = await appFixture(page);
    app.profile.role = role;
    await app.open(); await app.ready();
    const archive = page.getByRole('button', { name: 'Archive: Coffee 1', exact: true });
    await expect(archive.locator('svg')).toHaveCount(1);
    await expect(archive).toHaveText('');
    await archive.click();
    await expect.poll(() => app.archives).toEqual(['bean-0']);
    await expect(page.locator('#bean-list [data-bean-id="bean-0"]')).toHaveCount(0);
    await page.locator('#open-filters').click();
    await page.locator('#filter-archived').check();
    await page.locator('#filter-apply').click();
    const restore = page.getByRole('button', { name: 'Restore: Coffee 1', exact: true });
    await expect(restore.locator('svg')).toHaveCount(1);
    await restore.click();
    await expect.poll(() => app.archives).toEqual([]);
    await expect(page.locator('#bean-list [data-bean-id="bean-0"]')).toHaveCount(0);
  });
}

test('Activity lists runs simply and opens one run into its details', async ({ page }) => {
  const app = await appFixture(page);
  app.archives = ['bean-0'];
  app.activity = { sources: [
    { roaster: 'Test Roaster', last_ok: '2020-01-01T00:00:00Z', status: 'waiting', attempt: 2, next_try: '2099-01-01T10:00:00Z', history: ['ok', 'fail', 'fail'] },
    { roaster: 'Other Roaster', last_ok: new Date().toISOString(), status: 'ok', attempt: 0, history: ['ok', 'ok'] }] };
  app.runs = [
    { id: 3, started_at: new Date().toISOString(), source: 'scheduled', status: 'partial', scrape_status: 'partial', label_status: 'skipped', scrape_error: 'Test Roaster: HTTP Error 429', events: [],
      queue: [{ roaster: 'Test Roaster', status: 'waiting', reason: 'rate_limited', next_try: '2099-01-01T10:00:00Z', resolved: false }, { roaster: 'Other Roaster', status: 'ok', resolved: false }] },
    { id: 2, started_at: '2026-10-21T10:00:00Z', source: 'manual', status: 'success', scrape_status: 'success', roasters_done: 9, label_status: 'success', provider: 'claude', labeled_count: 11, model_batches: 2, checked_ids: ['bean-0', 'bean-1'], events: [{ event: 'new', bean_id: 'bean-0', roaster: 'Test Roaster', title: 'Coffee 1', url: 'https://shop.example.invalid/coffee' }, { event: 'new', roaster: 'Other Roaster', title: 'Other coffee' }] },
    { id: 1, started_at: '2026-10-20T10:00:00Z', source: 'scheduled', status: 'success', scrape_status: 'success', roasters_done: 9, label_status: 'skipped', events: [] },
  ];
  await app.open();
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.locator('#activity-sources')).toContainText('1 of 2 roasters out of date');
  await expect(page.locator('#activity-sources .src-row')).toHaveCount(2);
  await expect(page.locator('#activity-sources .src-row').first()).toContainText('Paused');
  await expect(page.locator('#activity-list')).not.toContainText('HTTP Error 429');
  await expect(page.locator('.activity-row')).toHaveCount(2);
  await expect(page.locator('.activity-row').nth(0)).toContainText('Incomplete');
  await expect(page.locator('.activity-row').nth(1)).toContainText('Manual · 1 new');
  await page.locator('.activity-row').nth(1).click();
  const detail = page.locator('#activity-detail');
  await expect(page.locator('#activity-main')).toBeHidden();
  await expect(detail).toContainText('11 listings labeled by Claude');
  await expect(detail).toContainText('Coffee 1');
  await expect(detail).not.toContainText('Other coffee');
  await expect(detail.locator('summary')).toHaveText('1 archived bean checked');
  await detail.locator('summary').click();
  await expect(detail).toContainText('Coffee 1');
  await detail.getByRole('button', { name: '‹ Activity' }).click();
  await expect(page.locator('#activity-main')).toBeVisible();
  await page.locator('.activity-row').nth(0).click();
  await expect(detail).toContainText('Not updated');
  await expect(detail).toContainText('Technical details');
  await page.goBack();
  await expect(page.locator('#activity-main')).toBeVisible();
  await page.locator('#important-scans').click();
  await expect(page.locator('.activity-row')).toHaveCount(3);
  await page.reload();
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.locator('.activity-row')).toHaveCount(3);
});

test('Activity shows active refresh progress at narrow widths', async ({ page }) => {
  const app = await appFixture(page);
  app.runs = [{ id: 4, started_at: '2026-10-22T10:00:00Z', source: 'recovery', status: 'running', scrape_status: 'running', roasters_done: 2, roasters_total: 9, current_roaster: 'Test Roaster', label_status: 'running', provider: 'claude', selected_count: 20, labeled_count: 10, batch_index: 2, batch_total: 2, events: [] }];
  await page.setViewportSize({ width: 320, height: 740 });
  await app.open(); await app.ready();
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.locator('#activity-live')).toContainText('Refreshing now, 2 of 9 roasters checked');
  await page.locator('.activity-row').click();
  await expect(page.locator('#activity-detail')).toContainText('Scraping 2 of 9 roasters — Test Roaster');
  await expect(page.locator('#activity-detail')).toContainText('Processing 10 of 20 listings with Claude — batch 2 of 2');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/coffee-backlog-activity-light.png', fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: '/tmp/coffee-backlog-activity-dark.png', fullPage: true });
});

test('beans from an out-of-date source are marked and the Wish list slider hides them by level', async ({ page }) => {
  const app = await appFixture(page);
  app.activity = { sources: [{ roaster: 'Test Roaster', last_ok: '2020-01-01T00:00:00Z', status: 'ok', attempt: 0, history: ['ok'] }] };
  await app.open(); await app.ready();
  await expect(page.locator('#browse-health')).toContainText('1 of 1 roasters out of date');
  await expect(page.locator('.bean-card.stale-source .stale-badge').first()).toContainText('Roaster out of date');
  await page.locator('#open-filters').click();
  await page.locator('#filter-trusted').check();
  await page.locator('#filter-apply').click();
  await expect(page.locator('#bean-list .bean-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Wish list', exact: true }).click();
  await page.locator('#wish-level').fill('0');
  await expect(page.locator('#wish-ticks button.on')).toHaveCount(1);
});
