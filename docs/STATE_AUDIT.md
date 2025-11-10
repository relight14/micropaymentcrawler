# State Management Audit - AppState vs ProjectStore

## Executive Summary
AppState and ProjectStore currently have **overlapping responsibilities** for managing selectedSources, leading to potential state divergence and synchronization bugs.

## Data Overlap Analysis

### 🔴 CRITICAL OVERLAP - selectedSources

**AppState (app-state.js:29)**
```javascript
this.selectedSources = this._loadFromStorage('selectedSources', []);
```
- **Storage**: sessionStorage (`appState_selectedSources`)
- **Structure**: Array of {id, ...sourceData, selectedAt, conversationId}
- **Methods**: toggleSourceSelection(), isSourceSelected(), getSelectedSources(), removeSelectedSource(), getSelectedSourcesCount(), getSelectedSourcesTotal()
- **Features**: Conversation scoping, persistence, immutable updates

**ProjectStore (project-store.js:13)**
```javascript
selectedSources: []
```
- **Storage**: In-memory only (no persistence)
- **Structure**: Array (structure undefined)
- **Methods**: setSelectedSources()
- **Features**: Subscribe/notify pattern

**Conflict Risk**: HIGH
- UI components may read from one store while managers mutate the other
- OutlineBuilder subscribes to ProjectStore
- SourceManager updates AppState
- No synchronization mechanism

---

## State Ownership Map

### AppState ONLY
| Data | Purpose | Persistence | Notes |
|------|---------|-------------|-------|
| conversationHistory | Chat messages | sessionStorage | ✅ Core chat functionality |
| currentResearchData | Search results | sessionStorage | ✅ Research mode data |
| purchasedItems | Unlocked sources | sessionStorage | ⚠️ DUPLICATE (also in backend DB) |
| purchasedSummaries | Cached summaries | sessionStorage | ✅ UI cache layer |
| currentMode | chat/research/report | In-memory | ✅ UI state |
| conversationId | Conversation scope | sessionStorage | ✅ Scoping mechanism |
| enrichmentStatus | Pricing status | In-memory | ⚠️ Also tracked in TierManager |
| isDarkMode | Theme preference | localStorage | ✅ UI preference |
| isLoginMode | Auth UI state | In-memory | ✅ UI state |
| currentQuery | Active search | In-memory | ✅ Transient state |
| pendingAction | Post-auth action | In-memory | ✅ Flow control |

### ProjectStore ONLY
| Data | Purpose | Persistence | Notes |
|------|---------|-------------|-------|
| activeProjectId | Current project | In-memory | ✅ Project context |
| currentProjectTitle | Project name | In-memory | ✅ Display data |
| projects | Projects list | In-memory | ⚠️ Should persist to DB |
| currentOutline | Outline sections | In-memory | ⚠️ Should persist to DB |

### BOTH (CONFLICT)
| Data | AppState | ProjectStore | Winner Should Be |
|------|----------|--------------|------------------|
| selectedSources | ✅ Persisted, scoped | ❌ In-memory only | **ProjectStore** (closer to outline/project context) |

---

## Synchronization Issues

### Current Event Flow
```
User clicks checkbox
    ↓
SourceManager updates AppState.selectedSources
    ↓
AppState saves to sessionStorage
    ↓
??? No event to ProjectStore ???
    ↓
OutlineBuilder shows stale data (subscribed to ProjectStore)
```

### Evidence of Sync Problems
1. **OutlineBuilder subscribes to ProjectStore** (outline-builder.js)
2. **SourceManager mutates AppState** (source-manager.js)
3. **No bridge between the two stores**

---

## Purchase Tracking Duplication

### Frontend (AppState)
```javascript
purchasedItems: Set(['source-123', 'source-456'])
```

### Backend (ledger_repository)
```sql
SELECT source_id FROM purchases WHERE user_id = ?
```

**Issue**: Same data in two places
- Frontend cache can become stale
- No invalidation mechanism
- Backend is source of truth but not always consulted

---

## Report Status Tracking Duplication

### AppState
```javascript
enrichmentStatus: 'idle' | 'processing' | 'complete'
```

### TierManager
```javascript
// Local flags for pricing status
```

### MessageCoordinator
```javascript
// Report generation loading states
```

**Issue**: Three places tracking overlapping report/enrichment status

---

## Recommended Consolidation Strategy (REVISED)

### ⚠️ Architect Feedback - Critical Issues with Original Plan
1. **Missing adapter layer** - Can't break existing AppState APIs without staged migration
2. **Wrong phase order** - Status consolidation is lower risk, should go first
3. **Persistence strategy unclear** - ProjectStore needs dual persistence (sessionStorage + backend sync)
4. **Conversation scoping lost** - Must preserve conversationId-based source cleanup
5. **OutlineBuilder dependency** - Has its own selectedSources copy that needs migration

---

### REVISED Phase 1: Consolidate Report/Enrichment Status (LOW RISK)
**Rationale**: Single async state machine, fewer consumers

**Changes**:
1. MessageCoordinator owns all report generation status
2. Remove AppState.enrichmentStatus
3. Remove TierManager local pricing flags
4. Single state machine: 'idle' | 'pricing' | 'generating' | 'complete' | 'error'
5. Emit events for status changes: `reportStatusChanged`

**Call Sites to Update**:
- AppState.setEnrichmentStatus() → MessageCoordinator.setReportStatus()
- AppState.isEnrichmentPending() → MessageCoordinator.isReportPending()
- TierManager pricing checks → Subscribe to MessageCoordinator events

---

### REVISED Phase 2: Move selectedSources to ProjectStore (HIGH RISK - NEEDS ADAPTER)
**Rationale**: ProjectStore is closer to outline/project context

**2A - Add ProjectStore Persistence + Scoping**
1. Add sessionStorage persistence to ProjectStore
2. Implement conversation scoping (import conversationId from AppState)
3. Add methods: toggleSourceSelection(), isSourceSelected(), getSelectedSources()
4. Implement auto-cleanup for stale conversation sources

**2B - Create AppState Adapter (Dual-Write Period)**
1. Keep AppState.selectedSources as façade
2. Delegate all operations to ProjectStore
3. Maintain backward compatibility for existing callers

**2C - Migrate Consumers Incrementally**
- SourceManager: Update to dispatch to ProjectStore
- OutlineBuilder: Already subscribes to ProjectStore, verify sync works
- TierManager: Update tier limit checks to read from ProjectStore
- Source cards: Update checkbox state reads

**2D - Remove AppState Adapter**
1. Once all consumers migrated, remove AppState.selectedSources
2. Remove delegation methods
3. Full ownership in ProjectStore

**Critical Dependencies**:
- AppState.conversationId must be accessible to ProjectStore
- AppState.clearConversation() must trigger ProjectStore.clearSelectedSources()
- OutlineBuilder auto-placement logic needs ProjectStore subscription

---

### REVISED Phase 3: Unify Purchase Tracking (DEFERRED - NEEDS NEW API)
**Rationale**: Backend DB is source of truth, but requires new endpoint + cache strategy

**Changes** (Design First):
1. Design API endpoint: `GET /api/user/purchases` with caching headers
2. Design cache invalidation strategy (TTL? Event-based?)
3. Design dual-write fallback for offline/error scenarios
4. Implement backend endpoint
5. Update SourceManager to query API
6. Remove AppState.purchasedItems after dual-write verification
7. Add wallet refresh logic after purchase

**Blocked By**: Backend API design, cache strategy decision

---

## Migration Checklist

- [ ] Create ProjectStore persistence layer
- [ ] Move selectedSources to ProjectStore
- [ ] Update SourceManager event dispatching
- [ ] Remove AppState.selectedSources
- [ ] Create API endpoint for purchases
- [ ] Remove AppState.purchasedItems
- [ ] Consolidate enrichment/report status
- [ ] Update OutlineBuilder subscribers
- [ ] Update all source selection UI reads
- [ ] Test cross-component state sync
- [ ] Regression test outline + source selection workflows

---

## Risk Assessment

| Change | Risk Level | Impact | Mitigation |
|--------|-----------|--------|------------|
| selectedSources migration | HIGH | All source selection UI | Feature flag, parallel implementation |
| Purchase tracking | MEDIUM | Unlock buttons, "already purchased" state | Cache with invalidation, fallback to local |
| Report status | LOW | Loading indicators | Single async state machine |

---

## Files to Modify

### Phase 1 (selectedSources)
- `backend/static/js/state/project-store.js` - Add persistence, expand selectedSources logic
- `backend/static/js/state/app-state.js` - Remove selectedSources
- `backend/static/js/managers/source-manager.js` - Dispatch to ProjectStore
- `backend/static/js/components/outline-builder.js` - Verify subscription still works
- `backend/static/js/components/source-card.js` - Update state reads

### Phase 2 (purchases)
- `backend/app/api/routes/purchases.py` - New endpoint
- `backend/static/js/services/api.js` - Add getPurchases()
- `backend/static/js/state/app-state.js` - Remove purchasedItems
- `backend/static/js/managers/source-manager.js` - Query API instead

### Phase 3 (status)
- `backend/static/js/managers/message-coordinator.js` - Own all status
- `backend/static/js/state/app-state.js` - Remove enrichmentStatus
- `backend/static/js/managers/tier-manager.js` - Remove local flags
