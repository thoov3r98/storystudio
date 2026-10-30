import { describe, expect, it } from "vitest";
import { comparableEvidence, honestStrategy, latestViews, type Observation, pickDiverse, SCORE_WEIGHTS, scoreTopic, traction } from "@/lib/topics/scoring";
import { MetricInputSchema, ReferenceInputSchema, type TopicRatings } from "@/lib/schemas/topics";
import { detectPlatform, fetchVideoMetadata, isoDurationSec, youtubeId } from "@/lib/topics/references";

const obs = (o: Omit<Partial<Observation>, "observedAt"> & { observedAt: string }): Observation => ({ views: null, likes: null, comments: null, shares: null, source: "MANUAL", ...o, observedAt: new Date(o.observedAt) });
const ratings = (n: number): TopicRatings => ({ visual: { score: n, note: "v" }, familiarity: { score: n, note: "f" }, surprise: { score: n, note: "s" }, researchAvailability: { score: n, note: "r" }, visualFeasibility: { score: n, note: "x" } });

describe("audience traction", () => {
  it("never invents a number: no views recorded means unknown and zero evidence", () => {
    const t = traction({ platform: "youtube", publishedAt: null, metrics: [obs({ likes: 5000, observedAt: "2026-10-01" })] });
    expect(t).toMatchObject({ tier: "unknown", value: 0, observation: null });
    expect(t.explanation).toBe("No view count recorded.");
  });

  it("uses the latest observation with views, and judges YouTube per month since publishing", () => {
    const metrics = [obs({ views: 100_000, observedAt: "2024-01-01" }), obs({ views: 12_000_000, observedAt: "2026-10-01" })];
    expect(latestViews(metrics)!.views).toBe(12_000_000);
    const t = traction({ platform: "youtube", publishedAt: new Date("2022-04-07"), metrics });
    expect(t.tier).toBe("strong");
    expect(t.explanation).toMatch(/12\.0M views over 4\.5 years .*observed 2026-10-01, entered by hand, unverified/);
    // The same total over eighteen years is only moderate.
    expect(traction({ platform: "youtube", publishedAt: new Date("2008-10-01"), metrics }).tier).toBe("moderate");
  });

  it("doesn't compare platforms on raw views: short-form is judged on totals with its own bar", () => {
    const m = [obs({ views: 500_000, observedAt: "2026-10-01" })];
    expect(traction({ platform: "tiktok", publishedAt: new Date("2026-09-01"), metrics: m }).tier).toBe("moderate");
    expect(traction({ platform: "youtube", publishedAt: new Date("2026-09-01"), metrics: m }).tier).toBe("strong");
  });

  it("counts API-verified numbers fully and hand-entered ones at a discount", () => {
    const at = { platform: "tiktok", publishedAt: null };
    const manual = traction({ ...at, metrics: [obs({ views: 5_000_000, observedAt: "2026-10-01" })] });
    const api = traction({ ...at, metrics: [obs({ views: 5_000_000, observedAt: "2026-10-01", source: "YOUTUBE_API" })] });
    expect(api.value).toBe(1);
    expect(manual.value).toBeCloseTo(0.8);
    expect(api.verified).toBe(true);
  });
});

describe("comparable evidence and scoring", () => {
  const ref = (metrics: Observation[], category = "footwear") => ({ id: "r", platform: "tiktok", category, publishedAt: null, metrics });

  it("treats missing evidence as zero, never as positive", () => {
    expect(comparableEvidence("footwear", [])).toMatchObject({ value: 0, level: "NONE" });
    expect(comparableEvidence("footwear", [ref([])])).toMatchObject({ value: 0, level: "NONE" });
  });

  it("separates verified from hand-entered evidence and discounts other categories", () => {
    const strong = [obs({ views: 3_000_000, observedAt: "2026-10-01" })];
    expect(comparableEvidence("footwear", [ref(strong)])).toMatchObject({ level: "REPORTED", value: 8 });
    expect(comparableEvidence("toys", [ref(strong)]).value).toBe(5.6);
    expect(comparableEvidence("footwear", [ref([{ ...strong[0], source: "YOUTUBE_API" }])])).toMatchObject({ level: "VERIFIED", value: 10 });
  });

  it("scores deterministically from the weights, with a line per dimension", () => {
    expect(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    const a = scoreTopic(ratings(8), { value: 0, note: "none" });
    const b = scoreTopic(ratings(8), { value: 0, note: "none" });
    expect(a).toEqual(b);
    expect(a.score).toBe(60); // 75% of the weight at 8/10, evidence 0
    expect(a.breakdown.find((l) => l.key === "evidence")).toMatchObject({ value: 0, points: 0, weight: 0.25 });
    expect(scoreTopic(ratings(8), { value: 10, note: "x" }).score).toBe(85);
    expect(scoreTopic(ratings(14), { value: 12, note: "x" }).score).toBe(100); // clamped
  });

  it("only lets a topic claim the evidence it has", () => {
    expect(honestStrategy("EVIDENCE_BACKED", 0, "NONE")).toBe("EXPLORATORY");
    expect(honestStrategy("EVIDENCE_BACKED", 2, "NONE")).toBe("ADJACENT");
    expect(honestStrategy("EVIDENCE_BACKED", 1, "REPORTED")).toBe("EVIDENCE_BACKED");
  });

  it("picks the best while keeping categories and products different", () => {
    const items = [
      { product: "Flip-flops", category: "footwear", score: 90 },
      { product: "Rubber flip-flops", category: "beach", score: 89 },
      { product: "Slippers", category: "footwear", score: 85 },
      { product: "Buckets", category: "household", score: 70 },
      { product: "Marbles", category: "toys", score: 60 },
    ];
    expect(pickDiverse(items, 3).map((x) => x.product)).toEqual(["Flip-flops", "Buckets", "Marbles"]);
    // With too few categories, the category rule relaxes but near-identical products still don't repeat.
    expect(pickDiverse(items.slice(0, 3), 3).map((x) => x.product)).toEqual(["Flip-flops", "Slippers"]);
  });
});

describe("reference input", () => {
  it("keeps blank numbers null and needs at least one", () => {
    const m = MetricInputSchema.parse({ views: "", likes: "120", comments: undefined, shares: null, observedAt: "2026-10-01" });
    expect(m).toMatchObject({ views: null, likes: 120, comments: null, shares: null });
    expect(MetricInputSchema.safeParse({ views: "", observedAt: "2026-10-01" }).success).toBe(false);
    expect(MetricInputSchema.safeParse({ views: "5", observedAt: "2999-01-01" }).success).toBe(false);
  });

  it("stores a missing URL as null", () => {
    const r = ReferenceInputSchema.parse({ platform: "youtube", creator: "c", url: " ", title: "t", product: "p", category: "k" });
    expect(r.url).toBeNull();
    expect(r.notableStep).toBe("");
  });
});

describe("metadata import", () => {
  it("recognises platforms and YouTube ids", () => {
    expect(detectPlatform("https://www.youtube.com/watch?v=eeI7q_eIs7g")).toBe("youtube");
    expect(detectPlatform("https://www.tiktok.com/@a/video/1")).toBe("tiktok");
    expect(youtubeId("https://youtu.be/eeI7q_eIs7g")).toBe("eeI7q_eIs7g");
    expect(youtubeId("https://www.youtube.com/shorts/abcdef12")).toBe("abcdef12");
    expect(isoDurationSec("PT5M25S")).toBe(325);
  });

  it("reads title and creator from oEmbed, with no numbers", async () => {
    const urls: string[] = [];
    const fetcher = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ title: "How It's Made: Razor Blades", author_name: "Science Channel" }));
    }) as typeof fetch;
    const meta = await fetchVideoMetadata("https://www.youtube.com/watch?v=eeI7q_eIs7g", fetcher);
    expect(meta).toMatchObject({ platform: "youtube", title: "How It's Made: Razor Blades", creator: "Science Channel", metrics: null, method: "YouTube oEmbed" });
    expect(urls[0]).toMatch(/^https:\/\/www\.youtube\.com\/oembed/);
    expect(await fetchVideoMetadata("https://example.com/v", fetcher)).toBeNull();
  });
});
