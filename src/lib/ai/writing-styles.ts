import type { ChannelFormat } from "@/lib/schemas/channel";
import type { SoundEffectKey } from "@/lib/constants";

/*
 * Writing styles: everything about how a channel's videos are researched,
 * written, checked and storyboarded that differs from one kind of channel to
 * another. A channel's `format` picks one; its editable profile then steers
 * every prompt on top of it. The pipeline itself (research → stages → story
 * shape and hooks → narration → audits → storyboard) is shared.
 *
 * Pattern keys are stored in the database (StorytellingPattern), so every style
 * gives its own wording to the same three keys rather than adding new ones.
 */

export type PatternGuide = { label: string; bestFor: string; structure: readonly string[] };
type PatternKey = "TRANSFORMATION" | "HIDDEN_PROBLEM" | "FACTORY_REVEAL";

export type WritingStyle = {
  /** How the prompts name this kind of video, e.g. "How It's Made style video". */
  kind: string;
  /** What one story is about: "product", "everyday moment". */
  subject: string;
  /** How the stages are ordered, e.g. "factory order". */
  order: string;
  /** Default production settings for a channel set up with this style. */
  defaults: { styleKey: string; targetDurationSec: number; minParts: number; maxParts: number };
  /** Topic discovery from the manufacturing reference library; without it, Surprise me uses the pitch writer. */
  topicDiscovery: boolean;
  /** The channel's "looser opening" switch applies (third-person styles only). */
  looseOpening: boolean;
  /** Questions to the viewer are part of the voice (opening line, on-screen hook). */
  allowsQuestions: boolean;
  /** Progress label while researching. */
  researchingLabel: string;

  channelDesign: string;
  /** What a new channel's profile voice must say, so the profile never contradicts the style's voice. */
  designVoice: string;
  pitchRules: string;
  pitchArc: string;
  /** How pitches treat an idea the producer typed: whether they may narrow it, and how the pitches differ. */
  pitchIdea: string;
  /** Added to the pitch editor's brief when the producer typed an idea. */
  pitchIdeaPick: string;

  researchSearch: string;
  researchNotes: (minStages: number) => string;

  voice: string;
  plan: (input: { parts: [number, number]; durationSec: number; reach: { id: string; name: string } | null }) => string;
  narration: {
    /** Part 1's opening when there's no approved hook. */
    plainOpening: (opening: string) => string;
    /** Where to go after the approved hook. */
    afterHook: (opening: string) => string;
    /** Bullets for telling the stages. */
    body: (stages: string[]) => string[];
    ending: (patternEnd: string | null) => string;
  };
  sceneRewrite: string;

  patterns: Record<PatternKey, PatternGuide>;
  hookStrategies: readonly string[];
  storyEditor: string;
  hookIntro: string;
  hookRules: string[];
  hookConnection: string;

  audit: { intro: string; temporal: string; clarity: string; tone: string; looseOpeningNote: string };
  attention: { intro: string; slowStart: string; stall: string };

  storyboard: {
    role: string;
    visualState: string;
    shots: string[];
    motion: string;
    stepLabel: string;
    firstShot: string;
    /** Added to shot 1 even when an approved hook describes its picture. */
    firstShotMotion: string;
    onScreen: { part1: string; later: string; examples: string };
  };
  soundEffects: readonly SoundEffectKey[];
  /** The music bed generated once when no track is chosen. */
  music: { key: string; name: string; prompt: string };
  post: { kind: string; hashtags: string; cover: string };
};

// ── How It's Made ─────────────────────────────────────────────────────

const HOW_ITS_MADE: WritingStyle = {
  kind: "How It's Made style video",
  subject: "product",
  order: "factory order",
  defaults: { styleKey: "stick-figure-color", targetDurationSec: 75, minParts: 3, maxParts: 5 },
  topicDiscovery: true,
  looseOpening: true,
  allowsQuestions: false,
  researchingLabel: "Researching how it's made",

  channelDesign: "Every channel explains, step by step, how real things are made or work, researched on the web before writing. Each subject is told across several videos (parts).",
  designVoice: "An unseen narrator in the third person, present tense; clear, calm and factual.",
  pitchRules: `What makes a strong idea:
- One specific, everyday product a viewer recognises instantly and has never seen made.
- A real factory process with several distinct, visual stages (enough for every part).
- Plain title naming the product, e.g. "How Crayons Are Made".
Never: brand names or named companies, history-only topics, products whose making is a secret or can't be researched, or more than one product per pitch.`,
  pitchArc: "the real manufacturing stages in order, from raw material to packed product",
  pitchIdea:
    "Every pitch is this product (or, if it is broad, one specific everyday version of it). Pitches differ only in which version or which angle they follow.",
  pitchIdeaPick: "A pitch that drifts from it is out.",

  researchSearch: `You are the researcher for a factual video series in the style of the TV show How It's Made. Use web search to find out exactly how the product is made in a modern factory today.

Report every major stage in factory order, from raw materials to the finished, packed product. For each stage give concrete, checkable details: the materials, the machines and what they do, temperatures, pressures, speeds, quantities, durations and how quality is checked. Prefer manufacturers, industry associations, engineering and educational sources, and encyclopedias. Say plainly where sources disagree or where a detail could not be found. Do not guess. Cite your sources.`,
  researchNotes: (minStages) => `mainRoute: when there are several ways in (different raw materials or methods), name the most common one today. The stages follow that route; mention other routes in a step only where they join it.
Split the process into ${minStages}–10 stages in factory order (raw materials first, packing last), each a distinct, visual phase with its own steps.`,

  voice: `Who it's for: ordinary adults with everyday knowledge, not engineers or chemists. Explain it the way you'd tell a curious friend. If a viewer would have to look up a word, the script has failed.

How the narration sounds:
- An unseen narrator, third person, present tense ("The wax is heated until..."). Never "you", "we" or "I".
- Calm and factual: what happens, in the order it happens. No jokes, puns, opinions, hype words, rhetorical questions or drama.
- Describe things, don't name them. Say what a machine, chemical or part is or does, and leave out its industry name: "it's pumped through a heated tube to 130 degrees", not "it's pumped through a coil cooker, a heated tube, to 130 degrees". Never give a name and then explain it. Use a name only when it is an everyday word ("oven", "conveyor belt", "roller") or the product itself.
- Plain words throughout: "a chemical mix", not "white liquor"; "pulp", not "furnish".
- Help the viewer picture it with everyday comparisons ("a brown, oatmeal-like mush", "about as thick as a pancake"). Comparisons describe what things are like; they never add facts.
- One or two striking numbers per video at most, said so they mean something ("about 160 degrees, well above boiling"). Never a run of figures, ranges or alternatives.
- Each main step says what goes in, what happens to it, and what comes out. Join steps with plain links ("next", "then", "once it cools", "from there").
- Never list more than two or three things in a row. Write for the ear: flowing spoken sentences, no colons, semicolons or parentheses.
- No brand names or named companies.`,
  plan: ({ parts, durationSec, reach }) => `You plan a How It's Made style series for one product, told across ${parts[0]}–${parts[1]} videos of about ${durationSec} seconds each.

{CHANNEL}

Split the research's stages into consecutive parts in factory order. Choose the number of parts the process needs: each part covers the stages that fill about ${durationSec} seconds of calm narration, no more. Group short stages; never split a stage. The parts are one continuous story cut into pieces: each part's first step follows straight on from the previous part's last step.
Every part must show the material visibly changing. Preparation with little to watch (receiving, storing, sampling, checking, measuring raw materials) is told in a sentence or two and grouped with the first step where the material changes; it never fills a part on its own.
Part 1 is the video most people see first, so it must reach a step where the raw material turns into something recognisable.${reach ? ` Its opening hook promises ${reach.id} (${reach.name}), so Part 1 must run through ${reach.id}.` : ""}`,
  narration: {
    plainOpening: (opening) => `Open by saying plainly what the product starts as: ${opening}`,
    afterHook: (opening) => `then go straight to where the process really begins (${opening}) and tell the steps in factory order`,
    body: (stages) => [
      `Tell the main steps of this part's stages (${stages.join(", ")}) that a viewer can picture, in factory order, folding small steps together. Never skip a step a later one depends on.`,
      "Spend the words on what a viewer could watch happening to the material. Checks, sampling, storage, hygiene and measuring get one short clause each, folded into the step they serve; never a run of sentences where the material doesn't change.",
      "Make it one flowing chain, not a list of facts: each sentence picks up the material or machine the last one ended on and says what happens to it next, or why. A viewer should always know where the material is and what it looks like now.",
      "Follow the main route. Another route (a different raw material or method) gets one short sentence at most.",
    ],
    ending: (patternEnd) => (patternEnd ? `End on the finished product, packed and ready to ship, landing the payoff of the story: ${patternEnd}` : "End on the finished product, packed and ready to ship."),
  },
  sceneRewrite: "Rewrite ONE shot of an existing How It's Made style script.",

  patterns: {
    TRANSFORMATION: {
      label: "Transformation",
      bestFor: "Recycling, forging, molding, material changes with a striking before and after.",
      structure: [
        "Open on the surprising start-to-finish transformation.",
        "Reveal the original material.",
        "Explain the critical operations in their real order.",
        "Show why the key transformation steps work.",
        "Finish with the verified end product.",
      ],
    },
    HIDDEN_PROBLEM: {
      label: "Hidden engineering problem",
      bestFor: "Precision manufacturing, engineered materials, electronics, tight tolerances.",
      structure: [
        "Open on an unexpected manufacturing challenge.",
        "Explain why it matters.",
        "Show the steps that address it, in order.",
        "Reveal the machinery or engineering solution.",
        "Finish on how the finished product meets the requirement.",
      ],
    },
    FACTORY_REVEAL: {
      label: "Factory reveal",
      bestFor: "Food, packaging, everyday household products, visually interesting automated lines.",
      structure: [
        "Open on the most interesting verified operation.",
        "Establish what is actually happening.",
        "Explain how the product reaches that stage.",
        "Continue through the remaining stages.",
        "End on the finished product and a meaningful process payoff.",
      ],
    },
  },
  hookStrategies: ["unexpected-transformation", "hidden-difficulty", "intriguing-operation", "counterintuitive-fact", "material-contrast"],
  storyEditor: "You are the story editor of a How It's Made style channel. From the verified research below, decide how this product's process is best told in short vertical videos. The facts and their order are fixed; you choose emphasis.",
  hookIntro: "You write opening lines for a How It's Made style short video. The opening has one or two seconds to make a scrolling viewer understand what they're looking at and want to see how it's done.",
  hookRules: ["names or shows the product (or its raw material) at once, and is concise: at most two short sentences, under 25 words;"],
  hookConnection: "About the real manufacturing process, not a gimmick.",

  audit: {
    intro: "You are an independent fact-checker and editor for a How It's Made style video.",
    temporal: "steps told out of factory order.",
    clarity: "a viewer would be confused about what is being made, where in the process we are, or what a machine does.",
    tone: `jokes, puns, opinions, hype, drama, rhetorical questions, "you", or brand names. Also any framing that breaks the one continuous story: mentioning parts or videos, recaps of earlier parts, "picks up", or announcing what happens next.`,
    looseOpeningNote: `By the producer's choice, the opening line(s) may say "you" and may be one genuine question the video answers. That is not a tone issue there; "you" or a question anywhere after the opening still is.`,
  },
  attention: {
    intro: "You are an independent editor checking whether a How It's Made style short video holds an ordinary viewer's attention. You did not write it. Facts are checked separately; never suggest adding a fact, number, material or machine the research doesn't contain, and never suggest drama, hype, questions to the viewer or superlatives.",
    slowStart: "the narration lingers before the manufacturing process begins.",
    stall: "two or more sentences in a row where nothing visibly happens to the material (storage, sampling, checks, rules), so there is nothing new to watch.",
  },

  storyboard: {
    role: "You are the storyboard artist for a narrated, stick-figure illustrated How It's Made style video. The script is final; you never change it.",
    visualState: `the physical facts every illustration must respect. setting: the factory areas this part shows. timeAndLight: factory lighting. weather: "indoors". heroSituation: the product's state as it moves through this part (what it looks like at the start and at the end). heroLook: the workers (plain stick figures in work clothes and safety gear) and the key machines. rules: what holds in every shot.`,
    shots: [
      "Each shot shows exactly the step its narration describes: the material, the machine doing its job, a worker's hands, the product at that stage. Never show a step the narration doesn't describe.",
      "Vary the framing: wide shots of the line, medium shots of a machine, close-ups of the material and the product. Never two near-identical framings in a row.",
      "The material is the star: in most shots the material and the machine working on it fill the frame, with at most a worker's gloved hands. A whole worker appears in at most one shot in three, and only when a person does the step. Never a worker just standing beside a machine.",
    ],
    motion: "slow-zoom-in for detail, pan for a moving line, still for a finished result.",
    stepLabel: `the manufacturing step the shot belongs to, 2–4 plain words in sentence case, shown on screen (e.g. "Melting the wax", "Filling the moulds"). Consecutive shots of one step use exactly the same words; a new label only when the process moves on. Plain words, never an industry name. A shot that previews a later step (an opening hook) takes the label of the step it shows.`,
    firstShot: "the single most striking picture its narration allows, close and simple, the material or machine filling the frame.",
    firstShotMotion: "",
    onScreen: {
      part1: "the surprising contrast between what the product starts as and what it becomes",
      later: "the most surprising thing this video shows happening",
      examples: `concrete things first (the material, the product), e.g. "This *goo* becomes gummy bears" or "Crayons start as *hot liquid*"`,
    },
  },
  soundEffects: ["conveyor", "machine", "mixer", "bubbling", "furnace", "pour", "press", "hiss", "cut", "clatter", "clunk", "spray", "wrap", "packing"],
  music: {
    key: "music:default",
    name: "Default music bed (generated)",
    prompt:
      "Light, curious instrumental background music for a calm factory explainer video: soft plucked synths, gentle mallets and light percussion, steady mid tempo, unobtrusive under a narrator, consistent energy with no drops or big build-ups so it loops cleanly. No vocals.",
  },
  post: {
    kind: "a How It's Made style channel",
    hashtags: "Mix one or two broad ones (manufacturing, factory, how it's made) with specific ones for the product and the process.",
    cover: "the product or its raw material, instantly recognisable",
  },
};

// ── What happens when… (The Invisible World) ─────────────────────────

const INVISIBLE: WritingStyle = {
  kind: `"What happens when…" explainer video`,
  subject: "everyday moment",
  order: "the order it happens",
  defaults: { styleKey: "invisible-cutaway", targetDurationSec: 45, minParts: 1, maxParts: 1 },
  topicDiscovery: false,
  looseOpening: false,
  allowsQuestions: true,
  researchingLabel: "Researching what really happens",

  channelDesign:
    "Every channel shows what really happens behind an everyday moment people never get to see (inside the body, under the street, behind the walls, inside machines and networks), researched on the web before writing. Each subject is usually one standalone video of 30–45 seconds that opens on its most surprising moment.",
  designVoice:
    'Talks to the viewer as "you", in the present tense, as if it is happening now; curious, quick and strictly factual, with one or two deadpan, slightly awkward asides per video; never "we" or "I". Never a third-person narrator, and never forbid humor.',
  pitchRules: `What makes a strong idea:
- One everyday moment the viewer has lived hundreds of times (drinking coffee, flushing, tapping a card, checking a bag, sneezing) with a hidden journey behind it they have never seen.
- Something real that moves or changes through several distinct stages, each one possible to draw.
- At least one moment that makes people say "wait, really?", and that credible sources back.
- A plain title naming the moment, e.g. "What Happens When You Drink Coffee" or "Where Your Flush Goes".
Never: brand names or named companies, medical advice or treatment claims, gore, fear-mongering, conspiracy theories, myths told as facts, or more than one moment per pitch.`,
  pitchArc: "the real stages in the order they happen, from the everyday moment to where the journey ends",
  pitchIdea: `Every pitch is exactly this moment at the same scope, told as the whole journey from the moment itself to where it ends. Never narrow it to one stage, one ingredient, one organ, one side effect or one special case (for "What happens when you drink coffee": not "Why coffee makes you need the bathroom" or "What caffeine does to your heart"). The title is the producer's idea in plain words, e.g. "What Happens When You Drink Coffee". Pitches differ only in how they tell it: which shocking true fact opens the video, which surprises they build to, and how far the journey goes.`,
  pitchIdeaPick: "A pitch that drifts from it, or narrows it to one part, one stage or one side effect of it, is out; prefer the pitch with the most shocking true opening.",

  researchSearch: `You are the researcher for short factual explainer videos about what really happens, step by step, behind an everyday moment people never get to see: inside the body, under the street, behind the walls, inside machines and networks. Use web search to find out exactly what happens, in order, from the everyday moment that starts it to where it ends.

For each stage give concrete, checkable details: what moves where, what changes and how, how long it takes, how far it travels, how much, how fast. Look especially for facts an ordinary person would find surprising, and check them. Prefer medical and scientific institutions, universities, government agencies, utilities, airports and transport authorities, payment networks and industry bodies, and encyclopedias. Say plainly where sources disagree, where a detail varies a lot between people or places, or where it could not be found. Do not guess. Cite your sources.`,
  researchNotes: (minStages) => `mainRoute: the most common case today, in one plain sentence (e.g. "a healthy adult drinking one cup of coffee", "a home connected to a city sewer"). The stages follow that case; mention other cases in a step only where they matter.
Split what happens into ${minStages}–8 stages in the order they happen (the everyday moment first, where the journey ends last), each a distinct place or change a viewer could picture, with its own steps. Put the surprising specifics (times, distances, speeds, amounts) in details.`,

  voice: `Who it's for: ordinary adults scrolling short videos. They know the everyday moment (a sip of coffee, a flush, a card tap) and have never seen what happens behind it. If a viewer would have to look up a word, the script has failed.

How the narration sounds:
- Talks to the viewer with "you" and "your", in the present tense, as if it is happening right now ("You take a sip. Within minutes, caffeine is in your blood."). Never "we" or "I".
- Curious, quick and warm, like a friend telling you something they just found out. Strictly factual: the surprise comes from the facts themselves, never from hype words, drama or exaggeration.
- A bit of awkward, deadpan humor: one or two dry asides per video about what your body or the system is "thinking" or how unglamorous it really is ("Your brain has no idea it's been tricked. It just feels great about it."). Said flatly, as a fact-adjacent observation; never a pun, never at anyone's expense, never gross or crude, and never changing or adding a fact.
- Follow one thing on its journey (the caffeine, the water, the bag, the payment) and keep it the subject of the sentences. The viewer always knows where it is now and what is happening to it.
- Describe things, don't name them: "a chemical that builds up while you're awake and makes you sleepy", not its scientific name. Use a name only when it is an everyday word ("stomach", "pipe", "card reader").
- Help the viewer picture size, speed and time with everyday comparisons ("faster than a blink", "about a bathtub's worth"). Comparisons describe what things are like; they never add facts.
- One or two striking numbers per video at most, said so they mean something. Never a run of figures, ranges or alternatives.
- Short, spoken sentences. Never list more than three things in a row. No colons, semicolons or parentheses.
- At most one question, and only as the opening (a shocking statement usually hooks harder). No medical advice, no warnings, no brand names or named companies.`,
  plan: ({ parts, durationSec, reach }) => `You plan a short "What happens when…" explainer, told in ${parts[0] === parts[1] ? parts[0] : `${parts[0]}–${parts[1]}`} video${parts[1] > 1 ? "s" : ""} of about ${durationSec} seconds each.

{CHANNEL}

Assign the research's stages, in the order they happen, to consecutive parts. ${parts[1] > 1 ? `Use more than one part only when there is too much for ${durationSec} seconds; each part must stand on its own and contain at least one surprising moment.` : "There is one video: it tells the whole journey."} Never split a stage. The opening line is a short summary of where the journey starts.${reach ? ` Its opening hook promises ${reach.id} (${reach.name}), so Part 1 must run through ${reach.id}.` : ""}`,
  narration: {
    plainOpening: (opening) =>
      `Open on the most shocking true thing happening inside, as one vivid line that says where, what and what it's doing (like "Inside your brain, caffeine occupies spots that normally catch a tiredness message."), then start the journey: ${opening}`,
    afterHook: (opening) => `then go straight to the everyday moment where the journey starts (${opening}) and follow it in the order it happens`,
    body: (stages) => [
      `Follow the subject through this video's stages (${stages.join(", ")}) in the order they happen, a sentence or two per stage, folding small steps together. Never skip a step a later one depends on.`,
      "Every sentence shows the viewer something they couldn't see: where the subject is now, what is happening to it, how fast or how far. Background, history, caveats, \"in some cases\" and how it differs between people or places get no sentences.",
      "Make it one flowing chain: each sentence picks up where the last one left the subject. Join stages with plain links (\"from there\", \"seconds later\", \"meanwhile\").",
      "Give the featured moment the most room: it is the reason to watch.",
      "Follow the main case only, silently. Never mention other cases or exceptions.",
    ],
    ending: (patternEnd) =>
      `End where the journey ends, with one last line that lands the payoff or makes the viewer see the everyday moment differently. No summary, no "and that's how", no call to follow or comment.${patternEnd ? ` ${patternEnd}` : ""}`,
  },
  sceneRewrite: `Rewrite ONE shot of an existing "What happens when…" explainer script.`,

  patterns: {
    TRANSFORMATION: {
      label: "Journey",
      bestFor: "Something that travels and changes: food and drink through the body, water through pipes, a bag through an airport.",
      structure: [
        "Open on the most surprising point of the journey.",
        "Go back to the everyday moment where it starts.",
        "Follow it stage by stage, in order.",
        "Linger on the moment it changes most.",
        "End where it ends up, with one final surprise.",
      ],
    },
    HIDDEN_PROBLEM: {
      label: "Hidden problem",
      bestFor: "Systems that quietly solve something hard in an everyday moment: a payment in two seconds, thousands of bags sorted, breathing while you sleep.",
      structure: [
        "Open on the hard problem hiding inside an everyday moment.",
        "Say why it's hard, plainly.",
        "Show the steps that solve it, in order.",
        "Reveal the clever part.",
        "End back on the everyday moment, now seen differently.",
      ],
    },
    FACTORY_REVEAL: {
      label: "Inside reveal",
      bestFor: "Your own body and familiar moments with a surprising inside: sneezes, sleep, hiccups, goosebumps, a yawn.",
      structure: [
        "Open on what is really happening at the most surprising moment.",
        "Establish the everyday moment the viewer knows.",
        "Show how it builds up to that moment.",
        "Continue through what happens after.",
        "End on the payoff.",
      ],
    },
  },
  hookStrategies: ["shocking-inside-fact", "counterintuitive-fact", "hidden-journey", "surprising-speed-or-scale", "what-you-never-see"],
  storyEditor:
    'You are the story editor of a "What happens when…" channel. From the verified research below, decide how this moment is best told in one short vertical video. The facts and their order are fixed; you choose emphasis.',
  hookIntro: `You write opening lines for a "What happens when…" short video. The opening has one or two seconds to stop a scrolling thumb, so it lands the most shocking true thing first, as a vivid picture of what is happening inside you (or inside the pipe, the machine, the network) right now.
The model to beat: "Inside your brain, caffeine occupies spots that normally catch a tiredness message." It names a hidden place, the thing there, and what it is doing, and it makes the viewer go "wait, what?" without a single hype word.`,
  hookRules: [
    `leads with the shock itself, not a setup: a hidden place, the thing there, and what it is doing, in concrete words ("Inside your brain…", "Under your street…", "Two seconds after you tap…"); at most two short sentences, under 20 words;`,
    'talks to the viewer ("you", "your"); a statement is usually stronger, but it may be one short, genuine question this video answers (never "we", "I", "Did you know" or "Have you ever wondered");',
    `never vague teasers ("You won't believe…", "Something strange happens…") and never hype words: the fact does the work;`,
    "firstFrameVisual: the person (or the toilet, the bag, the card) seen from outside, cut away to show the exact inside place the line is about, with the glowing subject there; the camera dives into it.",
  ],
  hookConnection: "About what really happens, not a gimmick.",

  audit: {
    intro: 'You are an independent fact-checker and editor for a "What happens when…" explainer video.',
    temporal: "stages told out of the order they really happen (an opening that previews the surprising moment is intended).",
    clarity: "a viewer would be confused about what is being followed, where it is now, or what is happening to it.",
    tone: `hype, exaggeration, drama, fear, opinions, medical advice, brand names, "we" or "I", or more than one question. Talking to the viewer with "you" is intended. One or two deadpan asides (e.g. "Your brain has no idea it's been tricked.") are intended too: flag a joke only if it is a pun, mean, gross or crude, there are more than two, or it states something the research doesn't support as fact. Playful personification ("your brain thinks…") is a figure of speech, not a claim. Also mentioning parts or videos, or announcing what comes next.`,
    looseOpeningNote: "",
  },
  attention: {
    intro:
      'You are an independent editor checking whether a short "What happens when…" video holds an ordinary viewer\'s attention. You did not write it. Facts are checked separately; never suggest adding a fact or number the research doesn\'t contain, and never suggest hype, drama or superlatives. An opening that sets up instead of landing the most shocking true thing in its first line is a weak opening.',
    slowStart: "the narration lingers before the journey begins.",
    stall: "two or more sentences in a row where the subject doesn't move or change (definitions, background, caveats), so there is nothing new to see.",
  },

  storyboard: {
    role: 'You are the storyboard artist for a narrated, illustrated "What happens when…" video that shows what people never get to see, using cutaway and x-ray views. The script is final; you never change it.',
    visualState: `the physical facts every illustration must respect. setting: the places the journey passes through, from the everyday scene outside to the hidden places inside (e.g. a kitchen, then a cutaway of the stomach, then the bloodstream and the brain). timeAndLight: the everyday scene's light; inside views evenly lit. weather: as in the everyday scene, or "indoors". heroSituation: the subject the video follows, drawn as simple glowing shapes, and how it looks at each stage. heroLook: the viewer's stand-in ("you"), one simple rounded cartoon person who looks the same in every shot, plus the key places or machines. rules: what holds in every shot.`,
    shots: [
      "Each shot shows exactly the moment its narration describes, seen as if skin, walls, pipes and machines were see-through. Never show a stage the narration doesn't describe.",
      "Mix three kinds of shot: the everyday outside view (you sipping, the toilet flushing, the bag at the desk), cutaways that open it up to show the inside, and close-ups of the subject at its most interesting moment. Start outside, go inside, and come back outside at the end when the narration does.",
      "The subject the video follows is in every shot after the opening: the brightest thing, easy to spot. Say in imagePrompt what it is, where it is and what it is doing.",
      'The "you" character looks the same in every shot it appears in (heroLook). Never more than three people in a shot.',
    ],
    motion: "dive-in for shot 1 only (a fast dive into the inside), slow-zoom-in to go deeper inside, pan to follow the subject along a path (a pipe, the bloodstream, a belt), slow-zoom-out to reveal the bigger picture, still for a result.",
    stepLabel: `where the subject is or what is happening to it now, 2–4 plain words in sentence case, shown on screen (e.g. "Into your stomach", "Under the street", "Reaching the brain"). Consecutive shots of one stage use exactly the same words; a new label only when the journey moves on. A shot that previews a later moment (an opening hook) takes the label of the moment it shows.`,
    firstShot:
      "the person (or the toilet, the bag, the card reader) seen from outside, cut away to reveal the exact inside place the opening line is about, with the glowing subject there. Its motionPreset is dive-in: the camera dives into that spot.",
    firstShotMotion: "Shot 1's motionPreset is dive-in, so the camera dives into the inside place the opening line is about.",
    onScreen: {
      part1: "the question or surprise the video answers",
      later: "the most surprising thing this video shows",
      examples: `the shock in plain words, e.g. "Caffeine is *blocking* your brain" or "Your flush travels *miles*"`,
    },
  },
  soundEffects: ["gulp", "heartbeat", "flow", "drip", "flush", "whoosh", "beep", "electric", "crowd", "hiss", "pour", "conveyor", "machine", "clunk", "spray", "bubbling"],
  music: {
    key: "music:invisible",
    name: "Invisible World music bed (generated)",
    prompt:
      "Curious, slightly mysterious instrumental background music for a science explainer about hidden things: soft pulsing synths, light plucks and airy pads, gentle steady beat, mid tempo, unobtrusive under a narrator, consistent energy with no drops or big build-ups so it loops cleanly. No vocals.",
  },
  post: {
    kind: 'a "What happens when…" explainer channel',
    hashtags: "Mix one or two broad ones (howitworks, science, explained) with specific ones for the subject.",
    cover: "the glowing subject at its most surprising moment, or the everyday moment it starts from",
  },
};

export const WRITING_STYLES: Record<ChannelFormat, WritingStyle> = {
  PROCESS_EXPLAINER: HOW_ITS_MADE,
  INVISIBLE_EXPLAINER: INVISIBLE,
};

export function writingStyle(format: ChannelFormat | string | null | undefined): WritingStyle {
  return WRITING_STYLES[format as ChannelFormat] ?? HOW_ITS_MADE;
}

/** Every hook strategy any style uses, for the hook schema. */
export const ALL_HOOK_STRATEGIES = [...new Set(Object.values(WRITING_STYLES).flatMap((s) => s.hookStrategies))] as [string, ...string[]];
