import { test, expect } from '@playwright/test';
import { appFixture } from './fixture.js';

const day = offset => new Date(Date.now() - offset * 86400000).toISOString();
const task = (id, text, extra = {}) => ({ id, text, created: day(3), done_at: null, ...extra });

async function openBoard(page, tasks) {
  const app = await appFixture(page);
  app.profile.role = 'admin';
  app.backlog = { document: { tasks }, revision: 1 };
  await app.open(); await app.ready();
  await page.locator('[data-view=backlog]').click();
  await expect(page.locator('.backlog-tabs')).toBeVisible();
  return app;
}

test('Board shows Now with progress, Inbox rows and a collapsed Later', async ({ page }) => {
  await openBoard(page, [
    task('a', 'Build the board #ui\nPlan: plans/a.md', { lane: 'now', progress: { done: 2, total: 5 } }),
    task('b', 'Inbox item #idea'),
    task('c', 'Later item', { lane: 'later' }),
  ]);
  const now = page.locator('.backlog-lane.lane-now');
  await expect(now.locator('.backlog-label')).toContainText('1 of 3');
  await expect(now.locator('.backlog-progress')).toContainText('2/5');
  await expect(page.locator('.backlog-lane.lane-inbox .backlog-task')).toHaveCount(1);
  await expect(page.locator('.backlog-lane.lane-later .backlog-task')).toHaveCount(0);
  await page.locator('.backlog-fold').click();
  await expect(page.locator('.backlog-lane.lane-later .backlog-task')).toHaveCount(1);
});

test('tasks move between lanes, Now holds three, and a move is saved', async ({ page }) => {
  const app = await openBoard(page, ['a', 'b', 'c', 'd'].map(id => task(id, `Task ${id}`, id === 'd' ? {} : { lane: 'now' })));
  await page.getByRole('button', { name: 'Move to Now: Task d' }).click();
  await expect(page.locator('.backlog-message')).toContainText('Now is full');
  await page.getByRole('button', { name: 'Move to Later: Task a' }).click();
  await expect.poll(() => app.backlog.document.tasks.find(value => value.id === 'a').lane).toBe('later');
  await page.getByRole('button', { name: 'Move to Now: Task d' }).click();
  await expect.poll(() => app.backlog.document.tasks.find(value => value.id === 'd').lane).toBe('now');
  await page.getByRole('button', { name: 'Move to Inbox: Task d' }).click();
  await expect.poll(() => 'lane' in app.backlog.document.tasks.find(value => value.id === 'd')).toBe(false);
});

test('completing moves a task to the Log by week and Reopen puts it back in Inbox', async ({ page }) => {
  const app = await openBoard(page, [
    task('a', 'Ship it #mobile', { lane: 'now' }),
    task('old', 'Old win #mac\nWhat happened', { done_at: day(20) }),
  ]);
  await page.getByRole('checkbox', { name: 'Complete: Ship it #mobile' }).click();
  await expect.poll(() => app.backlog.document.tasks.find(value => value.id === 'a').done_at).not.toBeNull();
  expect('lane' in app.backlog.document.tasks.find(value => value.id === 'a')).toBe(false);
  await page.getByRole('tab', { name: /Log/ }).click();
  await expect(page.locator('.backlog-week')).toHaveCount(2);
  await expect(page.locator('.backlog-week').first().locator('.backlog-label')).toContainText('This week');
  await page.getByRole('button', { name: '#mac', exact: true }).click();
  await expect(page.locator('.backlog-entry')).toHaveCount(1);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.locator('.backlog-entry', { hasText: 'Old win' }).locator('.backlog-entry-head').click();
  await expect(page.locator('.backlog-entry-body')).toContainText('What happened');
  await page.getByRole('button', { name: 'Reopen' }).click();
  await expect.poll(() => app.backlog.document.tasks.find(value => value.id === 'old').done_at).toBeNull();
  await page.getByRole('tab', { name: /Board/ }).click();
  await expect(page.locator('.backlog-lane.lane-inbox')).toContainText('Old win');
});

test('one tap on a task edits it in place and the board fits a narrow phone', async ({ page }) => {
  const app = await openBoard(page, [task('a', 'Edit me', { lane: 'now' })]);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.locator('.backlog-title', { hasText: 'Edit me' }).click();
  await page.locator('textarea[name=edit]').fill('Edited title');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => app.backlog.document.tasks[0].text).toBe('Edited title');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
