/*
 * Fixed benchmark for the plot-logic auditor. Every story here is original,
 * written for this benchmark. "flawed" cases contain one seeded hole the
 * auditor should catch; "sound" cases are coherent (including impossible
 * premises and deliberate mysteries) and must not be rejected.
 *
 * Keep cases stable so results can be compared across prompt and model
 * changes. Add new cases at the end; never edit an existing one.
 */
import type { LOGIC_CATEGORIES } from "@/lib/schemas/story-plan";
import { BUILT_IN_REFERENCES } from "@/lib/story/references";

type Category = (typeof LOGIC_CATEGORIES)[number];

export type BenchCase = {
  id: string;
  kind: "flawed" | "sound";
  premise: string;
  narration: string;
  /** For flawed cases: the categories that count as catching the seeded hole. */
  expect: Category[];
  /** What is wrong (flawed) or what must not be mistaken for a hole (sound). */
  note: string;
  series?: { previousSummaries: string[]; facts: string[] };
};

export const BENCH_CASES: BenchCase[] = [
  {
    id: "unexplained-knowledge",
    kind: "flawed",
    premise: "Kenny wakes up and everyone in the world is gone.",
    narration:
      "Kenny woke up and there was nobody left in the world. The streets were silent and the shops were open with nobody inside. He walked for hours, shouting, until his voice gave out. At the edge of town he found a steel hatch in the ground behind the old water plant, locked with a keypad. Kenny typed in 7-4-1-9 without thinking, and the hatch hissed open. Below was a bunker, lit and humming, with food for a year and a radio. He climbed down, pulled the hatch shut behind him, and turned the radio on. Somebody was already talking.",
    expect: ["knowledge", "causal-gap", "convenient-resolution"],
    note: "Kenny knows the bunker code with no setup.",
  },
  {
    id: "convenient-rescue-object",
    kind: "flawed",
    premise: "A chef gets locked in a walk-in freezer after closing.",
    narration:
      "Marta stayed late to count the stock, and the walk-in freezer door swung shut behind her. The inside handle had been broken for weeks. Everyone else had gone home. Her phone had no signal through the steel walls, and her fingers were already going numb. She banged on the door until her hands hurt. She tried prying the gasket with her nails. Nothing. Then she remembered the screwdriver in her apron pocket, took the door's inside panel off in under a minute, and pulled the latch free. She walked out into the warm kitchen and laughed until she cried.",
    expect: ["convenient-resolution", "causal-gap"],
    note: "The screwdriver appears only when needed; nothing set it up.",
  },
  {
    id: "time-contradiction",
    kind: "flawed",
    premise: "A hiker gets lost on a short trail and has to get down before dark.",
    narration:
      "Jonah set off up the ridge trail at four in the afternoon, sure he'd be back at the car by six. By five the path had split three ways and none of them looked like the map. He picked the one that went downhill. The sun dropped behind the peaks and the woods went blue and cold. He walked another two hours by the light of his phone until the battery died. Then, just after sunrise, he heard a road. It was a quarter past six when he reached the car, exactly when he'd planned.",
    expect: ["temporal"],
    note: "He walks through the night yet arrives at 6:15 the same evening, as planned.",
  },
  {
    id: "spatial-contradiction",
    kind: "flawed",
    premise: "A woman is trapped on her roof when the ladder falls.",
    narration:
      "Priya climbed onto the roof to clear the gutter, and the ladder slid away and crashed onto the patio. The house was empty, the neighbours were at work, and her phone was on the kitchen counter. The roof was too steep to sit on comfortably and too high to jump from. She waved at a passing cyclist, who didn't look up. By noon the tiles were hot enough to burn. So she grabbed her phone off the counter, called her brother, and waited in the shade of the chimney until his van pulled up.",
    expect: ["spatial", "causal-gap"],
    note: "She takes the phone from the kitchen counter while stuck on the roof.",
  },
  {
    id: "inconsistent-rule",
    kind: "flawed",
    premise: "Overnight, every electrical device in the world stops working.",
    narration:
      "At three in the morning every light in the city went out, and in the morning nothing came back. Cars wouldn't start. Phones were dead bricks. Even battery torches stayed dark, as if electricity itself had stopped. Ben walked to his mother's flat across town because there was no other way to check on her. She was fine, sitting by the window with a candle. They spent the day filling buckets from the old well in the park. That night Ben plugged his phone into her wall socket, called his sister, and told her they were safe.",
    expect: ["rule-violation"],
    note: "The established rule (nothing electrical works) breaks without explanation.",
  },
  {
    id: "missing-motivation",
    kind: "flawed",
    premise: "A man notices a light on in the abandoned house across the lake.",
    narration:
      "Every night for a week, Luis saw a light in the empty house across the lake. Nobody had lived there in ten years. On the eighth night he decided he'd had enough. He put on his coat, walked down to the shore, and called the police, who said they'd send someone in the morning. He went back inside and made tea. Then, for no reason he could explain, he stripped to his shorts and swam across the freezing lake in the dark, climbed out on the far side, and knocked on the door.",
    expect: ["motivation", "character-behavior"],
    note: "After calling the police and going to bed, he swims a freezing lake with no reason.",
  },
  {
    id: "unpaid-setup",
    kind: "flawed",
    premise: "A girl is given an envelope she must not open until midnight.",
    narration:
      "On the morning of her twelfth birthday, Ada's grandmother pressed a sealed envelope into her hand and said, very seriously, do not open this until midnight, whatever happens. Ada put it in her backpack. At school, her best friend told everyone a secret Ada had trusted her with. Ada spent the afternoon furious, then sad, then furious again. After school the two of them sat on the swings and argued until it got dark, and then they both cried, and then they laughed about how stupid it had all been. Ada walked home happy and went to bed early.",
    expect: ["unpaid-setup", "missing-connection"],
    note: "The envelope is set up as important and never mentioned again.",
  },
  {
    id: "unjustified-ending",
    kind: "flawed",
    premise: "A fisherman's engine dies in a storm far from shore.",
    narration:
      "Rory's engine coughed and died ten miles out, just as the storm rolled in. The radio was gone, ripped off by the first big wave. He bailed with a bucket until his arms shook. He tried the engine again and again and flooded it. The boat turned side-on to the swell and nearly rolled. Then a coastguard helicopter appeared out of the cloud, though nobody knew he was out there, and lowered a man on a line. Twenty minutes later Rory was wrapped in a blanket, drinking tea, watching his boat sink.",
    expect: ["convenient-resolution", "causal-gap"],
    note: "Rescue arrives although nobody knew he was out there and the radio was lost.",
  },
  {
    id: "unsupported-hook",
    kind: "flawed",
    premise: "A man wakes up to dozens of missed calls.",
    narration:
      "Kenny woke up to forty-seven missed calls. Every single one was from his own phone number. He stared at the screen for a long time. Then he got up, made coffee, and checked the weather. It was going to rain. He took the bus to work, where his manager asked him to redo a spreadsheet, and he spent the afternoon fixing formulas. On the way home he picked up noodles from the place on the corner. He ate them in front of the TV and fell asleep halfway through a film.",
    expect: ["unpaid-setup", "missing-connection", "causal-gap"],
    note: "The hook's mystery is never addressed.",
  },
  {
    id: "dropped-stakes",
    kind: "flawed",
    premise: "A delivery driver is stranded by a blizzard on a mountain road.",
    narration:
      "The snow came down so fast that by the second bend Tasha couldn't see the road at all. She stopped the van, and the radio said the pass would be closed for two days and temperatures would fall to minus twenty. She had a quarter tank of fuel and no blanket. She ran the engine for heat in short bursts, watching the gauge. Then she found a box in the back addressed to a bakery and opened it. Inside was a wedding cake. She sat in the driver's seat and ate a slice, wondering who was getting married, and decided she'd write them a card.",
    expect: ["dropped-stakes"],
    note: "The cold, fuel and closed pass are forgotten; the ending ignores the danger.",
  },
  {
    id: "time-loop-coherent",
    kind: "sound",
    premise: "A woman relives the same Tuesday, and only she remembers.",
    narration:
      "Nell had lived the same Tuesday nine times. Same rain. Same bus driver humming the same song. Same coffee spilled on the same shirt at eight forty. Whatever she did, she woke at seven in her own bed and it was Tuesday again, and nobody else remembered a thing. On the tenth Tuesday she stopped trying to escape it and started paying attention. The bus driver's song stopped halfway through, every time, at the same stop. So she got off there. Across the road, an old man was sitting on a bench, and as she walked up, he looked at her and said, ten. You're quicker than the last one.",
    expect: [],
    note: "Impossible premise with consistent rules; the old man is a deliberate, set-up mystery (the song cue).",
  },
  {
    id: "continuation-consistent",
    kind: "sound",
    premise: "Kenny, alone in an empty world, follows the note that told him to turn off his broadcast.",
    narration:
      "Kenny didn't turn the broadcast off that night. He sat in the dark of his flat with the note in his lap, listening to his own voice repeat from the radio on the shelf. At eight he went to the corner, like he'd promised, and waited. Nobody came. At nine he walked back to the radio station to switch it off after all, and found the booth door already open. The microphone cable was cut clean. And on the desk, in the same neat handwriting, a second note. You didn't listen. Now they know where you live.",
    expect: [],
    note: "Continues Part 1 faithfully; the writer and 'they' remain deliberate mysteries.",
    series: {
      previousSummaries: [
        "Part 1: Kenny wakes to find everyone gone but machines still running. He broadcasts his name, street and a nightly 8pm meeting point from the radio station above the bakery. A note under his door says: Turn it off. They can hear it too.",
      ],
      facts: ["Kenny lives alone in a flat", "The radio station is above the bakery", "He promised to be on his corner every night at eight"],
    },
  },
  {
    id: "continuation-contradiction",
    kind: "flawed",
    premise: "Kenny, alone in an empty world, follows the note that told him to turn off his broadcast.",
    narration:
      "Kenny switched the broadcast off the moment he read the note, and then walked to the bakery on Fifth to think. He'd never been inside the radio station, he realised, never even noticed it was there. His dog Biscuit trotted beside him, nose down, the only other living thing he'd seen all week. At the bakery the bread on the racks was still warm. Somebody had baked it that morning.",
    expect: ["series-continuity"],
    note: "Contradicts Part 1: he broadcast from the station, and he has no dog.",
    series: {
      previousSummaries: [
        "Part 1: Kenny wakes to find everyone gone but machines still running. Completely alone, he broadcasts his name, street and a nightly 8pm meeting point from the radio station above the bakery. A note under his door says: Turn it off. They can hear it too.",
      ],
      facts: ["Kenny lives alone", "He broadcast from the radio station above the bakery", "He has seen no living creature since everyone vanished"],
    },
  },
  ...BUILT_IN_REFERENCES.map(
    (r): BenchCase => ({
      id: `reference-${r.id}`,
      kind: "sound",
      premise: r.title,
      narration: r.text,
      expect: [],
      note: `Built-in reference (${r.archetype}): coherent, ${r.endingType} ending.`,
    }),
  ),
];
