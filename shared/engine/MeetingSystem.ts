/**
 * Meeting System
 * Manages emergency meetings, body report meetings, discussions, voting, and ejections.
 */

import { meetingLog } from '../logging/index.ts';
import type {
  Meeting,
  MeetingType,
  MeetingPhase,
  Statement,
  VoteRecord,
  EjectionResult,
  MeetingSnapshot,
  MeetingParticipant,
  StatementSnapshot,
  EmergencyButtonState,
  Position,
} from '../types/game.types.ts';

// ========== Configuration ==========

export interface MeetingConfig {
  /** Duration of discussion phase in seconds */
  discussionTime: number;
  /** Duration of voting phase in seconds */
  votingTime: number;
  /** Duration of pre-meeting phase in seconds */
  preMeetingTime: number;
  /** Duration of vote results display in seconds */
  voteResultsTime: number;
  /** Duration of ejection animation in seconds */
  ejectionTime: number;
  /** Whether votes are anonymous */
  anonymousVoting: boolean;
  /** Whether to confirm if ejected player was impostor */
  confirmEjects: boolean;
  /** Seconds before voting ends when votes lock */
  voteLockTime: number;
  /** Cooldown after meeting before another can be called (seconds) */
  emergencyCooldown: number;
  /** Max emergency meetings per player per game */
  emergencyMeetingsPerPlayer: number;
  /** Global cooldown at game start before emergency button can be used (seconds) */
  gameStartCooldown: number;
}

const DEFAULT_CONFIG: MeetingConfig = {
  discussionTime: 60,
  votingTime: 120,
  preMeetingTime: 3,
  voteResultsTime: 5,
  ejectionTime: 5,
  anonymousVoting: false,
  confirmEjects: true,
  voteLockTime: 5,
  emergencyCooldown: 30,
  emergencyMeetingsPerPlayer: 1,
  gameStartCooldown: 15,
};

// ========== Events ==========

export interface MeetingStartedEvent {
  type: 'MEETING_STARTED';
  meeting: Meeting;
  timestamp: number;
}

export interface MeetingPhaseChangedEvent {
  type: 'MEETING_PHASE_CHANGED';
  meetingId: string;
  phase: MeetingPhase;
  phaseEndTime: number;
  timestamp: number;
}

export interface StatementAddedEvent {
  type: 'STATEMENT_ADDED';
  meetingId: string;
  statement: Statement;
  timestamp: number;
}

export interface VoteRecordedEvent {
  type: 'VOTE_RECORDED';
  meetingId: string;
  voterId: string;
  voterName: string;
  targetId: string | 'SKIP'; // Only included if not anonymous
  timestamp: number;
}

export interface MeetingEndedEvent {
  type: 'MEETING_ENDED';
  meetingId: string;
  result: EjectionResult;
  timestamp: number;
}

export type MeetingEvent =
  | MeetingStartedEvent
  | MeetingPhaseChangedEvent
  | StatementAddedEvent
  | VoteRecordedEvent
  | MeetingEndedEvent;

// ========== Player Info (needed for meeting) ==========

export interface MeetingPlayerInfo {
  id: string;
  name: string;
  color: number;
  isAlive: boolean;
  isGhost: boolean;
  isImpostor: boolean;
  position: Position;
}

// ========== Meeting System Class ==========

export class MeetingSystem {
  private config: MeetingConfig;
  private activeMeeting: Meeting | null = null;
  private emergencyButtonState: EmergencyButtonState;
  private gameStartTime: number = 0;

  // Callbacks
  private meetingStartedCallback: ((event: MeetingStartedEvent) => void) | null = null;
  private phaseChangedCallback: ((event: MeetingPhaseChangedEvent) => void) | null = null;
  private statementAddedCallback: ((event: StatementAddedEvent) => void) | null = null;
  private voteRecordedCallback: ((event: VoteRecordedEvent) => void) | null = null;
  private meetingEndedCallback: ((event: MeetingEndedEvent) => void) | null = null;
  private getPlayersCallback: (() => MeetingPlayerInfo[]) | null = null;
  private getImpostorCountCallback: (() => number) | null = null;

  constructor(config?: Partial<MeetingConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.emergencyButtonState = {
      globalCooldownUntil: 0,
      playerCooldowns: new Map(),
      playerUsageCount: new Map(),
      meetingsPerPlayer: this.config.emergencyMeetingsPerPlayer,
      cooldownDuration: this.config.emergencyCooldown,
    };

    meetingLog.get().info('MeetingSystem initialized', { config: this.config });
  }

  // ========== Callbacks ==========

  setMeetingStartedCallback(callback: (event: MeetingStartedEvent) => void): void {
    this.meetingStartedCallback = callback;
  }

  setPhaseChangedCallback(callback: (event: MeetingPhaseChangedEvent) => void): void {
    this.phaseChangedCallback = callback;
  }

  setStatementAddedCallback(callback: (event: StatementAddedEvent) => void): void {
    this.statementAddedCallback = callback;
  }

  setVoteRecordedCallback(callback: (event: VoteRecordedEvent) => void): void {
    this.voteRecordedCallback = callback;
  }

  setMeetingEndedCallback(callback: (event: MeetingEndedEvent) => void): void {
    this.meetingEndedCallback = callback;
  }

  setGetPlayersCallback(callback: () => MeetingPlayerInfo[]): void {
    this.getPlayersCallback = callback;
  }

  setGetImpostorCountCallback(callback: () => number): void {
    this.getImpostorCountCallback = callback;
  }

  // ========== Game Lifecycle ==========

  /**
   * Called when game starts to set up initial cooldowns
   */
  onGameStart(timestamp: number): void {
    this.gameStartTime = timestamp;
    this.emergencyButtonState.globalCooldownUntil = timestamp + (this.config.gameStartCooldown * 1000);
    this.emergencyButtonState.playerCooldowns.clear();
    this.emergencyButtonState.playerUsageCount.clear();
    this.activeMeeting = null;

    meetingLog.get().info('MeetingSystem game started', {
      globalCooldownUntil: this.emergencyButtonState.globalCooldownUntil,
      gameStartCooldown: this.config.gameStartCooldown,
    });
  }

  /**
   * Reset the meeting system for a new game
   */
  reset(): void {
    this.activeMeeting = null;
    this.emergencyButtonState = {
      globalCooldownUntil: 0,
      playerCooldowns: new Map(),
      playerUsageCount: new Map(),
      meetingsPerPlayer: this.config.emergencyMeetingsPerPlayer,
      cooldownDuration: this.config.emergencyCooldown,
    };
  }

  // ========== Emergency Button ==========

  /**
   * Check if a player can call an emergency meeting
   */
  canCallEmergencyMeeting(playerId: string, timestamp: number): { canCall: boolean; reason?: string } {
    // Can't call if meeting is active
    if (this.activeMeeting) {
      return { canCall: false, reason: 'Meeting already in progress' };
    }

    // Check global cooldown
    if (timestamp < this.emergencyButtonState.globalCooldownUntil) {
      const remaining = Math.ceil((this.emergencyButtonState.globalCooldownUntil - timestamp) / 1000);
      return { canCall: false, reason: `Global cooldown: ${remaining}s remaining` };
    }

    // Check player cooldown
    const playerCooldown = this.emergencyButtonState.playerCooldowns.get(playerId) || 0;
    if (timestamp < playerCooldown) {
      const remaining = Math.ceil((playerCooldown - timestamp) / 1000);
      return { canCall: false, reason: `Personal cooldown: ${remaining}s remaining` };
    }

    // Check usage limit
    const usageCount = this.emergencyButtonState.playerUsageCount.get(playerId) || 0;
    if (usageCount >= this.emergencyButtonState.meetingsPerPlayer) {
      return { canCall: false, reason: 'No emergency meetings remaining' };
    }

    return { canCall: true };
  }

  /**
   * Get remaining emergency meetings for a player
   */
  getRemainingMeetings(playerId: string): number {
    const used = this.emergencyButtonState.playerUsageCount.get(playerId) || 0;
    return Math.max(0, this.emergencyButtonState.meetingsPerPlayer - used);
  }

  // ========== Start Meeting ==========

  /**
   * Start an emergency meeting
   */
  startEmergencyMeeting(callerId: string, callerName: string, timestamp: number): Meeting | null {
    const canCall = this.canCallEmergencyMeeting(callerId, timestamp);
    if (!canCall.canCall) {
      meetingLog.get().warn('Cannot start emergency meeting', { callerId, reason: canCall.reason });
      return null;
    }

    // Update usage tracking
    const currentUsage = this.emergencyButtonState.playerUsageCount.get(callerId) || 0;
    this.emergencyButtonState.playerUsageCount.set(callerId, currentUsage + 1);

    return this.createMeeting('EMERGENCY', callerId, callerName, timestamp);
  }

  /**
   * Start a body report meeting
   */
  startBodyReportMeeting(
    reporterId: string,
    reporterName: string,
    timestamp: number,
    bodyInfo: {
      bodyId: string;
      victimId: string;
      victimName: string;
      victimColor: number;
      location: Position;
      zone: string;
    }
  ): Meeting | null {
    if (this.activeMeeting) {
      meetingLog.get().warn('Cannot start body report meeting - meeting already active');
      return null;
    }

    const meeting = this.createMeeting('BODY_REPORT', reporterId, reporterName, timestamp, bodyInfo);
    return meeting;
  }

  /**
   * Internal: Create and initialize a meeting
   */
  private createMeeting(
    type: MeetingType,
    callerId: string,
    callerName: string,
    timestamp: number,
    bodyInfo?: {
      bodyId: string;
      victimId: string;
      victimName: string;
      victimColor: number;
      location: Position;
      zone: string;
    }
  ): Meeting {
    // Get living players for participants
    const players = this.getPlayersCallback?.() || [];
    const participants = players
      .filter(p => p.isAlive && !p.isGhost)
      .map(p => p.id);

    const preMeetingEndTime = timestamp + (this.config.preMeetingTime * 1000);
    const discussionEndTime = preMeetingEndTime + (this.config.discussionTime * 1000);
    const votingEndTime = discussionEndTime + (this.config.votingTime * 1000);

    const meeting: Meeting = {
      id: `meeting_${timestamp}`,
      type,
      phase: 'PRE_MEETING',
      calledBy: callerId,
      calledByName: callerName,
      calledAt: timestamp,
      discussionDuration: this.config.discussionTime,
      votingDuration: this.config.votingTime,
      discussionEndTime,
      votingEndTime,
      phaseEndTime: preMeetingEndTime,
      participants,
      statements: [],
      votes: [],
    };

    // Add body info if this is a body report
    if (bodyInfo) {
      meeting.bodyId = bodyInfo.bodyId;
      meeting.bodyVictimId = bodyInfo.victimId;
      meeting.bodyVictimName = bodyInfo.victimName;
      meeting.bodyVictimColor = bodyInfo.victimColor;
      meeting.bodyLocation = bodyInfo.location;
      meeting.bodyZone = bodyInfo.zone;
    }

    this.activeMeeting = meeting;

    meetingLog.get().info('Meeting started', {
      id: meeting.id,
      type,
      callerId,
      callerName,
      participants: participants.length,
      bodyInfo: bodyInfo?.victimName,
    });

    // Emit event
    if (this.meetingStartedCallback) {
      this.meetingStartedCallback({
        type: 'MEETING_STARTED',
        meeting,
        timestamp,
      });
    }

    return meeting;
  }

  // ========== Phase Management ==========

  /**
   * Update meeting state - call this from game tick
   * Returns true if meeting phase changed
   */
  update(timestamp: number): boolean {
    if (!this.activeMeeting) return false;

    const meeting = this.activeMeeting;
    const currentPhase = meeting.phase;

    // Check if we should transition phases
    if (timestamp >= meeting.phaseEndTime) {
      switch (currentPhase) {
        case 'PRE_MEETING':
          this.transitionToPhase('DISCUSSION', timestamp);
          return true;

        case 'DISCUSSION':
          this.transitionToPhase('VOTING', timestamp);
          return true;

        case 'VOTING':
          // Tally votes and show results
          this.tallyVotes();
          this.transitionToPhase('VOTE_RESULTS', timestamp);
          return true;

        case 'VOTE_RESULTS':
          if (meeting.result?.ejectedPlayerId) {
            this.transitionToPhase('EJECTION', timestamp);
          } else {
            // No ejection, end meeting
            this.endMeeting(timestamp);
          }
          return true;

        case 'EJECTION':
          this.endMeeting(timestamp);
          return true;
      }
    }

    // Check if all votes are in during voting phase
    if (currentPhase === 'VOTING' && this.allVotesIn()) {
      this.tallyVotes();
      this.transitionToPhase('VOTE_RESULTS', timestamp);
      return true;
    }

    return false;
  }

  /**
   * Transition to a new meeting phase
   */
  private transitionToPhase(newPhase: MeetingPhase, timestamp: number): void {
    if (!this.activeMeeting) return;

    const meeting = this.activeMeeting;
    const oldPhase = meeting.phase;
    meeting.phase = newPhase;

    // Set phase end time based on new phase
    switch (newPhase) {
      case 'DISCUSSION':
        meeting.phaseEndTime = meeting.discussionEndTime;
        break;
      case 'VOTING':
        meeting.phaseEndTime = meeting.votingEndTime;
        break;
      case 'VOTE_RESULTS':
        meeting.phaseEndTime = timestamp + (this.config.voteResultsTime * 1000);
        break;
      case 'EJECTION':
        meeting.phaseEndTime = timestamp + (this.config.ejectionTime * 1000);
        break;
    }

    meetingLog.get().info('Meeting phase changed', {
      meetingId: meeting.id,
      oldPhase,
      newPhase,
      phaseEndTime: meeting.phaseEndTime,
    });

    // Emit event
    if (this.phaseChangedCallback) {
      this.phaseChangedCallback({
        type: 'MEETING_PHASE_CHANGED',
        meetingId: meeting.id,
        phase: newPhase,
        phaseEndTime: meeting.phaseEndTime,
        timestamp,
      });
    }
  }

  // ========== Statements ==========

  /**
   * Add a statement during discussion
   */
  addStatement(
    playerId: string,
    playerName: string,
    content: string,
    timestamp: number,
    metadata?: {
      accusesPlayer?: string;
      defendsPlayer?: string;
      claimsLocation?: string;
      claimsTask?: string;
    }
  ): Statement | null {
    if (!this.activeMeeting) {
      meetingLog.get().warn('Cannot add statement - no active meeting');
      return null;
    }

    if (this.activeMeeting.phase !== 'DISCUSSION') {
      meetingLog.get().warn('Cannot add statement - not in discussion phase', {
        phase: this.activeMeeting.phase,
      });
      return null;
    }

    // Check if player is a participant
    if (!this.activeMeeting.participants.includes(playerId)) {
      meetingLog.get().warn('Cannot add statement - player not a participant', { playerId });
      return null;
    }

    const statement: Statement = {
      id: `stmt_${playerId}_${timestamp}`,
      playerId,
      content,
      timestamp,
      responses: [],
      ...metadata,
    };

    this.activeMeeting.statements.push(statement);

    meetingLog.get().debug('Statement added', {
      meetingId: this.activeMeeting.id,
      playerId,
      content: content.substring(0, 50),
    });

    // Emit event
    if (this.statementAddedCallback) {
      this.statementAddedCallback({
        type: 'STATEMENT_ADDED',
        meetingId: this.activeMeeting.id,
        statement,
        timestamp,
      });
    }

    return statement;
  }

  // ========== Voting ==========

  /**
   * Cast a vote
   */
  castVote(
    voterId: string,
    voterName: string,
    targetId: string | 'SKIP',
    reasoning: string,
    timestamp: number
  ): boolean {
    if (!this.activeMeeting) {
      meetingLog.get().warn('Cannot cast vote - no active meeting');
      return false;
    }

    if (this.activeMeeting.phase !== 'VOTING') {
      meetingLog.get().warn('Cannot cast vote - not in voting phase', {
        phase: this.activeMeeting.phase,
      });
      return false;
    }

    // Check if player is a participant
    if (!this.activeMeeting.participants.includes(voterId)) {
      meetingLog.get().warn('Cannot cast vote - player not a participant', { voterId });
      return false;
    }

    // Check if votes are locked
    if (this.areVotesLocked(timestamp)) {
      meetingLog.get().warn('Cannot cast vote - votes are locked', { voterId });
      return false;
    }

    // Check if target is valid (must be a participant or 'SKIP')
    if (targetId !== 'SKIP' && !this.activeMeeting.participants.includes(targetId)) {
      meetingLog.get().warn('Cannot cast vote - invalid target', { voterId, targetId });
      return false;
    }

    // Remove existing vote if any
    const existingVoteIndex = this.activeMeeting.votes.findIndex(v => v.voterId === voterId);
    if (existingVoteIndex >= 0) {
      this.activeMeeting.votes.splice(existingVoteIndex, 1);
    }

    const vote: VoteRecord = {
      voterId,
      targetId,
      timestamp,
      reasoning,
      isPublic: !this.config.anonymousVoting,
    };

    this.activeMeeting.votes.push(vote);

    meetingLog.get().debug('Vote cast', {
      meetingId: this.activeMeeting.id,
      voterId,
      targetId: this.config.anonymousVoting ? '[anonymous]' : targetId,
    });

    // Emit event
    if (this.voteRecordedCallback) {
      this.voteRecordedCallback({
        type: 'VOTE_RECORDED',
        meetingId: this.activeMeeting.id,
        voterId,
        voterName,
        targetId: this.config.anonymousVoting ? 'SKIP' : targetId, // Hide target if anonymous
        timestamp,
      });
    }

    return true;
  }

  /**
   * Check if votes are locked (within voteLockTime of voting end)
   */
  private areVotesLocked(timestamp: number): boolean {
    if (!this.activeMeeting) return false;
    const lockTime = this.activeMeeting.votingEndTime - (this.config.voteLockTime * 1000);
    return timestamp >= lockTime;
  }

  /**
   * Check if all participants have voted
   */
  private allVotesIn(): boolean {
    if (!this.activeMeeting) return false;
    const voterIds = new Set(this.activeMeeting.votes.map(v => v.voterId));
    return this.activeMeeting.participants.every(p => voterIds.has(p));
  }

  /**
   * Get list of players who have voted
   */
  getVotedPlayers(): string[] {
    if (!this.activeMeeting) return [];
    return this.activeMeeting.votes.map(v => v.voterId);
  }

  // ========== Vote Tallying ==========

  /**
   * Tally votes and determine ejection result
   */
  private tallyVotes(): void {
    if (!this.activeMeeting) return;

    const meeting = this.activeMeeting;
    const votes = meeting.votes;

    // Count votes per target
    const voteCounts = new Map<string, number>();
    voteCounts.set('SKIP', 0); // Initialize skip

    for (const participant of meeting.participants) {
      voteCounts.set(participant, 0);
    }

    for (const vote of votes) {
      const current = voteCounts.get(vote.targetId) || 0;
      voteCounts.set(vote.targetId, current + 1);
    }

    // Find the target(s) with most votes
    let maxVotes = 0;
    const maxTargets: string[] = [];

    for (const [targetId, count] of voteCounts.entries()) {
      if (count > maxVotes) {
        maxVotes = count;
        maxTargets.length = 0;
        maxTargets.push(targetId);
      } else if (count === maxVotes && count > 0) {
        maxTargets.push(targetId);
      }
    }

    // Determine result
    const totalVotes = votes.length;
    const players = this.getPlayersCallback?.() || [];
    const skipCount = voteCounts.get('SKIP') || 0;

    let ejectedPlayerId: string | null = null;
    let ejectedPlayerName: string | null = null;
    let reason: EjectionResult['reason'];
    let wasImpostor = false;

    if (totalVotes === 0) {
      // No one voted
      reason = 'NO_VOTES';
    } else if (maxTargets.length > 1) {
      // Tie between multiple targets (including possibly skip)
      reason = 'TIE';
    } else if (maxTargets[0] === 'SKIP') {
      // Skip won
      reason = 'SKIP_MAJORITY';
    } else {
      // Someone got the most votes
      const targetId = maxTargets[0];
      const targetVotes = voteCounts.get(targetId) || 0;
      const majorityRequired = Math.floor(meeting.participants.length / 2) + 1;

      if (targetVotes >= majorityRequired) {
        reason = 'MAJORITY';
      } else {
        reason = 'PLURALITY';
      }

      ejectedPlayerId = targetId;
      const player = players.find(p => p.id === targetId);
      ejectedPlayerName = player?.name || 'Unknown';
      wasImpostor = player?.isImpostor || false;
    }

    // Calculate remaining impostors
    let impostorsRemaining = this.getImpostorCountCallback?.() || 0;
    if (wasImpostor && ejectedPlayerId) {
      impostorsRemaining = Math.max(0, impostorsRemaining - 1);
    }

    const result: EjectionResult = {
      ejectedPlayerId,
      ejectedPlayerName,
      reason,
      wasImpostor,
      impostorsRemaining,
      voteCounts,
      totalVotes,
    };

    meeting.result = result;
    meeting.ejectedPlayer = ejectedPlayerId || undefined;
    meeting.voteResults = voteCounts;
    meeting.wasImpostor = wasImpostor;

    meetingLog.get().info('Votes tallied', {
      meetingId: meeting.id,
      result: {
        ejected: ejectedPlayerName,
        reason,
        wasImpostor,
        impostorsRemaining,
        totalVotes,
      },
    });
  }

  // ========== Meeting End ==========

  /**
   * End the meeting and clean up
   */
  private endMeeting(timestamp: number): void {
    if (!this.activeMeeting) return;

    const meeting = this.activeMeeting;
    const result = meeting.result!;

    meetingLog.get().info('Meeting ended', {
      meetingId: meeting.id,
      ejected: result.ejectedPlayerName,
      reason: result.reason,
    });

    // Set cooldowns for next emergency meeting
    const cooldownEndTime = timestamp + (this.config.emergencyCooldown * 1000);
    for (const participant of meeting.participants) {
      this.emergencyButtonState.playerCooldowns.set(participant, cooldownEndTime);
    }

    // Emit event
    if (this.meetingEndedCallback) {
      this.meetingEndedCallback({
        type: 'MEETING_ENDED',
        meetingId: meeting.id,
        result,
        timestamp,
      });
    }

    this.activeMeeting = null;
  }

  // ========== Getters ==========

  /**
   * Get the active meeting
   */
  getActiveMeeting(): Meeting | null {
    return this.activeMeeting;
  }

  /**
   * Check if a meeting is currently active
   */
  isMeetingActive(): boolean {
    return this.activeMeeting !== null;
  }

  /**
   * Get current meeting phase
   */
  getCurrentPhase(): MeetingPhase | null {
    return this.activeMeeting?.phase || null;
  }

  /**
   * Get time remaining in current phase (seconds)
   */
  getTimeRemaining(timestamp: number): number {
    if (!this.activeMeeting) return 0;
    return Math.max(0, Math.ceil((this.activeMeeting.phaseEndTime - timestamp) / 1000));
  }

  /**
   * Get the emergency button state
   */
  getEmergencyButtonState(): EmergencyButtonState {
    return this.emergencyButtonState;
  }

  /**
   * Create a snapshot of the meeting for client sync
   */
  createMeetingSnapshot(timestamp: number): MeetingSnapshot | null {
    if (!this.activeMeeting) return null;

    const meeting = this.activeMeeting;
    const players = this.getPlayersCallback?.() || [];

    // Build participant list
    const participants: MeetingParticipant[] = meeting.participants.map(pid => {
      const player = players.find(p => p.id === pid);
      const hasVoted = meeting.votes.some(v => v.voterId === pid);
      return {
        id: pid,
        name: player?.name || 'Unknown',
        color: player?.color || 0,
        isAlive: player?.isAlive || false,
        isGhost: player?.isGhost || false,
        hasVoted,
      };
    });

    // Build statements
    const statements: StatementSnapshot[] = meeting.statements.map(stmt => {
      const player = players.find(p => p.id === stmt.playerId);
      return {
        id: stmt.id,
        playerId: stmt.playerId,
        playerName: player?.name || 'Unknown',
        playerColor: player?.color || 0,
        content: stmt.content,
        timestamp: stmt.timestamp,
        accusesPlayer: stmt.accusesPlayer,
        defendsPlayer: stmt.defendsPlayer,
      };
    });

    // Find caller info
    const caller = players.find(p => p.id === meeting.calledBy);

    const snapshot: MeetingSnapshot = {
      id: meeting.id,
      type: meeting.type,
      phase: meeting.phase,
      calledById: meeting.calledBy,
      calledByName: meeting.calledByName || caller?.name || 'Unknown',
      calledByColor: caller?.color || 0,
      discussionEndTime: meeting.discussionEndTime,
      votingEndTime: meeting.votingEndTime,
      phaseEndTime: meeting.phaseEndTime,
      timeRemaining: this.getTimeRemaining(timestamp),
      participants,
      votedPlayerIds: meeting.votes.map(v => v.voterId),
      statements,
    };

    // Add body report info
    if (meeting.type === 'BODY_REPORT' && meeting.bodyVictimId) {
      snapshot.bodyReport = {
        victimId: meeting.bodyVictimId,
        victimName: meeting.bodyVictimName || 'Unknown',
        victimColor: meeting.bodyVictimColor || 0,
        location: meeting.bodyZone || 'Unknown',
      };
    }

    // Add vote results if past voting phase
    if (meeting.phase === 'VOTE_RESULTS' || meeting.phase === 'EJECTION') {
      const voteCounts: Record<string, number> = {};
      if (meeting.voteResults) {
        for (const [targetId, count] of meeting.voteResults.entries()) {
          voteCounts[targetId] = count;
        }
      }

      snapshot.voteResults = {
        voteCounts,
        anonymousVoting: this.config.anonymousVoting,
      };

      if (!this.config.anonymousVoting) {
        const voterMap: Record<string, string> = {};
        for (const vote of meeting.votes) {
          voterMap[vote.voterId] = vote.targetId;
        }
        snapshot.voteResults.voterMap = voterMap;
      }
    }

    // Add ejection info
    if (meeting.phase === 'EJECTION' && meeting.result) {
      const result = meeting.result;
      const ejectedPlayer = result.ejectedPlayerId
        ? players.find(p => p.id === result.ejectedPlayerId)
        : null;

      let message: string;
      if (!result.ejectedPlayerId) {
        message = result.reason === 'TIE'
          ? 'No one was ejected. (Tie)'
          : result.reason === 'SKIP_MAJORITY'
          ? 'No one was ejected. (Skipped)'
          : 'No one was ejected.';
      } else if (this.config.confirmEjects) {
        message = result.wasImpostor
          ? `${result.ejectedPlayerName} was An Impostor. ${result.impostorsRemaining} Impostor${result.impostorsRemaining !== 1 ? 's' : ''} remain.`
          : `${result.ejectedPlayerName} was not An Impostor. ${result.impostorsRemaining} Impostor${result.impostorsRemaining !== 1 ? 's' : ''} remain.`;
      } else {
        message = `${result.ejectedPlayerName} was ejected.`;
      }

      snapshot.ejection = {
        ejectedId: result.ejectedPlayerId,
        ejectedName: result.ejectedPlayerName,
        ejectedColor: ejectedPlayer?.color || null,
        wasImpostor: result.wasImpostor,
        impostorsRemaining: result.impostorsRemaining,
        message,
      };
    }

    return snapshot;
  }
}
