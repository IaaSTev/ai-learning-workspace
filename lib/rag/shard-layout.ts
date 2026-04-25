import type { RagManifestV1 } from "./types";

/** Safe filename segment from a topic label (lecture shard key). */
export function topicToSlug(topic: string): string {
  const t = topic.trim().toLowerCase();
  const s = t.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return s || "general";
}

export function topicShardRelativePath(slug: string): string {
  if (slug === "general") return "general.json";
  return `topic-${slug}.json`;
}

export function emptyManifest(courseId: string): RagManifestV1 {
  return {
    version: 1,
    courseId,
    lectureShards: [],
    hasGeneral: false,
    updatedAt: Date.now(),
  };
}

/**
 * Pick shard files to load for retrieval (no JSON loading of chunk data here).
 * - Always include syllabus when present (small structural layer).
 * - Include topic shards that match sessionTopic (fuzzy).
 * - Include general.json when session is empty/General, or as fallback when no topic shard matched.
 */
export function selectShardRelativePaths(options: {
  manifest: RagManifestV1;
  sessionTopic: string;
  syllabusPresent: boolean;
  maxTopicShards: number;
}): { paths: string[]; reasons: string[] } {
  const { manifest, sessionTopic, syllabusPresent, maxTopicShards } = options;
  const paths: string[] = [];
  const reasons: string[] = [];

  if (syllabusPresent) {
    paths.push("syllabus.json");
    reasons.push("syllabus (structure)");
  }

  const st = sessionTopic.trim();
  const stSlug = topicToSlug(st);

  const matchedSlugs = new Set<string>();
  if (st) {
    const stLower = st.toLowerCase();
    for (const row of manifest.lectureShards) {
      const label = row.label.trim().toLowerCase();
      const slug = row.slug;
      if (slug === stSlug) {
        matchedSlugs.add(slug);
      } else if (
        label &&
        (label === stLower ||
          label.includes(stLower) ||
          stLower.includes(label))
      ) {
        matchedSlugs.add(slug);
      }
      if (matchedSlugs.size >= maxTopicShards) break;
    }
  }

  if (st && matchedSlugs.size > 0) {
    for (const slug of matchedSlugs) {
      const rel = topicShardRelativePath(slug);
      paths.push(rel);
      reasons.push(`topic match → ${rel}`);
    }
  } else if (!st) {
    if (manifest.hasGeneral) {
      paths.push("general.json");
      reasons.push("empty sessionTopic → general");
    }
  } else {
    if (manifest.hasGeneral) {
      paths.push("general.json");
      reasons.push("no topic shard match → general fallback");
    } else if (manifest.lectureShards.some((r) => r.slug === stSlug)) {
      const rel = topicShardRelativePath(stSlug);
      paths.push(rel);
      reasons.push(`exact slug → ${rel}`);
    }
  }

  return { paths: dedupe(paths), reasons };
}

function dedupe(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}
