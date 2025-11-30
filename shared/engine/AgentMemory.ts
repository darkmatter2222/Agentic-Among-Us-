/**
 * Agent Memory System
 * Persistent memory for AI agents tracking observations, conversations, alibis, and suspicions
 */

import type { Point } from '../data/poly3-map.ts';

// ========== Memory Entry Types ==========

export interface ObservationEntry {
  id: string;
  timestamp: number;
  type: 'location' | 'task_activity' | 'movement' | 'suspicious_behavior' | 'body_found' | 'vent_usage';
  subjectId: string; // Who was observed
  subjectName: string;
  zone: string | null;
  position?: Point;
  description: string;
  // For task observations
  taskType?: string;
  taskDuration?: number; // How long they spent on task
  expectedDuration?: number; // How long task should take
  // For suspicious behavior
  suspicionDelta?: number; // How much this changed suspicion
}

export interface ConversationEntry {
  id: string;
  timestamp: number;
  speakerId: string;
  speakerName: string;
  message: string;
  zone: string | null;
  // Analysis of message
  topic?: 'accusation' | 'defense' | 'alibi' | 'question' | 'information' | 'small_talk' | 'agreement' | 'disagreement';
  mentionedAgentIds?: string[];
  isLie?: boolean; // For impostors tracking their own lies
  isTruth?: boolean; // For tracking verifiable truths
}

export interface AccusationEntry {
  id: string;
  timestamp: number;
  accuserId: string;
  accuserName: string;
  accusedId: string;
  accusedName: string;
  reason: string;
  zone: string | null;
  // Track resolution
  wasCorrect?: boolean; // Set after game ends or player ejected
  resolved: boolean;
}

export interface AlibiEntry {
  id: string;
  timestamp: number;
  agentId: string;
  agentName: string;
  claimedZone: string;
  claimedActivity: string;
  timeRange: { start: number; end: number };
  // Verification
  witnesses?: string[]; // Agent IDs who can verify
  verified?: boolean;
  contradicted?: boolean;
  contradictionReason?: string;
}

export interface TaskObservation {
  agentId: string;
  agentName: string;
  taskType: string;
  zone: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  expectedDuration: number;
  // Analysis
  tooFast?: boolean; // Finished suspiciously fast
  tooSlow?: boolean; // Took way too long
  neverFinished?: boolean; // Started but never completed
  wasVisual?: boolean; // Visual task that should show animation
  sawAnimation?: boolean; // Did we see the task animation
}

// ========== Suspicion Tracking ==========

export interface SuspicionRecord {
  agentId: string;
  agentName: string;
  level: number; // 0-100
  reasons: SuspicionReason[];
  lastUpdated: number;
}

export interface SuspicionReason {
  timestamp: number;
  reason: string;
  delta: number; // How much this changed suspicion
  category: 'task_behavior' | 'movement' | 'speech' | 'accusation' | 'vouched' | 'caught_lying' | 'vent' | 'near_body' | 'following' | 'avoiding' | 'witnessed_kill';
}

// ========== Main Memory Class ==========

export interface AgentMemoryConfig {
  maxObservations?: number;
  maxConversations?: number;
  maxAccusations?: number;
  maxAlibis?: number;
  suspicionDecayRate?: number; // How much suspicion decays per minute
}

const DEFAULT_CONFIG: Required<AgentMemoryConfig> = {
  maxObservations: 100,
  maxConversations: 50,
  maxAccusations: 20,
  maxAlibis: 20,
  suspicionDecayRate: 1, // 1 point per minute
};

export class AgentMemory {
  private ownerId: string;
  private ownerName: string;
  private config: Required<AgentMemoryConfig>;
  
  // Memory stores
  private observations: ObservationEntry[] = [];
  private conversations: ConversationEntry[] = [];
  private accusations: AccusationEntry[] = [];
  private alibis: AlibiEntry[] = [];
  private taskObservations: Map<string, TaskObservation[]> = new Map(); // agentId -> observations
  
  // Suspicion tracking
  private suspicionRecords: Map<string, SuspicionRecord> = new Map();
  
  // Self-knowledge (for impostors)
  private myLies: string[] = [];
  private myFakeTaskClaims: string[] = [];
  
  constructor(ownerId: string, ownerName: string, config: AgentMemoryConfig = {}) {
    this.ownerId = ownerId;
    this.ownerName = ownerName;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  // ========== Observation Recording ==========
  
  recordObservation(obs: Omit<ObservationEntry, 'id' | 'timestamp'>): void {
    const entry: ObservationEntry = {
      ...obs,
      id: `obs_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };
    
    this.observations.push(entry);
    
    // Trim if too many
    if (this.observations.length > this.config.maxObservations) {
      this.observations.shift();
    }
    
    // Update suspicion based on observation type
    if (obs.suspicionDelta) {
      this.adjustSuspicion(
        obs.subjectId, 
        obs.subjectName, 
        obs.suspicionDelta, 
        obs.description,
        this.observationTypeToCategory(obs.type)
      );
    }
  }
  
  private observationTypeToCategory(type: ObservationEntry['type']): SuspicionReason['category'] {
    switch (type) {
      case 'task_activity': return 'task_behavior';
      case 'vent_usage': return 'vent';
      case 'suspicious_behavior': return 'movement';
      case 'body_found': return 'near_body';
      default: return 'movement';
    }
  }
  
  // ========== Task Observation ==========
  
  recordTaskStart(agentId: string, agentName: string, taskType: string, zone: string, expectedDuration: number, isVisual: boolean = false): void {
    const observation: TaskObservation = {
      agentId,
      agentName,
      taskType,
      zone,
      startTime: Date.now(),
      expectedDuration,
      wasVisual: isVisual,
    };
    
    const existing = this.taskObservations.get(agentId) ?? [];
    existing.push(observation);
    this.taskObservations.set(agentId, existing);
  }
  
  recordTaskEnd(agentId: string, sawAnimation: boolean = false): TaskObservation | null {
    const observations = this.taskObservations.get(agentId);
    if (!observations || observations.length === 0) return null;
    
    // Find the most recent unfinished task
    const lastObs = observations[observations.length - 1];
    if (lastObs.endTime) return null; // Already finished
    
    lastObs.endTime = Date.now();
    lastObs.duration = lastObs.endTime - lastObs.startTime;
    lastObs.sawAnimation = sawAnimation;
    
    // Analyze for suspicion
    const durationRatio = lastObs.duration / lastObs.expectedDuration;
    
    if (durationRatio < 0.3) {
      // Finished way too fast - very suspicious!
      lastObs.tooFast = true;
      this.adjustSuspicion(agentId, lastObs.agentName, 25, 
        `Finished ${lastObs.taskType} suspiciously fast (${Math.round(lastObs.duration/1000)}s vs expected ${Math.round(lastObs.expectedDuration/1000)}s)`,
        'task_behavior'
      );
      this.recordObservation({
        type: 'suspicious_behavior',
        subjectId: agentId,
        subjectName: lastObs.agentName,
        zone: lastObs.zone,
        description: `Finished ${lastObs.taskType} in ${Math.round(lastObs.duration/1000)}s (expected ${Math.round(lastObs.expectedDuration/1000)}s)`,
        taskType: lastObs.taskType,
        taskDuration: lastObs.duration,
        expectedDuration: lastObs.expectedDuration,
        suspicionDelta: 25,
      });
    } else if (durationRatio > 3.0) {
      // Took way too long - might be faking
      lastObs.tooSlow = true;
      this.adjustSuspicion(agentId, lastObs.agentName, 10, 
        `Took too long on ${lastObs.taskType}`,
        'task_behavior'
      );
    } else if (lastObs.wasVisual && !sawAnimation) {
      // Visual task but no animation seen - very suspicious!
      this.adjustSuspicion(agentId, lastObs.agentName, 30, 
        `Did visual task ${lastObs.taskType} but animation wasn't visible`,
        'task_behavior'
      );
    } else if (durationRatio >= 0.7 && durationRatio <= 1.5) {
      // Normal task completion - slightly reduce suspicion
      this.adjustSuspicion(agentId, lastObs.agentName, -5, 
        `Completed ${lastObs.taskType} normally`,
        'task_behavior'
      );
    }
    
    return lastObs;
  }
  
  // ========== Conversation Recording ==========
  
  recordConversation(conv: Omit<ConversationEntry, 'id' | 'timestamp'>): void {
    const entry: ConversationEntry = {
      ...conv,
      id: `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };
    
    this.conversations.push(entry);
    
    if (this.conversations.length > this.config.maxConversations) {
      this.conversations.shift();
    }
    
    // If this is an accusation, also record it separately
    if (conv.topic === 'accusation' && conv.mentionedAgentIds && conv.mentionedAgentIds.length > 0) {
      for (const accusedId of conv.mentionedAgentIds) {
        this.recordAccusation({
          accuserId: conv.speakerId,
          accuserName: conv.speakerName,
          accusedId,
          accusedName: accusedId, // Will be resolved later
          reason: conv.message,
          zone: conv.zone,
          resolved: false,
        });
      }
    }
  }
  
  recordHeardSpeech(speakerId: string, speakerName: string, message: string, zone: string | null): void {
    // Parse message for topics
    const topic = this.analyzeMessageTopic(message);
    const mentionedAgents = this.extractMentionedAgents(message);
    
    this.recordConversation({
      speakerId,
      speakerName,
      message,
      zone,
      topic,
      mentionedAgentIds: mentionedAgents,
    });
  }
  
  private analyzeMessageTopic(message: string): ConversationEntry['topic'] {
    const lowerMsg = message.toLowerCase();
    
    if (lowerMsg.includes('sus') || lowerMsg.includes('suspicious') || lowerMsg.includes('saw') || lowerMsg.includes('vent') || lowerMsg.includes('killed') || lowerMsg.includes('impostor')) {
      return 'accusation';
    }
    if (lowerMsg.includes('wasn\'t me') || lowerMsg.includes('i was') || lowerMsg.includes('i did') || lowerMsg.includes('innocent')) {
      return 'defense';
    }
    if (lowerMsg.includes('where were you') || lowerMsg.includes('what were you') || lowerMsg.includes('?')) {
      return 'question';
    }
    if (lowerMsg.includes('agree') || lowerMsg.includes('yeah') || lowerMsg.includes('true') || lowerMsg.includes('right')) {
      return 'agreement';
    }
    if (lowerMsg.includes('disagree') || lowerMsg.includes('no') || lowerMsg.includes('wrong') || lowerMsg.includes('false')) {
      return 'disagreement';
    }
    if (lowerMsg.includes('task') || lowerMsg.includes('saw') || lowerMsg.includes('went to')) {
      return 'information';
    }
    
    return 'small_talk';
  }
  
  private extractMentionedAgents(message: string): string[] {
    // This will be populated by the agent manager with actual agent names
    // For now, return empty - will be enhanced when integrated
    return [];
  }
  
  // ========== Accusation Recording ==========
  
  recordAccusation(acc: Omit<AccusationEntry, 'id' | 'timestamp'>): void {
    const entry: AccusationEntry = {
      ...acc,
      id: `acc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };
    
    this.accusations.push(entry);
    
    if (this.accusations.length > this.config.maxAccusations) {
      this.accusations.shift();
    }
    
    // Being accused increases your suspicion of the accuser slightly (defensive)
    if (acc.accusedId === this.ownerId) {
      this.adjustSuspicion(acc.accuserId, acc.accuserName, 10, 
        `Accused me: "${acc.reason}"`,
        'accusation'
      );
    }
  }
  
  // ========== Alibi Recording ==========
  
  recordAlibi(alibi: Omit<AlibiEntry, 'id' | 'timestamp'>): void {
    const entry: AlibiEntry = {
      ...alibi,
      id: `alibi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };
    
    this.alibis.push(entry);
    
    if (this.alibis.length > this.config.maxAlibis) {
      this.alibis.shift();
    }
  }
  
  checkAlibi(agentId: string, claimedZone: string, claimedTime: number): { valid: boolean; contradiction?: string } {
    // Check our observations to verify
    const relevantObs = this.observations.filter(obs => 
      obs.subjectId === agentId && 
      Math.abs(obs.timestamp - claimedTime) < 30000 // Within 30 seconds
    );
    
    for (const obs of relevantObs) {
      if (obs.zone && obs.zone !== claimedZone) {
        return {
          valid: false,
          contradiction: `I saw them in ${obs.zone}, not ${claimedZone}`,
        };
      }
    }
    
    return { valid: true };
  }
  
  // ========== Suspicion Management ==========
  
  adjustSuspicion(agentId: string, agentName: string, delta: number, reason: string, category: SuspicionReason['category']): void {
    if (agentId === this.ownerId) return; // Can't suspect yourself
    
    let record = this.suspicionRecords.get(agentId);
    if (!record) {
      record = {
        agentId,
        agentName,
        level: 50, // Start at neutral
        reasons: [],
        lastUpdated: Date.now(),
      };
      this.suspicionRecords.set(agentId, record);
    }
    
    // Add reason
    record.reasons.push({
      timestamp: Date.now(),
      reason,
      delta,
      category,
    });
    
    // Keep only recent reasons (last 20)
    if (record.reasons.length > 20) {
      record.reasons.shift();
    }
    
    // Adjust level with clamping
    record.level = Math.max(0, Math.min(100, record.level + delta));
    record.lastUpdated = Date.now();
  }
  
  getSuspicionLevel(agentId: string): number {
    return this.suspicionRecords.get(agentId)?.level ?? 50;
  }
  
  getSuspicionRecord(agentId: string): SuspicionRecord | undefined {
    return this.suspicionRecords.get(agentId);
  }
  
  getAllSuspicionLevels(): Record<string, number> {
    const levels: Record<string, number> = {};
    for (const [agentId, record] of this.suspicionRecords) {
      levels[agentId] = record.level;
    }
    return levels;
  }
  
  getMostSuspicious(count: number = 3): SuspicionRecord[] {
    return Array.from(this.suspicionRecords.values())
      .sort((a, b) => b.level - a.level)
      .slice(0, count);
  }
  
  getLeastSuspicious(count: number = 3): SuspicionRecord[] {
    return Array.from(this.suspicionRecords.values())
      .sort((a, b) => a.level - b.level)
      .slice(0, count);
  }
  
  // ========== Impostor-Specific Methods ==========
  
  recordMyLie(lie: string): void {
    this.myLies.push(lie);
  }
  
  recordMyFakeTask(taskClaim: string): void {
    this.myFakeTaskClaims.push(taskClaim);
  }
  
  getMyLies(): string[] {
    return this.myLies;
  }
  
  // ========== Query Methods ==========
  
  getRecentObservations(count: number = 10): ObservationEntry[] {
    return this.observations.slice(-count);
  }
  
  getRecentConversations(count: number = 10): ConversationEntry[] {
    return this.conversations.slice(-count);
  }
  
  getConversationsWithAgent(agentId: string, count: number = 5): ConversationEntry[] {
    return this.conversations
      .filter(c => c.speakerId === agentId || c.mentionedAgentIds?.includes(agentId))
      .slice(-count);
  }
  
  getObservationsOfAgent(agentId: string, count: number = 5): ObservationEntry[] {
    return this.observations
      .filter(o => o.subjectId === agentId)
      .slice(-count);
  }
  
  getAccusationsAgainst(agentId: string): AccusationEntry[] {
    return this.accusations.filter(a => a.accusedId === agentId);
  }
  
  getAccusationsBy(agentId: string): AccusationEntry[] {
    return this.accusations.filter(a => a.accuserId === agentId);
  }
  
  getTaskObservationsForAgent(agentId: string): TaskObservation[] {
    return this.taskObservations.get(agentId) ?? [];
  }
  
  // ========== Context Building for LLM ==========
  
  buildMemoryContext(): string {
    const lines: string[] = [];
    
    // Recent observations
    const recentObs = this.getRecentObservations(5);
    if (recentObs.length > 0) {
      lines.push('Recent observations:');
      for (const obs of recentObs) {
        lines.push(`- ${obs.description}`);
      }
    }
    
    // Recent conversations
    const recentConvs = this.getRecentConversations(5);
    if (recentConvs.length > 0) {
      lines.push('\nRecent conversations:');
      for (const conv of recentConvs) {
        lines.push(`- ${conv.speakerName}: "${conv.message}"`);
      }
    }
    
    // Top suspicions
    const suspicious = this.getMostSuspicious(3);
    if (suspicious.length > 0) {
      lines.push('\nSuspicion levels:');
      for (const record of suspicious) {
        if (record.level > 60) {
          const topReason = record.reasons[record.reasons.length - 1];
          lines.push(`- ${record.agentName}: ${record.level}% (${topReason?.reason ?? 'general feeling'})`);
        }
      }
    }
    
    // Recent accusations
    const recentAccusations = this.accusations.slice(-3);
    if (recentAccusations.length > 0) {
      lines.push('\nRecent accusations:');
      for (const acc of recentAccusations) {
        lines.push(`- ${acc.accuserName} accused ${acc.accusedName}: "${acc.reason}"`);
      }
    }
    
    return lines.join('\n');
  }
  
  buildSuspicionContext(): string {
    const lines: string[] = [];
    
    for (const record of this.suspicionRecords.values()) {
      const recentReasons = record.reasons.slice(-3).map(r => r.reason).join('; ');
      lines.push(`${record.agentName}: ${record.level}% - ${recentReasons || 'No specific reason'}`);
    }
    
    return lines.length > 0 ? lines.join('\n') : 'No suspicion data yet.';
  }
  
  // ========== Serialization ==========

  /**
   * Get full memory dump for UI display
   */
  getFullMemory(): {
    observations: ObservationEntry[];
    conversations: ConversationEntry[];
    accusations: AccusationEntry[];
    alibis: AlibiEntry[];
    suspicionRecords: SuspicionRecord[];
  } {
    return {
      observations: [...this.observations],
      conversations: [...this.conversations],
      accusations: [...this.accusations],
      alibis: [...this.alibis],
      suspicionRecords: Array.from(this.suspicionRecords.values()),
    };
  }

  toJSON(): object {
    return {
      ownerId: this.ownerId,
      ownerName: this.ownerName,
      observations: this.observations,
      conversations: this.conversations,
      accusations: this.accusations,
      alibis: this.alibis,
      suspicionRecords: Object.fromEntries(this.suspicionRecords),
      myLies: this.myLies,
      myFakeTaskClaims: this.myFakeTaskClaims,
    };
  }
}
