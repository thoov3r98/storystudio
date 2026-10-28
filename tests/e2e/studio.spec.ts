import { expect, test } from "@playwright/test";
import { seedIds } from "./ids";

test.describe("studio pages", () => {
  test("dashboard shows stats, setup checklist and recent stories", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Completed MP4s")).toBeVisible();
    await expect(page.getByText("Finish setup to run the production pipeline")).toBeVisible();
    await expect(page.getByText("Where Does Your Lost Luggage Actually Go?").first()).toBeVisible();
  });

  test("generate form updates the cost estimate", async ({ page }) => {
    await page.goto("/generate");
    await expect(page.getByRole("heading", { name: "Generate opening episodes" })).toBeVisible();
    const total = page.locator("aside").getByText(/^≈ \$/).first();
    const conceptCost = await total.textContent();
    await page.getByRole("radio", { name: /Full production/ }).click();
    await expect(total).not.toHaveText(conceptCost ?? "");
    await expect(page.getByText("Episodes the budget covers")).toBeVisible();
    // "Your own topic" is the default and needs a prompt before a batch can start.
    await expect(page.getByRole("button", { name: "Start production batch" })).toBeDisabled();
    await page.getByLabel("What should these videos be about?").fill("Strange true stories from ancient Rome");
    await expect(page.getByRole("button", { name: "Start production batch" })).toBeEnabled();
  });

  test("story library filters and searches", async ({ page }) => {
    await page.goto("/stories");
    await expect(page.getByText("What Happens If Every Traffic Light Turns Green?")).toBeVisible();
    await page.getByRole("link", { name: "Concepts", exact: true }).click();
    await expect(page).toHaveURL(/filter=concepts/);
    await expect(page.getByText("Where Does Your Lost Luggage Actually Go?")).toHaveCount(0);
    await page.goto("/stories");
    await page.getByPlaceholder("Search title, premise, keyword").fill("luggage");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByText("Where Does Your Lost Luggage Actually Go?")).toBeVisible();
    await expect(page.getByText("What Happens If Every Traffic Light Turns Green?")).toHaveCount(0);
  });

  test("story details shows bible, episodes and blocks continuation until approval", async ({ page }) => {
    const { storyId } = seedIds();
    await page.goto(`/stories/${storyId}`);
    await expect(page.getByRole("heading", { name: "Story bible" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Proposed continuity updates" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Generate Next Episode" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
  });

  test("approving an episode applies continuity and unlocks the next episode", async ({ page }) => {
    const { storyId } = seedIds();
    await page.goto(`/stories/${storyId}`);
    await page.getByRole("button", { name: "Approve" }).click();
    await page.getByRole("button", { name: "Approve and apply" }).click();
    await expect(page.getByText("Episode approved")).toBeVisible();
    await expect(page.getByRole("button", { name: "Generate Next Episode" })).toBeEnabled();
    await expect(page.getByText("Open question from part 1")).toBeVisible();
    await expect(page.getByText(/Canonical v2/)).toBeVisible();
  });

  test("episode details shows script and scenes, with no hooks panel or fact review", async ({ page }) => {
    const { episodeId } = seedIds();
    await page.goto(`/episodes/${episodeId}`);
    await expect(page.getByText("Opening", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Rewrite opening" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Scene timeline \(12\)/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Opening hooks" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Fact review" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Regenerate image" }).first()).toBeVisible();
  });

  test("jobs page shows failures with error details and retry", async ({ page }) => {
    await page.goto("/jobs");
    await expect(page.getByText("TRIGGER_SECRET_KEY is not configured.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await page.getByRole("link", { name: "Active", exact: true }).click();
    await expect(page.getByText("No jobs")).toBeVisible();
  });

  test("settings shows voices and pricing", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Narrator voices" })).toBeVisible();
    await expect(page.locator('input[value="Test Narrator"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "Models & pricing" })).toBeVisible();
  });

  test("characters: list, edit page and making videos starring them", async ({ page }) => {
    await page.goto("/characters");
    await expect(page.getByRole("heading", { name: "Characters", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Design character" })).toBeDisabled();
    await page.getByRole("link", { name: /Test Dave/ }).click();
    await expect(page.getByRole("heading", { name: "Test Dave" })).toBeVisible();
    await expect(page.getByLabel("Name")).toHaveValue("Test Dave");
    await expect(page.getByRole("button", { name: "Draw character" })).toBeVisible();
    await page.getByRole("link", { name: "Make videos with Test Dave" }).click();
    await expect(page).toHaveURL(/\/generate\?character=/);
    // Client navigation can leave a hidden copy of the previous render in the DOM; match the visible one.
    await expect(page.getByText("Starring", { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByText("Test Dave", { exact: true }).filter({ visible: true })).toBeVisible();
  });
});
