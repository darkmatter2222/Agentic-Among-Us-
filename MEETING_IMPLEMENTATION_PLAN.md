# Emergency Meeting & Voting System - 20-Point Implementation TODO

## Overview
This document tracks the implementation of the Emergency Meeting, Discussion, Voting, and Ejection systems for the Among Us simulation.

---

## TODO Checklist

### PHASE 1: FOUNDATION (Points 1-4)
- [x] **1. Extend Type Definitions** - COMPLETE
  - Added `MeetingPhase` type to `game.types.ts`
  - Added `MeetingSnapshot` interface for client sync
  - Added `EjectionResult` interface
  - Added `MeetingParticipant`, `StatementSnapshot` helper types
  - Added `EmergencyButtonState` interface
  - Added `CALL_EMERGENCY_MEETING` to `AIGoalType`
  - Added `activeMeeting` and `meetingPhase` to `WorldSnapshot`

- [x] **2. Create MeetingSystem.ts Core Class** - COMPLETE
  - Created `shared/engine/MeetingSystem.ts` with full implementation
  - `MeetingConfig` with timing settings (discussion, voting, etc.)
  - Event types: `MeetingStartedEvent`, `MeetingPhaseChangedEvent`, `VoteRecordedEvent`, `MeetingEndedEvent`
  - Phase management: PRE_MEETING -> DISCUSSION -> VOTING -> VOTE_RESULTS -> EJECTION
  - Vote collection with rules (majority, ties, skip)
  - Snapshot generation for client sync
  - Added `meetingLog` to shared logging system

- [x] **3. Implement Emergency Button State Tracking** - COMPLETE
  - Emergency button state in MeetingSystem (global cooldown, per-player cooldowns, usage counts)
  - `canCallEmergencyMeeting()` with all validation
  - `getRemainingMeetings()` per player
  - Proximity check in GameSimulation.callEmergencyMeeting()

- [x] **4. Implement Player Meeting Positions** - COMPLETE
  - `teleportPlayersToMeeting()` calculates circular positions around table
  - Uses EMERGENCY_BUTTON position as center with 80-unit radius
  - Players distributed evenly using angle calculation
  - Uses existing `setPosition()` method on AIAgent

---

### PHASE 2: MEETING TRIGGERS (Points 5-7)
- [x] **5. Implement Emergency Button Activation** - COMPLETE
  - `CALL_EMERGENCY_MEETING` already in AIGoalType
  - `callEmergencyMeeting()` method in GameSimulation
  - `canCallEmergencyMeeting()` with proximity + cooldown checks
  - Button range: 50 units from EMERGENCY_BUTTON position

- [x] **6. Upgrade Body Report to Trigger Meeting** - COMPLETE
  - Modified `reportBody()` to call `meetingSystem.startBodyReportMeeting()`
  - Body info (victim, location, zone) passed to meeting
  - Fallback to ALERT phase if meeting can't start

- [x] **7. Implement Meeting Initialization** - COMPLETE
  - MeetingSystem starts with PRE_MEETING phase
  - GameSimulation.step() stops agent updates during meetings
  - Players teleported via `teleportPlayersToMeeting()`
  - Meeting snapshot broadcast via WorldSnapshot
  - `broadcastMeetingStart()` adds memory to all agents

---

### PHASE 3: AI DISCUSSION SYSTEM (Points 8-11)
- [x] **8. Create Meeting AI Prompts** - COMPLETE
  - Created `server/src/ai/prompts/MeetingPrompts.ts`
  - `buildDiscussionSystemPrompt()` - system prompt for discussion
  - `buildDiscussionUserPrompt()` - user prompt with context
  - `buildVotingSystemPrompt()` - system prompt for voting
  - `buildVotingUserPrompt()` - user prompt with vote options
  - Separate prompts for crewmate vs impostor roles
  - Witness info integration for those who saw kills

- [x] **9. Implement Statement Generation** - COMPLETE
  - Created `server/src/ai/MeetingAIManager.ts`
  - `getDiscussionDecision()` calls LLM for statement generation
  - Uses `parseDiscussionResponse()` to extract statement, accusations, defenses
  - Fallback to `generateFallbackDiscussionStatement()` on LLM failure
  - Statement types include accusations, defenses, alibis, location claims

- [x] **10. Implement Discussion Flow Manager** - COMPLETE
  - `MeetingAIManager` tracks speaking order with `buildSpeakingOrder()`
  - Reporter speaks first (`reporterFirst: true` config)
  - `getNextSpeaker()` implements round-robin through living players
  - `maxStatementsPerAgent: 3` limits statements per player
  - `AgentMeetingState` tracks statement count and timing per agent

- [x] **11. Implement Statement Broadcasting** - COMPLETE
  - `processMeetingAI()` in GameSimulation handles statement results
  - Calls `meetingSystem.addStatement()` to add to meeting record
  - Creates `SpeechEvent` for UI display
  - Logs statement details for debugging

---

### PHASE 4: VOTING SYSTEM (Points 12-15)
- [x] **12. Create Voting AI Prompts** - COMPLETE
  - Included in MeetingPrompts.ts
  - `parseDiscussionResponse()` - parse LLM discussion output
  - `parseVotingResponse()` - parse LLM vote output
  - `generateFallbackDiscussionStatement()` - fallback for LLM failures
  - `generateFallbackVote()` - fallback vote based on suspicion

- [x] **13. Implement Vote Collection** - COMPLETE
  - `MeetingAIManager.processVotingPhase()` collects votes from all agents
  - Parallel processing in batches of 3 for efficiency
  - `getVoteDecision()` calls LLM for each agent's vote
  - Tracks `hasVoted` per agent in `AgentMeetingState`

- [x] **14. Implement Vote Tallying** - COMPLETE
  - `MeetingSystem.tallyVotes()` counts votes and determines result
  - Handles majority, plurality, ties, and skip majority
  - `EjectionResult` includes ejectedPlayerId, reason, vote counts
  - Integrated in GameSimulation via `meetingSystem.castVote()`

- [x] **15. Implement Ejection Execution** - COMPLETE
  - `handleEjection()` in GameSimulation marks player as DEAD
  - MeetingSystem transitions through VOTE_RESULTS -> EJECTION phases
  - `MeetingSnapshot.ejection` provides UI data (name, color, wasImpostor)
  - Meeting ends callback cleans up and resumes game

---

### PHASE 5: CLIENT UI (Points 16-18)
- [ ] **16. Create Meeting UI Components**
  - `MeetingOverlay.tsx` - full screen meeting container
  - `MeetingHeader.tsx` - timer, meeting type, victim info
  - `DiscussionChat.tsx` - scrolling statement display
  - `PlayerVotePanel.tsx` - voting interface

- [ ] **17. Create Voting & Results UI**
  - `VoteIndicators.tsx` - who has voted markers
  - `VoteResultsDisplay.tsx` - final tally visualization
  - `EjectionAnimation.tsx` - ejection result display

- [ ] **18. Extend WebSocket Protocol** - PARTIAL
  - `activeMeeting` already included in WorldSnapshot
  - `meetingPhase` already included in WorldSnapshot
  - Additional message types may be needed for real-time updates

---

### PHASE 6: INTEGRATION & TESTING (Points 19-20)
- [x] **19. Game Flow Integration** - COMPLETE
  - MeetingSystem integrated with GameSimulation
  - Meeting end -> resume gameplay handled in callbacks
  - Cooldowns reset after meeting (in MeetingSystem.endMeeting)
  - Bodies cleared after body report meeting (in reportBody)
  - Game pauses agent updates during meetings

- [ ] **20. Testing & Edge Cases**
  - Unit tests for vote tallying
  - Integration test for full meeting flow
  - Test win conditions after ejection
  - Test edge cases (ties, disconnects, ghosts)
  - Update `agents.md` documentation

---

## Implementation Notes

### Key Files Created
```
shared/engine/MeetingSystem.ts         - COMPLETE
server/src/ai/prompts/MeetingPrompts.ts - COMPLETE
server/src/ai/MeetingAIManager.ts       - COMPLETE
```

### Key Files Modified
```
shared/types/game.types.ts             - COMPLETE
shared/types/simulation.types.ts       - COMPLETE
shared/engine/AIAgent.ts               - COMPLETE
server/src/simulation/GameSimulation.ts - COMPLETE
```

### Key Files Still Needed (UI)
```
src/components/MeetingOverlay.tsx      - PENDING
src/components/MeetingHeader.tsx       - PENDING
src/components/DiscussionChat.tsx      - PENDING
src/components/PlayerVotePanel.tsx     - PENDING
src/components/VoteIndicators.tsx      - PENDING
src/components/VoteResultsDisplay.tsx  - PENDING
src/components/EjectionAnimation.tsx   - PENDING
```

### Configuration Defaults (in MeetingSystem.ts)
```typescript
const DEFAULT_CONFIG: MeetingConfig = {
  discussionTime: 60,        // seconds
  votingTime: 120,           // seconds
  voteResultsTime: 5,        // seconds
  ejectionTime: 5,           // seconds
  emergencyCooldown: 30,     // seconds after meeting
  emergencyLimit: 1,         // per player per game
  confirmEjects: true,       // show if impostor
  anonymousVoting: false,    // show who voted for whom
};
```

---

## Progress Tracking

| Phase | Points | Status | Started | Completed |
|-------|--------|--------|---------|-----------|
| Phase 1 | 1-4 | Complete | Dec 2, 2025 | Dec 2, 2025 |
| Phase 2 | 5-7 | Complete | Dec 2, 2025 | Dec 2, 2025 |
| Phase 3 | 8-11 | Complete | Dec 2, 2025 | Dec 3, 2025 |
| Phase 4 | 12-15 | Complete | Dec 2, 2025 | Dec 3, 2025 |
| Phase 5 | 16-18 | Pending | | |
| Phase 6 | 19-20 | In Progress | Dec 3, 2025 | |

**Current Status: 16/20 points complete (80%)**

---

## Changelog

### Dec 3, 2025
- Completed Points 9-11: MeetingAIManager with statement generation and discussion flow
- Completed Points 13-15: Vote collection, tallying, and ejection execution
- Completed Point 19: Full game flow integration
- Fixed TypeScript compilation errors in MeetingAIManager and GameSimulation
- Updated progress tracking

### Dec 2, 2025
- Created implementation plan
- Completed Phase 1 (Points 1-4): Foundation types and MeetingSystem core
- Completed Phase 2 (Points 5-7): Meeting triggers
- Completed Point 8: Meeting AI prompts
- Completed Point 12: Voting AI prompts
