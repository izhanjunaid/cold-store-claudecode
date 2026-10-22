import { expect, type Page } from '@playwright/test';

/**
 * Selects an option from a form-kit Combobox (Popover + cmdk).
 * The trigger carries data-testid="combobox-<fieldName>".
 */
export async function pickCombobox(page: Page, testId: string, optionText: string): Promise<void> {
  await page.getByTestId(testId).click();
  // The search box of the popover just opened (the newest one in the DOM).
  const input = page.locator('[cmdk-input]').last();
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill(optionText);
  await page.getByRole('option').filter({ hasText: optionText }).first().click();
  // Let the popover close, so picking the next combobox finds only its own search box.
  await expect(page.locator('[cmdk-input]')).toHaveCount(0, { timeout: 5_000 });
}
