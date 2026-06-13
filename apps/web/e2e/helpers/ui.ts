import { expect, type Page } from '@playwright/test';

/**
 * Selects an option from a form-kit Combobox (Popover + cmdk).
 * The trigger carries data-testid="combobox-<fieldName>".
 */
export async function pickCombobox(page: Page, testId: string, optionText: string): Promise<void> {
  await page.getByTestId(testId).click();
  const input = page.locator('[cmdk-input]');
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill(optionText);
  await page.getByRole('option').filter({ hasText: optionText }).first().click();
}
