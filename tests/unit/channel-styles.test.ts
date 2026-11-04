import { describe, expect, it } from "vitest";
import { splitPrompt, storyboardPrompt } from "@/lib/ai/storyboard-prompts";
import { postCopyPrompt } from "@/lib/ai/post-prompts";
import { CHANNEL_STYLES, channelStyle } from "@/lib/ai/channel-styles";
import { SOUND_EFFECTS } from "@/lib/constants";
import { parseProfile, type ChannelFormat } from "@/lib/schemas/channel";

const channel = (format: ChannelFormat, visuals = "") => ({ name: "C", format, profile: { visuals } });
const base = { part: 1, parts: 1, narration: "You take a sip. It reaches your brain.", durationSec: 45, fullScript: "x", visualNotes: null, seriesVisualState: null };

describe("channel styles", () => {
  it("storyboards each style its own way, with the channel's own rules on top", () => {
    const invisible = storyboardPrompt({ ...base, channel: channel("INVISIBLE_EXPLAINER", "Always show the glowing subject.") }).system;
    expect(invisible).toContain("cutaway");
    expect(invisible).toContain("THIS CHANNEL'S STORYBOARD RULES");
    expect(invisible).toContain("Always show the glowing subject.");
    expect(invisible).toMatch(/heartbeat \(heartbeat\)/);
    expect(invisible).not.toMatch(/press \(press\)/);
    expect(invisible).toContain("a short question is allowed");
    expect(invisible).toContain("dive-in");

    const factory = storyboardPrompt({ ...base, channel: channel("PROCESS_EXPLAINER") }).system;
    expect(factory).toContain("The material is the star");
    expect(factory).not.toContain("STORYBOARD RULES");
    expect(factory).toContain("a statement, never a question");
    expect(factory).not.toContain("dive-in");
  });

  it("never lets the storyboard change the producer's words", () => {
    const p = storyboardPrompt({ ...base, channel: channel("PROCESS_EXPLAINER") });
    expect(p.system).toContain("Do not rewrite, add, fix or drop anything");
    expect(p.user).toContain(base.narration);
    expect(p.user).not.toContain("WHOLE SCRIPT");
  });

  it("gives later parts the whole script, the series' look and the producer's notes", () => {
    const look = { setting: "s", timeAndLight: "t", weather: "w", heroSituation: "h", heroLook: "blue overalls", rules: [] };
    const p = storyboardPrompt({ ...base, part: 2, parts: 3, fullScript: "The whole script.", visualNotes: "Keep it at night.", seriesVisualState: look, channel: channel("PROCESS_EXPLAINER") });
    expect(p.user).toContain("WHOLE SCRIPT (context only; storyboard just Part 2)");
    expect(p.user).toContain("The whole script.");
    expect(p.user).toContain("blue overalls");
    expect(p.system).toContain("Keep it at night.");
    expect(p.system).toContain("Part 2 of 3");
  });

  it("numbers sentences for the split", () => {
    const p = splitPrompt({ channel: channel("PROCESS_EXPLAINER"), sentences: ["One.", "Two.", "Three."], parts: 2 });
    expect(p.user).toContain("SCRIPT (3 sentences)\n1. One.\n2. Two.\n3. Three.");
    expect(p.system).toContain("into 2 consecutive");
  });

  it("post text takes its facts from the narration only", () => {
    const p = postCopyPrompt({ channel: channel("PROCESS_EXPLAINER"), seriesTitle: "S", part: 1, parts: 2, narration: "n", onScreenHook: null, scenes: [] });
    expect(p.system).toContain("isn't in the narration");
    expect(p.system).toContain("Part 2");
    expect(p.user).not.toContain("RESEARCH");
  });

  it("every style's sounds exist and each has its own music bed", () => {
    for (const style of Object.values(CHANNEL_STYLES)) for (const k of style.soundEffects) expect(SOUND_EFFECTS[k]).toBeDefined();
    const keys = Object.values(CHANNEL_STYLES).map((s) => s.music.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(channelStyle("unknown").kind).toBe(CHANNEL_STYLES.PROCESS_EXPLAINER.kind);
  });

  it("reads profiles saved with the old writing rules, keeping only the storyboard rules", () => {
    expect(parseProfile({ summary: "s", voice: "v", avoid: [], visuals: "Big machines." })).toEqual({ visuals: "Big machines." });
    expect(parseProfile({ summary: "s" }).visuals).toBe("");
    expect(parseProfile(null).visuals).toBe("");
  });
});
