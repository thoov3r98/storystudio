/*
 * Curated starter references (checked 2026-10-29). Only sources that could be
 * confirmed have a URL; the rest need the producer to find the original video
 * before they count as evidence. No view counts are included: reported counts
 * from articles weren't verifiable, so numbers must be observed and dated.
 */

type Starter = {
  platform: string;
  creator: string;
  url: string | null;
  title: string;
  product: string;
  category: string;
  notableStep: string;
  curiosityMechanism: string;
  transformationType: string;
  verification: "NEEDS_SOURCE" | "USER_ENTERED" | "SOURCE_CONFIRMED";
  notes: string;
  usageRights: string;
};

const RIGHTS = "Reference only; not licensed for reuse";

export const STARTER_REFERENCES: Starter[] = [
  {
    platform: "youtube",
    creator: "Science Channel",
    url: "https://www.youtube.com/watch?v=eeI7q_eIs7g",
    title: "How It's Made: Razor Blades",
    product: "Razor blades",
    category: "personal care",
    notableStep: "A thin steel strip is hardened by heating and cooling, then ground to an edge.",
    curiosityMechanism: "Hidden precision: an everyday object needs a remarkably exact edge.",
    transformationType: "precision metalwork",
    verification: "SOURCE_CONFIRMED",
    notes: "Title and channel confirmed via YouTube oEmbed on 2026-10-29. Record views from the video page with the date you saw them.",
    usageRights: RIGHTS,
  },
  {
    platform: "youtube",
    creator: "Science Channel",
    url: null,
    title: "How It's Made: Ice Cream Sandwiches",
    product: "Ice cream sandwiches",
    category: "frozen desserts",
    notableStep: "A continuous ribbon of ice cream is cut and pressed between wafers at line speed.",
    curiosityMechanism: "Factory reveal: a familiar treat made by a fast, precise machine.",
    transformationType: "food assembly line",
    verification: "NEEDS_SOURCE",
    notes: "Segment from How It's Made season 5 (\"Ice Cream Treats\"), widely covered by articles; the original upload URL could not be confirmed. Add it before relying on this reference.",
    usageRights: RIGHTS,
  },
  {
    platform: "youtube",
    creator: "Science Channel",
    url: null,
    title: "Turning old sawmill blades into knives | How It's Made",
    product: "Knives from recycled sawmill blades",
    category: "kitchen tools",
    notableStep: "Worn sawmill blades are cut into knife blanks, hardened and sharpened.",
    curiosityMechanism: "Transformation: scrap industrial steel becomes a finished knife.",
    transformationType: "recycling / metal shaping",
    verification: "NEEDS_SOURCE",
    notes: "Title seen in a third-party listing only; the original upload could not be confirmed.",
    usageRights: RIGHTS,
  },
  {
    platform: "youtube",
    creator: "Factory Works",
    url: null,
    title: "Rubber flip-flop manufacturing",
    product: "Rubber flip-flops",
    category: "footwear",
    notableStep: "Rubber compound is pressed into a mould under heat and the soles are cut out.",
    curiosityMechanism: "Satisfying factory process for a cheap, everyday product.",
    transformationType: "molding",
    verification: "NEEDS_SOURCE",
    notes: "Reported as a popular example; no matching upload could be confirmed. Add the URL when found.",
    usageRights: RIGHTS,
  },
  {
    platform: "tiktok",
    creator: "Various factory accounts",
    url: null,
    title: "Plastic footwear injection molding (factory clips)",
    product: "Plastic slippers",
    category: "footwear",
    notableStep: "Molten plastic is injected into a hinged mould and a finished shoe pops out.",
    curiosityMechanism: "Instant transformation: pellets to a whole shoe in seconds.",
    transformationType: "molding",
    verification: "NEEDS_SOURCE",
    notes: "A recurring category of factory clips (often reposts); add a specific original video with its numbers.",
    usageRights: RIGHTS,
  },
];
