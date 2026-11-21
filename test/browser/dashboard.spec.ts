import { expect, test } from '@playwright/test';
import { reportSchema } from '../../src/model.ts';
import { agentTaskSchema } from '../../src/task.ts';

test('shows six real scenario classifications and saved verification history', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Migration evidence' })).toBeVisible();
  const inventory = page.getByRole('region', { name: 'Migration inventory' });
  await expect(inventory.getByRole('row')).toHaveCount(7);
  await expect(inventory.getByRole('row', { name: /Irreversible column drop/ })).toContainText('critical');
  await expect(inventory.getByRole('link', { name: /View evidence for/ })).toHaveCount(6);
  const history = page.getByRole('region', { name: 'Rehearsal history' });
  await expect(history.getByRole('row', { name: /Breaking column rename/ }).first()).toContainText('Verified');
  await expect(history.getByRole('row', { name: /Irreversible column drop/ }).first()).toContainText('Export task');
  await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true });
});

test('drills into the real legacy-query failure and downloads the report and task', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'View evidence for Breaking column rename' }).click();
  await expect(page.getByRole('heading', { name: 'Breaking column rename' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Confirmed failures' })).toContainText('42703');
  const proposed = page.getByRole('region', { name: 'Proposed migration' });
  await expect(proposed.getByText('DDL committed')).toBeVisible();
  await proposed.getByText('Existing customer lookup').last().click();
  await expect(proposed.locator('details[open]').getByText('SELECT display_name FROM customers WHERE id = 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Correction rehearsal' })).toContainText('Existing write propagates to new readers');

  const reportUrl = (await page.getByRole('link', { name: 'Download report' }).getAttribute('href'))!;
  const reportResponse = await request.get(reportUrl);
  expect(reportResponse.headers()['content-disposition']).toContain('attachment');
  const report = reportSchema.parse(await reportResponse.json());
  expect(report.proposed.after.compatibility[0]?.execution.sqlState).toBe('42703');

  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export engineering task' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(`migrateproof-task-${report.id}.json`);
  const taskResponse = await request.get((await page.getByRole('link', { name: 'Export engineering task' }).getAttribute('href'))!);
  expect(agentTaskSchema.parse(await taskResponse.json()).provenance.baselineSha256).toBe(report.source.baselineSha256);
});

test('shows measured performance plans and keeps human review visible', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'View evidence for Query performance regression' }).click();
  await expect(page.getByRole('heading', { name: 'Query performance regression' })).toBeVisible();
  await expect(page.getByText('Human review required', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Proposed migration' }).getByText('Seq Scan', { exact: true })).toBeVisible();
  const plan = page.getByRole('region', { name: 'Proposed migration' }).getByText('Query plan JSON').last();
  await plan.click();
  await expect(page.getByText(/"Node Type": "Seq Scan"/)).toBeVisible();
  await plan.click();
  await page.screenshot({ path: testInfo.outputPath('performance.png'), fullPage: true });
});

test('keeps review usable on narrow viewports and handles invalid IDs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 860 });
  await page.goto('/');
  await page.getByRole('link', { name: 'View rehearsal history' }).click();
  await expect(page.getByRole('heading', { name: 'Rehearsal history' })).toBeInViewport();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  const response = await page.goto('/rehearsals/invalid');
  expect(response?.status()).toBe(404);
});
