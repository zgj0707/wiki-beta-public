export const MECHANISM_SYNC_STATE_VERSION = 'mechanism-sync-v1';

function revisionList(item) {
  if (Array.isArray(item?.revisions)) return item.revisions;
  return [item?.latestPending, item?.publishedRevision, item?.latestRejected]
    .filter(Boolean);
}

function newestRevision(item, status) {
  return revisionList(item)
    .filter((revision) => revision?.reviewStatus === status)
    .sort((left, right) => {
      const leftDate = new Date(left.createdAt || left._createdAt || 0).getTime();
      const rightDate = new Date(right.createdAt || right._createdAt || 0).getTime();
      return rightDate - leftDate;
    })[0] || null;
}

function pendingRevision(item) {
  return item?.latestPending || newestRevision(item, 'pending');
}

function publishedRevision(item) {
  return item?.publishedRevision || newestRevision(item, 'approved');
}

function rejectedRevision(item) {
  return item?.latestRejected || newestRevision(item, 'rejected');
}

function sameHash(left, right) {
  return Boolean(left && right && left.contentHash === right.contentHash);
}

function withSourceStatusTransition(existing, decision) {
  return {
    ...decision,
    restoreSourceStatus: existing?.sourceStatus === 'missing',
  };
}

/**
 * Returns the state transition for one parsed source item. This function is
 * deliberately storage-agnostic so a dry-run can use the exact same rules as
 * a write run without touching the database.
 */
export function classifyMechanismSync({ incoming, existing = null }) {
  if (!existing) {
    return {
      action: 'create_item_and_pending',
      reason: 'new_item',
      publicVersionUnchanged: true,
    };
  }

  const pending = pendingRevision(existing);
  const published = publishedRevision(existing);
  const rejected = rejectedRevision(existing);

  if (sameHash(pending, incoming)) {
    return withSourceStatusTransition(existing, {
      action: 'update_source_only',
      reason: 'unchanged_pending',
      publicVersionUnchanged: true,
    });
  }
  if (sameHash(published, incoming)) {
    return withSourceStatusTransition(existing, {
      action: 'update_source_only',
      reason: 'unchanged_published',
      publicVersionUnchanged: true,
    });
  }
  if (sameHash(rejected, incoming)) {
    return withSourceStatusTransition(existing, {
      action: 'update_source_only',
      reason: 'unchanged_rejected',
      publicVersionUnchanged: true,
    });
  }

  return withSourceStatusTransition(existing, {
    action: pending ? 'supersede_pending_and_create_pending' : 'create_pending',
    reason: published ? 'published_changed' : 'source_changed',
    supersededRevisionId: pending?.id || null,
    publicVersionUnchanged: true,
  });
}

function isFallbackStableKey(value) {
  return String(value || '').startsWith('feishu-block:');
}

function findExisting(existingItems, incoming) {
  const exact = existingItems.find((item) => item.stableKey === incoming.stableKey || item.contentDocId === incoming.contentDocId);
  if (exact) return { item: exact, identityUpgradeSuggested: false };
  const blockMatch = incoming.sourceBlockId
    ? existingItems.find((item) => item.sourceBlockId === incoming.sourceBlockId)
    : null;
  if (blockMatch && isFallbackStableKey(blockMatch.stableKey) && !isFallbackStableKey(incoming.stableKey)) {
    return { item: blockMatch, identityUpgradeSuggested: true };
  }
  return { item: null, identityUpgradeSuggested: false };
}

/**
 * Plans all source-to-storage transitions, including one-pass missing-source
 * detection. It never changes a content id when a fallback block identity is
 * later upgraded to a canonical URL.
 */
export function planMechanismSync({ sourceItems = [], existingItems = [], sourceId = null, sourceRevision = null } = {}) {
  const actions = [];
  const seenExistingIds = new Set();
  const identityUpgradeSuggested = [];
  const parseWarnings = [];

  for (const incoming of sourceItems) {
    const match = findExisting(existingItems, incoming);
    const decision = classifyMechanismSync({ incoming, existing: match.item });
    if (match.item?.id) seenExistingIds.add(match.item.id);
    if (match.identityUpgradeSuggested) {
      identityUpgradeSuggested.push({
        existingItemId: match.item.id || null,
        existingStableKey: match.item.stableKey,
        incomingStableKey: incoming.stableKey,
        sourceBlockId: incoming.sourceBlockId,
      });
    }
    if (Array.isArray(incoming.parseWarnings)) parseWarnings.push(...incoming.parseWarnings);
    actions.push({
      incoming,
      existing: match.item,
      ...decision,
      identityUpgradeSuggested: match.identityUpgradeSuggested,
    });
  }

  const missingItems = existingItems
    .filter((item) => (!sourceId || item.sourceId === sourceId) && item.sourceStatus !== 'archived' && item.id && !seenExistingIds.has(item.id))
    .map((item) => ({
      itemId: item.id,
      stableKey: item.stableKey,
      contentDocId: item.contentDocId,
      previousStatus: item.sourceStatus || 'active',
      action: 'mark_missing_needs_review',
      publicVersionUnchanged: true,
    }));

  const newItems = actions.filter((action) => action.action === 'create_item_and_pending').length;
  const changedItems = actions.filter((action) => ['create_pending', 'supersede_pending_and_create_pending'].includes(action.action)).length;
  const unchangedItems = actions.filter((action) => action.action === 'update_source_only').length;
  const supersededPending = actions.filter((action) => action.action === 'supersede_pending_and_create_pending').length;

  return {
    version: MECHANISM_SYNC_STATE_VERSION,
    sourceId,
    sourceRevision,
    actions,
    missingItems,
    newItems,
    changedItems,
    unchangedItems,
    supersededPending,
    missingCount: missingItems.length,
    identityUpgradeSuggested,
    parseWarnings: [...new Set(parseWarnings)],
    databaseWrites: 0,
  };
}

/**
 * Manual profile fields are authoritative once completed. A pending source
 * candidate may fill only an incomplete profile.
 */
export function preserveManualProfile(existingProfile, generatedFields) {
  if (existingProfile?.manualCompleted) return { ...existingProfile, preservedManualFields: true };
  return { ...(existingProfile || {}), ...(generatedFields || {}), preservedManualFields: false };
}

/**
 * A manually locked claim keeps its public text while retaining the latest
 * source-derived text for review. Unlocked claims can be replaced by the
 * approved candidate in a later publishing transaction.
 */
export function classifyMechanismClaim({ existing = null, candidateText = '', evidenceText = '' } = {}) {
  const text = String(candidateText || '').trim();
  if (!text) return { action: 'skip', reason: 'empty_candidate' };
  if (!existing) {
    return {
      action: 'create',
      claimText: text,
      autoDetectedText: text,
      sourceExcerpt: evidenceText,
      sourceChanged: false,
    };
  }
  if (existing.autoDetectedText === text && existing.sourceExcerpt === evidenceText) {
    return { action: 'skip', reason: 'unchanged' };
  }
  if (existing.manualLocked) {
    return {
      action: 'update_auto_only',
      claimText: existing.claimText,
      autoDetectedText: text,
      sourceExcerpt: evidenceText,
      sourceChanged: true,
    };
  }
  return {
    action: 'update_candidate',
    claimText: text,
    autoDetectedText: text,
    sourceExcerpt: evidenceText,
    sourceChanged: false,
  };
}

export function isPublishedMechanism({ item, content }) {
  return Boolean(
    item?.publishedRevisionId
      && content?.contentKind === 'game_mechanism'
      && content?.reviewStatus === 'approved'
      && content?.isArchived !== true,
  );
}
