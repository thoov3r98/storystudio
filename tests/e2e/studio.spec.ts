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

  test("a new script waits for review before any media is made", async ({ page }) => {
    const { scriptedEpisodeId } = seedIds();
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Scripts to review (1)" })).toBeVisible();
    await page.getByText("The chairlift stops with Ridge on it", { exact: false }).click();
    await expect(page).toHaveURL(new RegExp(`/episodes/${scriptedEpisodeId}`));
    await expect(page.getByText("Script ready for your review")).toBeVisible();
    await expect(page.getByText("Script to review")).toBeVisible();
    // The checks left one issue open: approving would be an explicit override.
    await expect(page.getByText("Needs your attention")).toBeVisible();
    await expect(page.getByText("Ridge waves the patrol away for no clear reason.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve anyway & make video" }).first()).toBeVisible();
    // The producer judges the issue wrong and dismisses it; the script passes.
    await page.getByRole("button", { name: "Not a problem" }).click();
    await page.getByLabel("Why it's fine (optional)").fill("He thinks they are leaving; it's in scene 1.");
    await page.getByRole("button", { name: "Dismiss issue" }).click();
    await expect(page.getByText("dismissed by you")).toBeVisible();
    await expect(page.getByText("Passed", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Approve script & make video" }).first().click();
    await expect(page.getByRole("alertdialog")).toContainText(/illustrations, narration, captions and edit.*Estimated \$/);
    await page.getByRole("button", { name: "Cancel" }).click();
    // Rewrites stop at the script too: there is no "make a new MP4" switch yet.
    await page.getByRole("button", { name: "Rewrite opening" }).click();
    await expect(page.getByRole("dialog")).toContainText("Nothing is spent on media until you approve the script.");
    await expect(page.getByRole("switch")).toHaveCount(0);
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

  test("story library archives several stories at once, and restores them", async ({ page }) => {
    const traffic = "What Happens If Every Traffic Light Turns Green?";
    await page.goto("/stories");
    await page.getByRole("checkbox", { name: `Select ${traffic}` }).click();
    // While selecting, clicking a card selects it instead of opening it.
    await page.getByText("Where Does Your Lost Luggage Actually Go?").click();
    await expect(page).toHaveURL(/\/stories$/);
    await expect(page.getByText("2 selected")).toBeVisible();
    await page.getByRole("button", { name: "Clear" }).click();
    await page.getByRole("checkbox", { name: `Select ${traffic}` }).click();
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(page.getByText("Archived 1 story")).toBeVisible();
    await expect(page.getByText(traffic)).toHaveCount(0);

    await page.goto("/stories?filter=archived");
    await page.getByRole("checkbox", { name: `Select ${traffic}` }).click();
    await page.getByRole("button", { name: "Unarchive" }).click();
    await expect(page.getByText(traffic)).toHaveCount(0);
    await page.goto("/stories");
    await expect(page.getByText(traffic)).toBeVisible();
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

  test("story quality page summarises checked scripts and manages reference stories", async ({ page }) => {
    await page.goto("/quality");
    await expect(page.getByRole("heading", { name: "Story Quality" })).toBeVisible();
    await expect(page.getByText("Scripts checked")).toBeVisible();
    await expect(page.getByRole("link", { name: "Stuck on the Last Chairlift" })).toBeVisible();
    await page.getByRole("link", { name: "Reference stories" }).click();
    await expect(page.getByText("The Last Bus (original example)")).toBeVisible();
    await page.getByLabel("Title").fill("My own survival script");
    await page.getByLabel("Script or transcript").fill("A climber's rope snags on a ledge as the light goes, and she remembers the knot her father taught her on the first page of this story.");
    await page.getByRole("button", { name: "Add reference" }).click();
    await expect(page.getByText("Reference added")).toBeVisible();
    await expect(page.getByText("Your references (1)")).toBeVisible();
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
