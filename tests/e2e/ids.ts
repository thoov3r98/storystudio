import { readFileSync } from "node:fs";
import path from "node:path";

export function seedIds(): { storyId: string; episodeId: string; batchId: string; scriptedEpisodeId: string } {
  return JSON.parse(readFileSync(path.join(__dirname, ".seed.json"), "utf8"));
}
