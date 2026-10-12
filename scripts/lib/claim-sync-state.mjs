export function classifyClaimSync({ existing, candidate }) {
  if (!existing) {
    return candidate
      ? { action: 'create', candidate }
      : { action: 'skip', reason: 'no_candidate' };
  }

  if (!candidate) return { action: 'skip', reason: 'no_candidate' };

  const changed = existing.autoDetectedText !== candidate.text
    || existing.sourceExcerpt !== candidate.sourceExcerpt
    || existing.extractionRule !== candidate.rule
    || existing.extractionVersion !== candidate.version;
  if (!changed) return { action: 'skip', reason: 'unchanged' };

  if (existing.manualLocked) {
    return { action: 'update_locked', candidate, sourceChanged: true };
  }

  return { action: 'update_auto', candidate, sourceChanged: false };
}
