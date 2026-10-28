import { expect, test } from "@playwright/test";

test("navigation works on a phone-sized screen", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Story Library" }).click();
  await expect(page).toHaveURL(/\/stories/);
  await expect(page.getByRole("heading", { name: "Story Library" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
