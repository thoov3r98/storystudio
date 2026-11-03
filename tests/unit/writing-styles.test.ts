import { describe, expect, it } from "vitest";
import { processAuditPrompt, processBreakdownPrompt, processNarrationPrompt, questionAllowed } from "@/lib/ai/process-prompts";
import { channelDesignPrompt, pitchPickPrompt, pitchPrompt } from "@/lib/ai/channel-prompts";
import { WRITING_STYLES, writingStyle } from "@/lib/ai/writing-styles";
import { SOUND_EFFECTS } from "@/lib/constants";
import { parseProfile, type ChannelFormat } from "@/lib/schemas/channel";

const research = {
  product: "Coffee",
  overview: "o",
  mainRoute: "",
  uncertain: [],
  stages: [
    { id: "T1", name: "Swallowing", steps: [{ what: "You swallow.", details: "", sources: ["1"] }] },
    { id: "T2", name: "Into the blood", steps: [{ what: "Caffeine enters the blood.", details: "", sources: ["1"] }] },
    { id: "T3", name: "Reaching the brain", steps: [{ what: "It reaches the brain.", details: "", sources: ["1"] }] },
  ],
};
const onePart = { parts: [{ part: 1, title: "Coffee", stages: ["T1", "T2", "T3"], opening: "you take a sip", endsAt: "the brain" }] };
const channel = (format: ChannelFormat, visuals = "") => ({
  name: "C",
  format,
  looseOpening: false,
  profile: { summary: "s", subjects: "s", voice: "v", structure: "s", avoid: [], surpriseMe: "s", examples: [], visuals },
});
const base = { title: "What Happens When You Drink Coffee", premise: "p", durationSec: 45, wordsPerSecond: 2.3, research, plan: onePart, part: 1 };

describe("writing styles per channel", () => {
  it("writes a What happens when… video in the second person, as one standalone video", () => {
    const system = processNarrationPrompt({ ...base, channel: channel("INVISIBLE_EXPLAINER"), earlier: [] }).system;
    expect(system).toContain('Talks to the viewer with "you"');
    expect(system).not.toContain("factory order");
    expect(system).not.toContain("Part 1 of");
    expect(system).not.toContain("one continuous story cut into pieces");
  });

  it("keeps How It's Made third person and in factory order", () => {
    const system = processNarrationPrompt({ ...base, channel: channel("PROCESS_EXPLAINER"), earlier: [] }).system;
    expect(system).toContain('Never "you", "we" or "I"');
    expect(system).toContain("factory order");
  });

  it("storyboards each style its own way, with the channel's own rules on top", () => {
    const invisible = processBreakdownPrompt({ ...base, channel: channel("INVISIBLE_EXPLAINER", "Always show the glowing subject."), narration: "n" }).system;
    expect(invisible).toContain("cutaway");
    expect(invisible).toContain("THIS CHANNEL'S STORYBOARD RULES");
    expect(invisible).toContain("Always show the glowing subject.");
    expect(invisible).toMatch(/heartbeat \(heartbeat\)/);
    expect(invisible).not.toMatch(/press \(press\)/);
    expect(invisible).toContain("a short question is allowed");
    expect(invisible).toContain("dive-in");

    const factory = processBreakdownPrompt({ ...base, channel: channel("PROCESS_EXPLAINER"), narration: "n" }).system;
    expect(factory).toContain("The material is the star");
    expect(factory).not.toContain("STORYBOARD RULES");
    expect(factory).toContain("a statement, never a question");
    expect(factory).not.toContain("dive-in");
  });

  it("asks What happens when… for a shocking opening and a little deadpan humor", () => {
    const system = processNarrationPrompt({ ...base, channel: channel("INVISIBLE_EXPLAINER"), earlier: [] }).system;
    expect(system).toContain("Inside your brain, caffeine occupies spots");
    expect(system).toContain("awkward, deadpan humor");
    const audit = processAuditPrompt({ format: "INVISIBLE_EXPLAINER", title: "T", research, plan: onePart, part: 1, narration: "n", earlier: [] }).system;
    expect(audit).toContain("deadpan asides");
  });

  it("checks tone against the style's voice", () => {
    const audit = (format: ChannelFormat) => processAuditPrompt({ format, title: "T", research, plan: onePart, part: 1, narration: "n", earlier: [] }).system;
    expect(audit("INVISIBLE_EXPLAINER")).toContain('Talking to the viewer with "you" is intended');
    expect(audit("PROCESS_EXPLAINER")).toMatch(/rhetorical questions, "you", or brand names/);
  });

  it("allows questions only where the style or the looser opening does", () => {
    expect(questionAllowed(channel("INVISIBLE_EXPLAINER"), 1)).toBe(true);
    expect(questionAllowed(channel("PROCESS_EXPLAINER"), 1)).toBe(false);
    expect(questionAllowed({ ...channel("PROCESS_EXPLAINER"), looseOpening: true }, 1)).toBe(true);
    expect(questionAllowed({ ...channel("PROCESS_EXPLAINER"), looseOpening: true }, 2)).toBe(false);
  });

  it("pitches and designs channels for the style", () => {
    const pitch = pitchPrompt({ channel: channel("INVISIBLE_EXPLAINER"), idea: null, count: 6, avoidTitles: [], parts: [1, 1] });
    expect(pitch.system).toContain("one standalone short video");
    expect(pitch.system).toContain("everyday moment");
    const design = channelDesignPrompt({ format: "INVISIBLE_EXPLAINER", brief: "b", existingNames: [] }).system;
    expect(design).toContain("30–45 seconds");
    expect(design).toContain("Never a third-person narrator");
  });

  it("keeps a producer's idea at its own scope for What happens when…, but lets How It's Made narrow a broad product", () => {
    const idea = "What happens when you drink coffee";
    const invisible = pitchPrompt({ channel: channel("INVISIBLE_EXPLAINER"), idea, count: 6, avoidTitles: [], parts: [1, 1] }).user;
    expect(invisible).toContain("Never narrow it");
    expect(invisible).not.toContain("one specific everyday version");
    const pick = pitchPickPrompt({ channel: channel("INVISIBLE_EXPLAINER"), idea, pitches: [], keep: 3 }).system;
    expect(pick).toContain("narrows it");
    expect(pitchPrompt({ channel: channel("PROCESS_EXPLAINER"), idea: "cookies", count: 6, avoidTitles: [], parts: [2, 4] }).user).toContain("one specific everyday version");
  });

  it("every style's sounds exist and each has its own music bed", () => {
    for (const style of Object.values(WRITING_STYLES)) for (const k of style.soundEffects) expect(SOUND_EFFECTS[k]).toBeDefined();
    const keys = Object.values(WRITING_STYLES).map((s) => s.music.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(writingStyle("unknown").kind).toBe(WRITING_STYLES.PROCESS_EXPLAINER.kind);
  });

  it("reads profiles saved before storyboard rules existed", () => {
    expect(parseProfile({ summary: "s", subjects: "s", voice: "v", structure: "s", avoid: [], surpriseMe: "s", examples: [] }).visuals).toBe("");
  });
});
