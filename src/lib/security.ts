const SECRET_PATTERNS = [
  /ghp_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-ant-[A-Za-z0-9\-_]{20,}/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
];

/** Strip tokens/credentials from any string that might reach logs or HTTP clients. */
export function redactSecrets(input: string): string {
  let out = input;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

export function publicErrorMessage(error: unknown, fallback = "internal_error"): string {
  if (!(error instanceof Error)) return fallback;
  return redactSecrets(error.message).slice(0, 280);
}
