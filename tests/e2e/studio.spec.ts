import { expect, test } from "@playwright/test";
import { seedIds } from "./ids";

test.describe("studio pages", () => {
  test("dashboard shows stats, setup checklist and recent stories", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Completed MP4s")).toBeVisible();
    await expect(page.getByText("Finish setup to run the production pipeline")).toBeVisible();
    await expect(page.getByText("How Crayons Are Made").first()).toBeVisible();
  });

  test("a new script waits for review before any media is made", async ({ page }) => {
    const { scriptedEpisodeId } = seedIds();
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Scripts to review (1)" })).toBeVisible();
    await page.getByText("Oil and lye are mixed", { exact: false }).click();
    await expect(page).toHaveURL(new RegExp(`/episodes/${scriptedEpisodeId}`));
    await expect(page.getByText("Script ready for your review")).toBeVisible();
    await expect(page.getByText("Script to review")).toBeVisible();
    // The checks left one issue open: approving would be an explicit override.
    await expect(page.getByText("Needs your attention")).toBeVisible();
    await expect(page.getByText("The research doesn't say the oil is heated to 200 degrees.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve anyway & make video" }).first()).toBeVisible();
    // The producer judges the issue wrong and dismisses it; the script passes.
    await page.getByRole("button", { name: "Not a problem" }).click();
    await page.getByLabel("Why it's fine (optional)").fill("Source 2 gives the temperature.");
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

  test("make videos: pick a channel, then give a product or be surprised", async ({ page }) => {
    await page.goto("/generate");
    await expect(page.getByRole("heading", { name: "Make videos" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /How It's Made/ })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByLabel("Which product?")).toBeVisible();
    await expect(page.getByRole("button", { name: "Pitch this idea" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Surprise me" })).toBeEnabled();
    await page.getByRole("button", { name: "Crayons" }).click();
    await expect(page.getByRole("button", { name: "Pitch this idea" })).toBeEnabled();
    await expect(page.getByText("researched on the web")).toBeVisible();
    await page.getByRole("radio", { name: /How Toys Are Made/ }).click();
    await expect(page.getByLabel("Which product?")).toBeVisible();
  });

  test("channels: list and edit the profile", async ({ page }) => {
    await page.goto("/channels");
    await expect(page.getByRole("heading", { name: "Channels", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Set up channel" })).toBeDisabled();
    await page.getByRole("link", { name: "How It's Made", exact: true }).click();
    await expect(page.getByRole("heading", { name: "How It's Made" })).toBeVisible();
    await expect(page.getByLabel("Voice")).toHaveValue("Plain and factual.");
    await expect(page.getByRole("button", { name: "Save channel" })).toBeVisible();
  });

  test("story library filters and searches", async ({ page }) => {
    await page.goto("/stories");
    await expect(page.getByText("How Pencils Are Made")).toBeVisible();
    await page.getByRole("link", { name: "Concepts", exact: true }).click();
    await expect(page).toHaveURL(/filter=concepts/);
    await expect(page.getByText("How Crayons Are Made")).toHaveCount(0);
    await page.goto("/stories");
    await page.getByPlaceholder("Search title, premise, keyword").fill("crayons");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByText("How Crayons Are Made")).toBeVisible();
    await expect(page.getByText("How Pencils Are Made")).toHaveCount(0);
  });

  test("story library archives several stories at once, and restores them", async ({ page }) => {
    const traffic = "How Pencils Are Made";
    await page.goto("/stories");
    await page.getByRole("checkbox", { name: `Select ${traffic}` }).click();
    // While selecting, clicking a card selects it instead of opening it.
    await page.getByText("How Crayons Are Made").click();
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

  test("story details shows the research and episodes, and approval locks an episode", async ({ page }) => {
    const { storyId } = seedIds();
    await page.goto(`/stories/${storyId}`);
    await expect(page.getByRole("heading", { name: "Research" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Story bible" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Generate Next Episode" })).toHaveCount(0);
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("alertdialog").or(page.getByRole("dialog"))).toContainText("Approval locks this script version.");
    await page.getByRole("button", { name: "Approve" }).last().click();
    await expect(page.getByText("Episode approved")).toBeVisible();
  });

  test("script quality page summarises checked scripts", async ({ page }) => {
    await page.goto("/quality");
    await expect(page.getByRole("heading", { name: "Script Quality" })).toBeVisible();
    await expect(page.getByText("Scripts checked")).toBeVisible();
    await expect(page.getByRole("link", { name: "How Bar Soap Is Made" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "By product" })).toBeVisible();
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

  test("topic research shows the library with dated, honest evidence and scored proposals", async ({ page }) => {
    await page.goto("/topics");
    await expect(page.getByRole("heading", { name: "Topic research" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Flip-flop factory tour/ })).toBeVisible();
    await expect(page.getByText(/4\.0M views over 12 months .*observed 2026-10-01, entered by hand, unverified/)).toBeVisible();
    await expect(page.getByText("No audience numbers recorded")).toBeVisible();
    await expect(page.getByText("Needs source URL")).toBeVisible();
    await expect(page.getByText("How Glass Marbles Are Made")).toBeVisible();
    await expect(page.getByText("No audience evidence", { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/No comparable video in the reference library/).first()).toBeVisible();
    await expect(page.getByText("/100 opportunity estimate")).toBeVisible();
    await page.getByLabel("Audience traction").selectOption("unknown");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByText("Ice cream sandwiches").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Flip-flop factory tour/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Add reference" }).click();
    await expect(page.getByRole("dialog")).toContainText("Blank numbers stay unknown");
  });

  test("a script under review shows how it's told, its openings and the overrides", async ({ page }) => {
    const { scriptedEpisodeId } = seedIds();
    await page.goto(`/episodes/${scriptedEpisodeId}`);
    await expect(page.getByRole("heading", { name: "How it's told" })).toBeVisible();
    await expect(page.getByText("Factory reveal", { exact: true })).toBeVisible();
    await expect(page.getByText("The research describes a continuous line from vat to wrapped bar.")).toBeVisible();
    await expect(page.getByText("“Every bar of soap starts as a vat of oil.”")).toBeVisible();
    await expect(page.getByRole("button", { name: "Use this opening" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Switch pattern" })).toBeVisible();
    await page.getByRole("button", { name: "Use this opening" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("The research, plan and other parts are unchanged");
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
});
