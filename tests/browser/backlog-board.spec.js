import { test, expect } from '@playwright/test';
import { appFixture, swipeRight } from './fixture.js';

const day = offset => new Date(Date.now() - offset * 86400000).toISOString();
const task = (id, text, extra = {}) => ({ id, text, created: day(3), done_at: null, ...extra });

async function openBacklog(page, tasks, width = 390) {
  const app = await appFixture(page);
  app.profile.role = 'admin';
  app.backlog = { document: { tasks }, revision: 1 };
  await page.setViewportSize({ width, height: 844 });
  await app.open(); await app.ready();
  await page.locator('[data-view=backlog]').click();
  await expect(page.locator('.bl-folders')).toBeVisible();
  return app;
}
const saved = (app, id) => app.backlog.document.tasks.find(value => value.id === id);

test('folders list one-line rows with progress, tags and a preview', async ({ page }) => {
  await openBacklog(page, [
    task('a', 'Build the board #ui\n- [ ] first step', { lane: 'now', progress: { done: 2, total: 5 } }),
    task('b', 'Inbox item #idea'),
    task('c', 'Later item', { lane: 'later' }),
  ]);
  await expect(page.locator('.bl-folder.on')).toContainText('Now');
  const row = page.locator('.bl-row').first();
  await expect(row.locator('.bl-row-name')).toHaveText('Build the board');
  await expect(row.locator('.bl-tag')).toHaveText('#ui');
  await expect(row.locator('.bl-row-preview')).toHaveText('first step');
  await expect(row).toContainText('2/5');
  await page.getByRole('tab', { name: /Inbox/ }).click();
  await expect(page.locator('.bl-row')).toHaveCount(1);
  await expect(page.getByRole('tab', { name: /Later/ })).toContainText('1');
});

test('a row opens in the editor, saving changes the text and the plus starts a new task', async ({ page }) => {
  const app = await openBacklog(page, [task('a', 'Edit me #ui\nold body', { lane: 'now' })]);
  await page.locator('.bl-row').click();
  await expect(page.locator('.bl-list-pane')).toBeHidden();
  await expect(page.locator('[name=title]')).toHaveValue('Edit me #ui');
  await expect(page.locator('[name=body]')).toHaveValue('old body');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await page.locator('[name=title]').fill('Edited title #ui');
  await page.locator('[name=body]').fill('- [x] new body');
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await expect(page.locator('.bl-preview input[type=checkbox]')).toBeChecked();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => saved(app, 'a').text).toBe('Edited title #ui\n- [x] new body');
  await expect(page.locator('.bl-list-pane')).toBeVisible();
  await page.getByRole('button', { name: 'New task' }).click();
  await page.locator('[name=title]').fill('Brand new');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => app.backlog.document.tasks.length).toBe(2);
  expect(app.backlog.document.tasks[1].lane).toBe('now');
});

test('Cancel discards edits and swipe back keeps them', async ({ page }) => {
  const app = await openBacklog(page, [task('a', 'Keep me', { lane: 'now' })]);
  await page.locator('.bl-row').click();
  await page.locator('[name=title]').fill('Typed then cancelled');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.bl-list-pane')).toBeVisible();
  expect(saved(app, 'a').text).toBe('Keep me');
  await page.locator('.bl-row').click();
  await page.locator('[name=title]').fill('Typed then swiped');
  await swipeRight(page);
  await expect.poll(() => saved(app, 'a').text).toBe('Typed then swiped');
  await expect(page.locator('.bl-list-pane')).toBeVisible();
  await expect(page.locator('[data-view=backlog]')).toHaveClass(/active/);
});

test('lanes: Now holds three, a move follows the task, done goes to Done and Reopen returns it', async ({ page }) => {
  const app = await openBacklog(page, ['a', 'b', 'c', 'd'].map(id => task(id, `Task ${id}`, id === 'd' ? {} : { lane: 'now' })));
  await page.getByRole('tab', { name: /Inbox/ }).click();
  await page.locator('.bl-row').click();
  await page.getByRole('button', { name: 'Now', exact: true }).click();
  await expect(page.locator('.bl-message')).toContainText('Now is full');
  await page.getByRole('button', { name: 'Later', exact: true }).click();
  await expect.poll(() => saved(app, 'd').lane).toBe('later');
  await expect(page.getByRole('tab', { name: /Later/ })).toHaveClass(/on/);
  await page.locator('.bl-row').click();
  await page.getByRole('button', { name: 'Mark done' }).click();
  await expect.poll(() => saved(app, 'd').done_at).not.toBeNull();
  expect('lane' in saved(app, 'd')).toBe(false);
  await expect(page.getByRole('tab', { name: /Done/ })).toHaveClass(/on/);
  await page.locator('.bl-row').click();
  await page.getByRole('button', { name: 'Reopen' }).click();
  await expect.poll(() => saved(app, 'd').done_at).toBeNull();
  await expect(page.getByRole('tab', { name: /Inbox/ })).toHaveClass(/on/);
});

test('Done groups by week with older weeks folded, tags and search filter, delete confirms', async ({ page }) => {
  const app = await openBacklog(page, [
    task('w1', 'This week win #mobile', { done_at: day(0) }),
    task('w2', 'Last week win #mac', { done_at: day(8) }),
    task('w3', 'Third week win #mac', { done_at: day(15) }),
    task('x', 'Delete me', { lane: 'later' }),
  ]);
  await page.getByRole('tab', { name: /Done/ }).click();
  await expect(page.locator('.bl-week')).toHaveCount(3);
  await expect(page.locator('.bl-row')).toHaveCount(2);
  await page.locator('.bl-week').nth(2).click();
  await expect(page.locator('.bl-row')).toHaveCount(3);
  await page.getByRole('button', { name: '#mac', exact: true }).click();
  await expect(page.locator('.bl-row')).toHaveCount(2);
  await page.getByRole('button', { name: '#mac', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search tasks' }).fill('this week');
  await expect(page.locator('.bl-row')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Search tasks' }).fill('');
  await page.getByRole('tab', { name: /Later/ }).click();
  await page.locator('.bl-row').click();
  await page.getByRole('button', { name: 'Delete task' }).click();
  await page.getByRole('button', { name: 'Keep' }).click();
  expect(saved(app, 'x')).toBeTruthy();
  await page.getByRole('button', { name: 'Delete task' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => saved(app, 'x')).toBeUndefined();
});

test('a request task is read only but can be moved', async ({ page }) => {
  const app = await openBacklog(page, [task('r', 'Please add restaurants\nwould love it', { request_id: 'req-1', author_name: 'A member' })]);
  await page.getByRole('tab', { name: /Inbox/ }).click();
  await page.locator('.bl-row').click();
  await expect(page.locator('[name=title]')).toHaveCount(0);
  await expect(page.locator('.bl-title-read')).toHaveText('Please add restaurants');
  await expect(page.getByRole('button', { name: 'Delete task' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Later', exact: true }).click();
  await expect.poll(() => saved(app, 'r').lane).toBe('later');
});

test('wide screens show the list and the editor together', async ({ page }) => {
  await openBacklog(page, [task('a', 'First', { lane: 'now' }), task('b', 'Second', { lane: 'now' })], 1100);
  await expect(page.locator('.bl-list-pane')).toBeVisible();
  await expect(page.locator('.bl-detail-pane')).toContainText('No task open');
  await page.locator('.bl-row', { hasText: 'Second' }).click();
  await expect(page.locator('.bl-list-pane')).toBeVisible();
  await expect(page.locator('[name=title]')).toHaveValue('Second');
  await expect(page.locator('.bl-row.is-open')).toContainText('Second');
});

test('the board fits a narrow phone', async ({ page }) => {
  await openBacklog(page, [task('a', 'A fairly long task title that must wrap instead of spilling out of the screen #architecture #template', { lane: 'now', progress: { done: 1, total: 4 } })], 320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.bl-row').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
