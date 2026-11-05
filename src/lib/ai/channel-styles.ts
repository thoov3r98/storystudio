import type { ChannelFormat } from "@/lib/schemas/channel";
import { SOUND_EFFECTS, type SoundEffectKey } from "@/lib/constants";

/*
 * Channel styles: how a channel's pasted scripts are storyboarded, which sounds
 * and music bed they get, and how their post text reads. A channel's `format`
 * picks one; its own description (profile.visuals) then steers the storyboard on top.
 * Every new channel is CUSTOM. How It's Made and What happens when… are kept for
 * the channels made with them.
 */

export type ChannelStyle = {
  /** How the prompts name this kind of video, e.g. "How It's Made style video". */
  kind: string;
  /** Default illustration style for a new channel of this kind. */
  defaults: { styleKey: string };
  /** A question is a natural on-screen hook for this kind of video. */
  allowsQuestions: boolean;
  storyboard: {
    role: string;
    visualState: string;
    shots: string[];
    motion: string;
    stepLabel: string;
    firstShot: string;
    onScreen: { part1: string; later: string; examples: string };
  };
  soundEffects: readonly SoundEffectKey[];
  /** The music bed generated once when no track is chosen. */
  music: { key: string; name: string; prompt: string };
  post: { kind: string; hashtags: string; cover: string };
};

// ── How It's Made ─────────────────────────────────────────────────────

const HOW_ITS_MADE: ChannelStyle = {
  kind: "How It's Made style video",
  defaults: { styleKey: "stick-figure-color" },
  allowsQuestions: false,

  storyboard: {
    role: "You are the storyboard artist for a narrated, stick-figure illustrated How It's Made style video. The narration is the producer's own and final; you never change a word.",
    visualState: `the physical facts every illustration must respect. setting: the factory areas this part shows. timeAndLight: factory lighting. weather: "indoors". heroSituation: the product's state as it moves through this part (what it looks like at the start and at the end). heroLook: the workers (plain stick figures in work clothes and safety gear) and the key machines. rules: what holds in every shot.`,
    shots: [
      "Each shot shows exactly the step its narration describes: the material, the machine doing its job, a worker's hands, the product at that stage. Never show a step the narration doesn't describe.",
      "Vary the framing: wide shots of the line, medium shots of a machine, close-ups of the material and the product. Never two near-identical framings in a row.",
      "The material is the star: in most shots the material and the machine working on it fill the frame, with at most a worker's gloved hands. A whole worker appears in at most one shot in three, and only when a person does the step. Never a worker just standing beside a machine.",
    ],
    motion: "slow-zoom-in for detail, pan for a moving line, still for a finished result.",
    stepLabel: `the manufacturing step the shot belongs to, 2–4 plain words in sentence case, shown on screen (e.g. "Melting the wax", "Filling the moulds"). Consecutive shots of one step use exactly the same words; a new label only when the process moves on. Plain words, never an industry name. A shot that previews a later step (an opening hook) takes the label of the step it shows.`,
    firstShot: "the single most striking picture its narration allows, close and simple, the material or machine filling the frame.",
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

const INVISIBLE: ChannelStyle = {
  kind: `"What happens when…" explainer video`,
  defaults: { styleKey: "invisible-cutaway" },
  allowsQuestions: true,

  storyboard: {
    role: 'You are the storyboard artist for a narrated, illustrated "What happens when…" video that shows viewers what is really going on behind something in their lives. The narration is the producer’s own and final; you never change a word.',
    visualState: `the facts every illustration must respect. setting: the real places the video passes through, as the narration names them (e.g. a kitchen, then inside the stomach; or a bedroom, then the Capitol, then a courtroom). timeAndLight: the light in those places. weather: as in the outside scenes, or "indoors". heroSituation: what the video follows and how it looks at each stage; a hidden physical subject (caffeine, water, a nerve signal) is drawn as simple glowing shapes, while people, institutions and events are drawn as themselves. heroLook: the viewer's stand-in ("you"), one simple rounded cartoon person who looks the same in every shot, plus the real places that recur and each real, named person as they actually look (age, build, skin tone, hair, face, glasses, usual clothes). rules: what holds in every shot.`,
    shots: [
      "Each shot shows exactly the moment its narration describes. Never show a stage the narration doesn't describe.",
      "Show the real world: the actual people, places, objects and actions the narration talks about (lawmakers voting in a chamber, a president signing at a desk, a crowd at a polling place, you drinking coffee). Use a cutaway or x-ray view only when the moment is physically hidden inside something real (a body, a wall, the ground, a pipe under the street).",
      "Never turn an idea, a rule, a power, money, time or a decision into an invented contraption: no conveyors, pipes, gears, tubes, gates, control rooms, signals or machinery that the narration doesn't literally describe. A blocked law is lawmakers voting no or a bill set aside on a desk, not a gate stopping a glowing packet.",
      "Mix outside views of the everyday moment with close-ups of the most interesting detail. A hidden physical subject the video follows is the brightest thing in its shots; say in imagePrompt what it is, where it is and what it is doing.",
      'The "you" character looks the same in every shot it appears in (heroLook). Never more than three people in a shot unless the narration is about a crowd.',
    ],
    motion: "dive-in for shot 1 only (a fast push into the spot the opening line is about), slow-zoom-in for a detail, pan to follow something moving or across a scene, slow-zoom-out to reveal the bigger picture, still for a result.",
    stepLabel: `where the subject is or what is happening to it now, 2–4 plain words in sentence case, shown on screen (e.g. "Into your stomach", "Under the street", "Reaching the brain"). Consecutive shots of one stage use exactly the same words; a new label only when the journey moves on. A shot that previews a later moment (an opening hook) takes the label of the moment it shows.`,
    firstShot:
      "the most striking real picture of what the opening line is about (you at the moment it happens, or the place it happens), big and simple; cut away to the inside only if the opening line is about something physically inside it. Its motionPreset is dive-in: the camera pushes into that spot.",
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

// ── Custom: no preset, the channel's description says what it is ─────

const CUSTOM: ChannelStyle = {
  kind: "short narrated illustrated video",
  defaults: { styleKey: "stick-figure-full-color" },
  allowsQuestions: true,

  storyboard: {
    role: "You are the storyboard artist for a short, narrated, illustrated video. The narration is the producer's own and final; you never change a word.",
    visualState: `the facts every illustration must respect. setting: the real places the video passes through, as the narration names them. timeAndLight: the light in those places. weather: as in the outside scenes, or "indoors". heroSituation: what the video follows and how it looks at each stage. heroLook: the people and things that recur, each described so it looks the same in every shot, including each real, named person as they actually look (age, build, skin tone, hair, face, glasses, usual clothes). rules: what holds in every shot.`,
    shots: [
      "Each shot shows exactly the moment its narration describes: the actual people, places, objects and actions it talks about. Never show something the narration doesn't describe.",
      "Vary the framing: wide shots of the place, medium shots of the action, close-ups of the most interesting detail. Never two near-identical framings in a row.",
      "Never more than three people in a shot unless the narration is about a crowd.",
    ],
    motion: "dive-in for shot 1 only (a fast push into the spot the opening line is about), slow-zoom-in for a detail, pan to follow something moving or across a scene, slow-zoom-out to reveal the bigger picture, still for a result.",
    stepLabel: `what this stretch of the video is about, 2–4 plain words in sentence case, shown on screen. Consecutive shots about the same thing use exactly the same words; a new label only when the video moves on. A shot that previews a later moment (an opening hook) takes the label of the moment it shows.`,
    firstShot: "the most striking picture of what the opening line is about, big and simple. Its motionPreset is dive-in: the camera pushes into that spot.",
    onScreen: {
      part1: "the question or surprise the video answers",
      later: "the most surprising thing this video shows",
      examples: `the surprise in plain words, naming the concrete subject, e.g. "Your phone is *listening* less than you think"`,
    },
  },
  soundEffects: Object.keys(SOUND_EFFECTS) as SoundEffectKey[],
  music: {
    key: "music:custom",
    name: "Neutral music bed (generated)",
    prompt:
      "Warm, lightly curious instrumental background music for a narrated short video: soft synths, gentle plucks and light percussion, steady mid tempo, unobtrusive under a narrator, consistent energy with no drops or big build-ups so it loops cleanly. No vocals.",
  },
  post: {
    kind: "a short-video channel",
    hashtags: "Mix one or two broad ones with specific ones for the subject.",
    cover: "the video's subject at its most striking moment, instantly recognisable",
  },
};

export const CHANNEL_STYLES: Record<ChannelFormat, ChannelStyle> = {
  PROCESS_EXPLAINER: HOW_ITS_MADE,
  INVISIBLE_EXPLAINER: INVISIBLE,
  CUSTOM,
};

export function channelStyle(format: ChannelFormat | string | null | undefined): ChannelStyle {
  return CHANNEL_STYLES[format as ChannelFormat] ?? HOW_ITS_MADE;
}
