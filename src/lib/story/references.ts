import type { Archetype } from "@/lib/schemas/story-plan";

/**
 * Reference stories teach craft by example: how fast the premise lands, how
 * clues and setups are planted before they pay off, how little exposition is
 * needed. They are demonstrations, never templates to copy.
 */
export type ReferenceStory = {
  id: string;
  title: string;
  archetype: Archetype;
  hookStyle: string;
  structure: string;
  tone: string;
  pacing: string;
  endingType: string;
  qualities: string[];
  text: string;
  source: "built-in" | "producer";
};

/**
 * Original examples written for Story Studio as starting reference material.
 * They show coherent plotting and different approaches; they are not evidence
 * of real audience performance.
 */
export const BUILT_IN_REFERENCES: ReferenceStory[] = [
  {
    id: "builtin-last-bus",
    title: "The Last Bus (original example)",
    archetype: "survival",
    hookStyle: "immediate-danger",
    structure: "Trapped → failed attempt → planted knowledge used → escape with an ironic sting",
    tone: "tense, dry",
    pacing: "Danger in line one; each attempt changes her situation",
    endingType: "escape",
    qualities: ["setups planted early pay off (the handle, the dead call)", "clear goal and constraint", "earned escape", "ironic last line"],
    source: "built-in",
    text: `Dana fell asleep on the last bus home, curled across the back seat under her coat, and woke up in the dark, locked inside it. Through the windows, rows of identical buses. A depot. Her phone said four percent. She called her sister and it died mid-ring. The doors wouldn't move, the windows didn't open, and the cold was already coming up through the floor. But Dana had ridden this route for six years, and every single night she'd watched the driver reach above the front door and pull a red handle to let the air out of the doors when they stuck. She found it in the dark. She pulled. The doors sighed open. The depot's big shutters did not. So she walked the rows, shouting, until she saw a light at the far end, an office, and a man in a fleece eating soup alone. He stared at her like she was a ghost. Then he said the police had been on the phone for hours. A woman had reported her sister missing when she never got home from the last bus, and called again, frantic, when a call from her cut off mid-ring. The driver swore his bus was empty when he locked it, so they were searching every stop on the route. Every stop except this one.`,
  },
  {
    id: "builtin-car-moved",
    title: "The Car That Moved at Night (original example)",
    archetype: "mystery",
    hookStyle: "specific-mystery",
    structure: "Small impossible observation → test → clue points to wrong suspect → stakeout → fair reveal with a warm turn",
    tone: "curious, warm",
    pacing: "One new clue per beat; the reveal reuses every clue",
    endingType: "discovery",
    qualities: ["fair-play clues", "misdirection that is honest", "reveal explains every clue", "emotional payoff"],
    source: "built-in",
    text: `For six mornings in a row, Mara's car was not quite where she'd left it. A foot back from the tree. Wheels turned the wrong way. The seat pushed all the way back, when she drove with it right up against the wheel. Her husband said she was imagining it. So on the seventh night she wrote the mileage on a sticky note and hid it in the glove box. In the morning, the car had driven nine miles. And the radio was on a station she never played, slow old country music, the kind only her father could stand. Her father, who lived with them. Her father, who'd promised to stop driving in the spring because of his eyes. That night she waited in the dark kitchen. At one in the morning the back door opened, and her father came out with her keys. But he didn't get in the driver's seat. He got in the passenger side. Her fifteen-year-old son slid in behind the wheel, pushed the seat back, and turned up the country music. She followed them to the empty school car park and watched him practise parking, badly, for an hour. His driving test was booked for her birthday.`,
  },
  {
    id: "builtin-empty-world",
    title: "Nobody Left (original example)",
    archetype: "speculative",
    hookStyle: "impossible-situation",
    structure: "Plain impossible premise → natural reactions → one world rule discovered → hero acts on the rule → consequence opens a bigger mystery",
    tone: "eerie, quiet",
    pacing: "Vivid single images; the rule is learned, not explained",
    endingType: "cliffhanger",
    qualities: ["premise stated simply", "consistent world rule", "consequence follows from the hero's own action", "cliffhanger that is set up"],
    source: "built-in",
    text: `Kenny woke up and there was nobody left in the world. He didn't know that yet. He knew the coffee shop on the corner was open, with no one behind the counter and a jug of milk still steaming on the machine. He knew the cars on his street were parked with their engines running and their doors open. By noon he'd stopped knocking on doors and started shouting. By evening he had worked out the one rule this new world seemed to have. Everything people had built was still running. Only the people were gone. So he went where people would go if there were any left. The little radio station above the bakery still had power. Kenny sat in the booth, said his name and his street, and said he'd be on that corner every night at eight. He set it to repeat and walked home through streets lit for no one. There was a note under his door. Neat handwriting he'd never seen before. It said, Turn it off. They can hear it too.`,
  },
  {
    id: "builtin-act-normal",
    title: "Act Normal (original example)",
    archetype: "comedy",
    hookStyle: "relatable-problem",
    structure: "Relatable mistake → cover story → cover story demands more lies → absurd peak → payoff that reframes the whole thing",
    tone: "light, character-driven",
    pacing: "Each lie forces the next; the joke lands on the last line",
    endingType: "irony",
    qualities: ["believable mistake", "compounding consequences", "humour from character, not jokes", "payoff that recontextualises"],
    source: "built-in",
    text: `Priya meant to text her sister, he's coming to dinner, please act normal. She sent it to him. To Marcus. The man who was coming to dinner. She watched it say delivered and did the only sensible thing, which was throw her phone across the couch like it was on fire. Then she picked it up and typed, sorry, that was for my sister, she's in a play called Act Normal. He wrote back, oh cool, when is it? So now her sister had to be in a play. Her sister, who once forgot her only line in a school nativity, as a sheep. By the time Marcus rang the doorbell there were tickets. Printed tickets, from the printer in the hall, for a show that did not exist, on Saturday, in their mum's garage. Marcus held one up and said he'd love to come. Then he showed her his phone. A text from his brother, an hour old. She's going to be weird about it. Just act normal.`,
  },
  {
    id: "builtin-monitor",
    title: "The Monitor (original example)",
    archetype: "suspense",
    hookStyle: "disturbing-discovery",
    structure: "Unsettling but explainable event → checked → explanation found (relief) → explanation turns threatening",
    tone: "quiet dread",
    pacing: "Slow reveals; relief right before the turn",
    endingType: "cliffhanger",
    qualities: ["coherent threat", "real-world explanation", "relief before the turn", "unresolved but fair"],
    source: "built-in",
    text: `At two in the morning, the baby monitor in Jess's hand started humming. Not static. A lullaby. A woman's voice, soft and close, the way you sing with your face right by the crib. Jess was alone in the house. She took the stairs two at a time and pushed open the nursery door. Her daughter was asleep. The room was empty. The little camera on the dresser was dark and silent. But the monitor in her hand was still humming. She stood in the doorway listening, and slowly it made sense. Old monitors share channels, and the couple next door had brought their new baby home on Sunday. It wasn't in her house at all. She almost laughed. Then the humming stopped. And the woman on the monitor said, quietly, I know you can hear me, Jess. Close her window.`,
  },
  {
    id: "builtin-wrong-dog",
    title: "The Wrong Dog (original example)",
    archetype: "everyday",
    hookStyle: "plain-situation",
    structure: "Ordinary errand → small detail noticed → simple, sensible steps → a plain, warm resolution",
    tone: "plain, warm, curious",
    pacing: "Calm and descriptive; interest comes from the situation and its details, not suspense",
    endingType: "resolution",
    qualities: ["engaging without manufactured tension", "the clue is planted plainly (the white paw)", "each step is the obvious sensible one", "a warm ending that follows from what came before"],
    source: "built-in",
    text: `Theo picked up his dog from the groomer on Saturday, paid, and drove home with her asleep on the back seat. It was only when she walked straight past her own bed and lay down by the front door that he looked at her properly. Same size. Same curly grey coat, freshly trimmed. But Biscuit had a white patch on her left front paw, and this dog's paws were all grey. He rang the groomer, but they had closed for the weekend. Her collar had no tag, just the blue ribbon the groomer ties on every dog. So he took her photo and posted it in the neighbourhood group, saying he thought he had someone's dog, and that they probably had his. An hour later a woman two streets away replied with a photo of her own sofa. On it was Biscuit, white paw and all, chewing a slipper. They met halfway, outside the corner shop, each holding a lead. The two dogs ignored them and sniffed each other for a long time. The woman said her dog, Pepper, had never once slept in a car. Theo said Biscuit had never once chewed a slipper. They swapped leads, and then, since they were both standing there anyway, phone numbers, for the next time the groomer had a busy Saturday.`,
  },
];

/** Picks the references most like the episode being written, never more than `max`. */
export function selectReferences(all: ReferenceStory[], want: { archetype?: string | null; hookStyle?: string | null; endingType?: string | null; tone?: string | null }, max = 2): ReferenceStory[] {
  const score = (r: ReferenceStory) =>
    (want.archetype && r.archetype === want.archetype ? 4 : 0) +
    (want.hookStyle && r.hookStyle === want.hookStyle ? 2 : 0) +
    (want.endingType && r.endingType === want.endingType ? 1 : 0) +
    (want.tone && r.tone.split(/[ ,]+/).some((w) => want.tone!.toLowerCase().includes(w)) ? 0.5 : 0) +
    // The producer's own approved examples win ties over the built-ins.
    (r.source === "producer" ? 0.25 : 0);
  return [...all]
    .map((r) => ({ r, s: score(r) }))
    .filter((x) => x.s >= 1)
    .sort((a, b) => b.s - a.s)
    .slice(0, max)
    .map((x) => x.r);
}

export function referenceBlock(refs: ReferenceStory[]): string {
  if (refs.length === 0) return "";
  return `REFERENCE STORIES (craft examples only)
Study how fast the situation becomes clear, how setups are planted before they pay off, how each moment causes the next, and how little explanation is needed. Do NOT copy their wording, characters, situations, twists or tone: take the tone from this story's own events.

${refs.map((r) => `### ${r.title}\n${r.archetype} · hook: ${r.hookStyle} · ending: ${r.endingType}\nWhat it does well: ${r.qualities.join("; ")}\nShape: ${r.structure}\n\n${r.text}`).join("\n\n")}`;
}
