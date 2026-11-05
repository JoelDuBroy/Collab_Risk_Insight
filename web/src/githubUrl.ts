/** Accepts `owner`, `repo`, or a full GitHub URL pasted into either field. */
export function parseGithubInput(ownerRaw: string, repoRaw: string): {
  owner: string;
  repo: string;
} {
  const combined = `${ownerRaw} ${repoRaw}`.trim();
  const urlMatch = combined.match(
    /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i,
  );
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2].replace(/\.git$/i, "") };
  }

  const slash = repoRaw.trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (slash) {
    return { owner: slash[1], repo: slash[2].replace(/\.git$/i, "") };
  }

  return {
    owner: ownerRaw.trim(),
    repo: repoRaw.trim().replace(/\.git$/i, ""),
  };
}
