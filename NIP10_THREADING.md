# NIP-10 Threading Implementation for Primal Compatibility

## Changes Made for Client Compatibility

### 1. NIP-10 Compliant Reply Tags

**Before (Basic Tagging):**
```javascript
tags: [
  ['e', parentId],
  ['p', parentPubkey]
]
```

**After (NIP-10 Markers):**
```javascript
// Direct reply to original post:
tags: [
  ['e', originalPostId, '', 'root'],
  ['p', originalAuthor],
  ['p', ...otherParticipants]
]

// Reply to a reply:
tags: [
  ['e', threadRootId, '', 'root'],
  ['e', immediateParentId, '', 'reply'], 
  ['p', immediateParentAuthor],
  ['p', ...allThreadParticipants]
]
```

### 2. Thread Root Discovery

- **findThreadRoot()**: Traces back to find the original post in a thread
- Looks for existing "root" markers first
- Falls back to legacy e-tag format for backwards compatibility
- Ensures proper thread hierarchy even in complex reply chains

### 3. Participant Tracking

- **gatherThreadParticipants()**: Collects all users involved in a thread
- Includes the immediate parent author
- Preserves all existing p-tag participants from parent events
- Ensures proper notifications across the entire conversation

### 4. Improved Thread Relationship Building

- **buildThreadRelationships()**: Updated to read NIP-10 markers
- Prioritizes "reply" markers for parent identification
- Falls back to positional e-tags for legacy compatibility
- Maintains existing visual threading in Sidecar

## NIP-10 Benefits for Client Compatibility

✅ **Primal Compatibility**: Now generates events that Primal can thread properly

✅ **Standard Compliance**: Follows official NIP-10 specification  

✅ **Multi-level Threading**: Supports replies to replies with proper root tracking

✅ **Participant Notifications**: All thread participants get notified via p-tags

✅ **Legacy Support**: Still reads older non-marker tagged events

✅ **Cross-Client Consistency**: Events will thread properly in most modern Nostr clients

## Threading Examples

### Direct Reply
User A posts → User B replies
```
B's reply tags: [['e', A_post_id, '', 'root'], ['p', A_pubkey]]
```

### Reply to Reply  
User A posts → User B replies → User C replies to B
```
C's reply tags: [
  ['e', A_post_id, '', 'root'],
  ['e', B_reply_id, '', 'reply'], 
  ['p', B_pubkey],
  ['p', A_pubkey]
]
```

This ensures that clients like Primal can:
- Display C's reply under B's reply
- Show the entire thread rooted at A's original post
- Notify both A and B about C's participation
- Maintain proper conversation context

## Testing

The threading now generates events that should display correctly in:
- ✅ Sidecar (nested visual threading)  
- ✅ Primal (proper thread detection)
- ✅ Damus (NIP-10 compliant)
- ✅ Amethyst (marker-aware)
- ✅ Other NIP-10 compliant clients