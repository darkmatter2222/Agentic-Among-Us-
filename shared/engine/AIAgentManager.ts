/**
 * AI Agent Manager (Enhanced with Role & Task Assignment)
 * Manages all AI agents, their roles, tasks, and AI decision-making
 */

import type { Point } from '../data/poly3-map.ts';
import { NavMeshBuilder } from './NavMesh.ts';
import { Pathfinder } from './Pathfinder.ts';
import { ZoneDetector } from './ZoneDetector.ts';
import { DestinationSelector } from './DestinationSelector.ts';
import { AIAgent, type AIAgentConfig, type AIAgentRoleConfig, type AIDecisionCallback, type AITriggerCallback } from './AIAgent.ts';
import { COLOR_NAMES, AGENT_COLORS } from '../constants/colors.ts';
import type { WalkableZone, LabeledZone, Task, Vent } from '../data/poly3-map.ts';
import type { PlayerRole } from '../types/game.types.ts';
import type { TaskAssignment, AIContext, AIDecision } from '../types/simulation.types.ts';
import { KillSystem, type KillSystemConfig, type DeadBody, type KillEvent, type WitnessRecord } from './KillSystem.ts';
import { VentSystem, type VentSystemConfig, type VentEvent, type VentState, type VentWitness } from './VentSystem.ts';
import { SabotageSystem, type SabotageType, type SabotageEvent, type ActiveSabotage } from './SabotageSystem.ts';
import { GhostSystem, type GhostSystemConfig } from './GhostSystem.ts';
import { simLog, killLog, speechLog, zoneLog, moveLog, sabotageLog } from '../logging/index.ts';
import { selectPersonalitiesForGame, type AgentPersonality } from '../data/personalities.ts';

// ========== Configuration ==========

export interface AgentManagerConfig {
  walkableZones: WalkableZone[];
  labeledZones: LabeledZone[];
  tasks: Task[];
  numAgents: number;
  numImpostors?: number;
  tasksPerAgent?: number;
  aiServerUrl?: string;
  killSystemConfig?: Partial<KillSystemConfig>;
  vents?: Vent[];
  ventSystemConfig?: Partial<VentSystemConfig>;
}

// ========== Task Duration Lookup ==========

function getTaskDuration(taskType: string): number {
  const durations: Record<string, number> = {
    'Swipe Card': 3000,
    'Prime Shields': 3000,
    'Empty Garbage': 4000,
    'Chart Course': 4000,
    'Stabilize Steering': 3000,
    'Unlock Manifolds': 5000,
    'Clean O2 Filter': 5000,
    'Divert Power': 3000,
    'Accept Power': 2000,
    'Start Reactor': 12000,
    'Submit Scan': 10000,
    'Inspect Sample': 60000,
    'Fuel Engines': 8000,
    'Upload Data': 9000,
    'Download Data': 9000,
    'Clear Asteroids': 15000,
    'Fix Wiring': 4000,
    'Calibrate Distributor': 4000,
    'Align Engine Output': 4000
  };
  return durations[taskType] || 5000;
}

// ========== Main Class ==========

export class AIAgentManager {
  private agents: AIAgent[];
  private navMeshBuilder: NavMeshBuilder;
  private pathfinder: Pathfinder;
  private zoneDetector: ZoneDetector;
  private destinationSelector: DestinationSelector;
  private availableTasks: Task[];
  private impostorIds: Set<string>;
  private killSystem: KillSystem;
  private ventSystem: VentSystem;
  private sabotageSystem: SabotageSystem;
  private ghostSystem: GhostSystem;

  // AI Decision callbacks (can be set externally for LLM integration)
  private decisionCallback: AIDecisionCallback | null = null;
  private triggerCallback: AITriggerCallback | null = null;

  // Callback for when agents hear speech (for visual feedback)
  private heardSpeechCallback: ((event: import('../types/simulation.types.ts').HeardSpeechEvent) => void) | null = null;

  // Callback for when agents report bodies (delegates to GameSimulation)
  private reportBodyCallback: ((reporterId: string) => boolean) | null = null;

  constructor(config: AgentManagerConfig) {
    // Build navigation mesh
    simLog.get().info('Building navigation mesh...');
    this.navMeshBuilder = new NavMeshBuilder();
    const navMesh = this.navMeshBuilder.buildFromWalkableZones(config.walkableZones);
    simLog.get().info('Navigation mesh built', { nodeCount: navMesh.nodes.size });
    
    // Initialize pathfinder
    this.pathfinder = new Pathfinder(navMesh, config.walkableZones);
    
    // Initialize zone detector
    this.zoneDetector = new ZoneDetector(config.walkableZones, config.labeledZones);
    const zones = this.zoneDetector.getAllZones();
    zoneLog.get().info('Zone detector initialized', { zoneCount: zones.length });
    
    // Initialize destination selector
    this.destinationSelector = new DestinationSelector(config.walkableZones, config.tasks, navMesh);
    
    // Store available tasks for assignment
    this.availableTasks = config.tasks;
    this.impostorIds = new Set();
    
    // Initialize kill system with config or defaults
    this.killSystem = new KillSystem(config.killSystemConfig || {});
    
    // Initialize vent system with map vents and line-of-sight checker
    this.ventSystem = new VentSystem(
      config.vents || [],
      (from, to) => this.pathfinder.hasLineOfSight(from, to),
      config.ventSystemConfig || {}
    );

    // Initialize sabotage system
    this.sabotageSystem = new SabotageSystem();

    // Initialize ghost system
    this.ghostSystem = new GhostSystem();
    this.ghostSystem.setOnBecomeGhostCallback((agentId) => {
      this.handleBecomeGhost(agentId);
    });

    // Create agents with roles and tasks
    this.agents = [];
    const numImpostors = config.numImpostors ?? 2;
    const tasksPerAgent = config.tasksPerAgent ?? 5;
    
    this.createAgentsWithRoles(config.numAgents, zones, numImpostors, tasksPerAgent);
    
    // Set up cross-references for visibility
    for (const agent of this.agents) {
      agent.setOtherAgents(this.agents);
      // Set up speech broadcasting
      agent.setSpeechBroadcastCallback((speakerId, message, zone) => {
        this.broadcastSpeech(speakerId, message, zone);
      });
      // Set up kill request callback for impostors
      agent.setKillRequestCallback((killerId, targetId) => {
        return this.handleKillRequest(killerId, targetId);
      });
      // Set up body report callback
      agent.setReportBodyCallback((reporterId) => {
        return this.handleReportBody(reporterId);
      });
      // Set up vent callbacks for impostors
      if (this.impostorIds.has(agent.getId())) {
        agent.setVentCallbacks(
          (impostorId: string, ventId: string) => {
            const event = this.attemptEnterVent(impostorId, ventId);
            return event !== null;
          },
          (impostorId: string) => {
            const event = this.attemptExitVent(impostorId);
            return event !== null;
          },
          (impostorId: string, targetVentId: string) => {
            const event = this.attemptVentTravel(impostorId, targetVentId);
            return event !== null;
          },
          (impostorId: string) => {
            return this.buildVentContext(impostorId);
          }
        );
        // Set up sabotage callback for impostor
        agent.setSabotageCallback((impostorId: string, sabotageType: SabotageType) => {
          return this.attemptSabotage(impostorId, sabotageType) !== null;
        });
      }

      // Set up sabotage context callback for all agents (crewmates need to see active sabotages)
      agent.setSabotageContextCallback((agentId: string) => {
        return this.buildSabotageContext(agentId);
      });
    }

    // Initialize kill system with impostor IDs
    for (const impostorId of this.impostorIds) {
      this.killSystem.initializeImpostor(impostorId);
    }
    
    simLog.get().info('Created AI agents', { count: this.agents.length, impostors: numImpostors });
    killLog.get().info('Kill system initialized', { impostorCount: this.impostorIds.size });
  }
  
  /**
   * Set AI callbacks for LLM integration
   */
  setAICallbacks(
    decisionCallback: AIDecisionCallback,
    triggerCallback: AITriggerCallback
  ): void {
    this.decisionCallback = decisionCallback;
    this.triggerCallback = triggerCallback;

    // Propagate to all agents
    for (const agent of this.agents) {
      agent.setAICallbacks(decisionCallback, triggerCallback);
    }
  }

  /**
   * Set callback for when agents hear speech (for visual feedback on client)
   */
  setHeardSpeechCallback(callback: (event: import('../types/simulation.types.ts').HeardSpeechEvent) => void): void {
    this.heardSpeechCallback = callback;
  }

  /**
   * Set callback for body reports (delegates to GameSimulation.reportBody)
   */
  setReportBodyCallback(callback: (reporterId: string) => boolean): void {
    this.reportBodyCallback = callback;
  }

  /**
   * Create AI agents with randomly assigned roles and tasks
   */
  private createAgentsWithRoles(
    numAgents: number,
    zones: ReturnType<ZoneDetector['getAllZones']>,
    numImpostors: number,
    tasksPerAgent: number
  ): void {
    const walkableZones = zones.filter(z => z.isWalkable);

    // Randomly select impostors
    const indices = Array.from({ length: numAgents }, (_, i) => i);
    this.shuffleArray(indices);
    const impostorIndices = new Set(indices.slice(0, numImpostors));

    // Select personalities for this game
    const crewmateCount = numAgents - numImpostors;
    const { crewmatePersonalities, impostorPersonalities } = selectPersonalitiesForGame(crewmateCount, numImpostors);
    
    // Track which personalities have been assigned
    let crewmatePersonalityIndex = 0;
    let impostorPersonalityIndex = 0;

    for (let i = 0; i < numAgents; i++) {
      // Select random starting zone
      const zone = walkableZones[Math.floor(Math.random() * walkableZones.length)];

      // Get a random point in that zone
      const startPosition = this.destinationSelector.selectRandomDestination(
        zone.center,
        [zone],
        { avoidEdges: true }
      ) || zone.center;

      const role: PlayerRole = impostorIndices.has(i) ? 'IMPOSTOR' : 'CREWMATE';
      const colorIndex = i % COLOR_NAMES.length;
      const agentName = COLOR_NAMES[colorIndex];
      const agentColor = AGENT_COLORS[colorIndex];

      // Select personality based on role
      let personality: AgentPersonality;
      if (role === 'IMPOSTOR') {
        personality = impostorPersonalities[impostorPersonalityIndex++ % impostorPersonalities.length];
      } else {
        personality = crewmatePersonalities[crewmatePersonalityIndex++ % crewmatePersonalities.length];
      }

      if (role === 'IMPOSTOR') {
        this.impostorIds.add(`agent_${i}`);
      }

      const agentConfig: AIAgentConfig = {
        id: `agent_${i}`,
        name: agentName,
        color: agentColor,
        startPosition,
        baseSpeed: 80 + Math.random() * 40, // 80-120 units/sec
        visionRadius: 150,
        actionRadius: 50
      };

      const agent = new AIAgent(
        agentConfig,
        this.pathfinder,
        this.destinationSelector,
        zones
      );

      // Assign role, tasks, and personality (impostors don't get tasks - they can only fake)
      const assignedTasks = role === 'CREWMATE' ? this.assignTasksToAgent(tasksPerAgent) : [];
      const roleConfig: AIAgentRoleConfig = {
        role,
        assignedTasks,
        personalityId: personality.id
      };
      agent.initializeRole(roleConfig);

      simLog.get().info('Agent created with personality', { 
        agentId: agent.getId(), 
        agentName, 
        role, 
        personalityId: personality.id,
        personalityName: personality.name 
      });

      this.agents.push(agent);      // Initialize zone detection for starting position
      const zoneEvent = this.zoneDetector.updatePlayerPosition(agent.getId(), startPosition);
      if (zoneEvent) {
        agent.getStateMachine().updateLocation(zoneEvent.toZone, zoneEvent.zoneType);
        zoneLog.get().debug('Agent entered zone', { agentId: agent.getId(), agentName, role, zone: zoneEvent.toZone });
      }
    }
  }
  
  /**
   * Assign random tasks to a crewmate agent
   */
  private assignTasksToAgent(count: number): TaskAssignment[] {
    const assignments: TaskAssignment[] = [];
    const shuffledTasks = [...this.availableTasks];
    this.shuffleArray(shuffledTasks);
    
    for (let i = 0; i < Math.min(count, shuffledTasks.length); i++) {
      const task = shuffledTasks[i];
      assignments.push({
        taskType: task.type,
        room: task.room,
        position: { x: task.position.x, y: task.position.y },
        isCompleted: false,
        isFaking: false,
        duration: getTaskDuration(task.type)
      });
    }
    
    return assignments;
  }
  
  /**
   * Fisher-Yates shuffle
   */
  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }
  
  /**
   * Update all agents (call every frame) - NON-BLOCKING
   */
  update(deltaTime: number): void {
    const currentTime = Date.now();

    // Update kill system (cooldowns, animations)
    this.killSystem.update(deltaTime);

    // Update ghost system (auto-ghost transitions after timeout)
    this.ghostSystem.update(deltaTime);    // Collect all agent data for kill system target updates
    const agentDataForKillSystem: Array<{
      id: string;
      position: Point;
      role: PlayerRole;
      state: import('../types/game.types.ts').PlayerState;
    }> = [];
    
    // Collect agent data for witness detection
    const agentDataForWitness: Array<{
      id: string;
      position: Point;
      isDead: boolean;
      facingDirection: number;
      visionRadius: number;
    }> = [];
    
    for (const agent of this.agents) {
      agentDataForKillSystem.push({
        id: agent.getId(),
        position: agent.getPosition(),
        role: agent.getRole(),
        state: agent.getPlayerState()
      });
      
      agentDataForWitness.push({
        id: agent.getId(),
        position: agent.getPosition(),
        isDead: agent.getPlayerState() === 'DEAD',
        facingDirection: agent.getFacing(),
        visionRadius: agent.getVisionRadius()
      });
    }
    
    // Update targets in range for each impostor
    for (const impostorId of this.impostorIds) {
      const impostor = this.getAgent(impostorId);
      if (!impostor || impostor.getPlayerState() === 'DEAD') continue;
      
      this.killSystem.updateTargetsInRange(
        impostorId,
        impostor.getPosition(),
        agentDataForKillSystem
      );
    }
    
    // Update all agents synchronously (they no longer block on AI)
    for (const agent of this.agents) {
      // Skip dead agents' AI (they don't move or make decisions)
      if (agent.getPlayerState() === 'DEAD') continue;
      
      // Update agent AI and movement (non-blocking now)
      agent.update(deltaTime);
      
      // Check zone transitions
      const position = agent.getPosition();
      const zoneEvent = this.zoneDetector.updatePlayerPosition(agent.getId(), position);
      
      if (zoneEvent) {
        agent.getStateMachine().updateLocation(zoneEvent.toZone, zoneEvent.zoneType);
      }
      
      // Update visible bodies for crewmates
      if (agent.getRole() === 'CREWMATE') {
        const bodies = this.killSystem.getBodies();
        agent.updateVisibleBodies(bodies);
      }
    }
  }
  
  /**
   * Attempt a kill from an impostor
   * Returns the kill event if successful, null if failed
   */
  attemptKill(impostorId: string, targetId: string): KillEvent | null {
    const impostor = this.getAgent(impostorId);
    const target = this.getAgent(targetId);
    
    if (!impostor || !target) {
      killLog.get().warn('Kill attempt failed: Invalid agents', { impostorId, targetId });
      return null;
    }
    
    if (target.getPlayerState() !== 'ALIVE') {
      killLog.get().warn('Kill attempt failed: Target is already dead', { targetId });
      return null;
    }
    
    // Get zone for the kill location
    const zone = this.zoneDetector.getZoneAtPosition(target.getPosition());
    
    // Collect nearby agents for witness detection
    const nearbyAgents: Array<{
      id: string;
      name: string;
      position: Point;
      facing: number;
      visionRadius: number;
    }> = [];
    
    for (const agent of this.agents) {
      if (agent.getId() === impostorId || agent.getId() === targetId) continue;
      if (agent.getPlayerState() !== 'ALIVE') continue;
      
      nearbyAgents.push({
        id: agent.getId(),
        name: agent.getName(),
        position: agent.getPosition(),
        facing: agent.getFacing(),
        visionRadius: agent.getVisionRadius()
      });
    }
    
    // Attempt the kill through the kill system
    const killAttempt = this.killSystem.attemptKill(
      impostorId,
      impostor.getName(),
      impostor.getPosition(),
      targetId,
      target.getName(),
      target.getColor(),
      target.getPosition(),
      zone?.name || null,
      nearbyAgents
    );
    
    if (!killAttempt.success || !killAttempt.body) {
      killLog.get().debug('Kill attempt failed', { reason: killAttempt.reason });
      return null;
    }

    // Kill succeeded! Update the target agent
    target.setPlayerState('DEAD');

    // Register death with ghost system - will become ghost when body is reported or after timeout
    this.ghostSystem.registerDeath(targetId, impostorId);    // Create the kill event to return
    const killEvent: KillEvent = {
      id: `kill_${Date.now()}`,
      killerId: impostorId,
      killerName: impostor.getName(),
      victimId: targetId,
      victimName: target.getName(),
      position: killAttempt.body.position,
      zone: zone?.name || null,
      timestamp: Date.now(),
      witnesses: killAttempt.witnesses || [],
      bodyId: killAttempt.body.id
    };
    
    // Notify the impostor agent of successful kill
    impostor.onKillSuccess(
      targetId,
      target.getName(),
      killAttempt.body.position
    );
    
    // Notify witnesses
    for (const witness of (killAttempt.witnesses || [])) {
      const witnessAgent = this.getAgent(witness.witnessId);
      if (witnessAgent) {
        // Determine if witness saw directly
        const sawDirectly = witness.sawKill === true;
        
        witnessAgent.witnessKill(
          targetId,
          target.getName(),
          witness.perceivedKillerColor ?? null,
          witness.sawKill ? 1.0 : 0.5, // High confidence if saw kill, medium otherwise
          sawDirectly
        );
      }
    }
    
    killLog.get().info('Kill executed', { impostor: impostor.getName(), target: target.getName(), zone: zone?.name || 'Unknown' });
    if ((killAttempt.witnesses || []).length > 0) {
      killLog.get().debug('Kill witnesses', { witnesses: killAttempt.witnesses!.map(w => w.witnessId) });
    }
    
    return killEvent;
  }
  
  /**
   * Check if an impostor can kill a specific target
   */
  canKill(impostorId: string, targetId: string): boolean {
    const impostor = this.getAgent(impostorId);
    const target = this.getAgent(targetId);
    
    if (!impostor || !target) return false;
    if (target.getPlayerState() !== 'ALIVE') return false;
    
    // Check if kill is ready (cooldown, not in animation)
    const killCheck = this.killSystem.canKill(impostorId);
    if (!killCheck.canKill) return false;
    
    // Check if target is in range
    const targetsInRange = this.killSystem.getTargetsInRange(impostorId);
    return targetsInRange.includes(targetId);
  }
  
  /**
   * Get targets in kill range for an impostor
   */
  getTargetsInRange(impostorId: string): string[] {
    return this.killSystem.getTargetsInRange(impostorId);
  }
  
  /**
   * Get all dead bodies
   */
  getBodies(): DeadBody[] {
    return this.killSystem.getBodies();
  }

  /**
   * Clear all dead bodies from the map (called after body report)
   * Also triggers ghost transition for all dead players
   */
  clearAllBodies(): void {
    this.killSystem.clearAllBodies();
    // When bodies are cleared (after report), all pending ghosts transition to GHOST state
    this.ghostSystem.transitionAllPendingToGhosts();
  }
  
  /**
   * Check if an impostor is currently in kill animation
   */
  isInKillAnimation(impostorId: string): boolean {
    return this.killSystem.isInKillAnimation(impostorId);
  }
  
  /**
   * Get kill cooldown remaining for an impostor
   */
  getKillCooldown(impostorId: string): number {
    return this.killSystem.getCooldownRemaining(impostorId);
  }
  
  /**
   * Get kill status for an impostor (for UI display)
   */
  getKillStatus(impostorId: string): { cooldownRemaining: number; canKill: boolean; hasTargetInRange: boolean; killCount: number } | null {
    if (!this.impostorIds.has(impostorId)) {
      return null; // Not an impostor
    }
    
    const cooldownRemaining = this.killSystem.getCooldownRemaining(impostorId);
    const targetsInRange = this.killSystem.getTargetsInRange(impostorId);
    const hasTargetInRange = targetsInRange.length > 0;
    const cooldownReady = cooldownRemaining <= 0;
    const canKill = cooldownReady && hasTargetInRange && !this.killSystem.isInKillAnimation(impostorId);
    const killCount = this.killSystem.getKillCount(impostorId);
    
    return {
      cooldownRemaining,
      canKill,
      hasTargetInRange,
      killCount,
    };
  }
  
  /**
   * Get the kill system instance (for advanced usage)
   */
  getKillSystem(): KillSystem {
    return this.killSystem;
  }
  
  /**
   * Handle a kill request from an AI agent
   * Returns true if the kill was executed successfully
   */
  private handleKillRequest(killerId: string, targetId: string): boolean {
    // Only impostors can request kills
    if (!this.impostorIds.has(killerId)) {
      killLog.get().warn('Kill request denied: not an impostor', { killerId });
      return false;
    }
    
    // Attempt the kill
    const killEvent = this.attemptKill(killerId, targetId);
    return killEvent !== null;
  }

  /**
   * Handle a body report request from an AI agent
   * Returns true if the report was successful
   */
  private handleReportBody(reporterId: string): boolean {
    killLog.get().info('AIAgentManager.handleReportBody called', { 
      reporterId, 
      hasExternalCallback: !!this.reportBodyCallback 
    });

    // Delegate to the external callback (GameSimulation.reportBody)
    if (!this.reportBodyCallback) {
      killLog.get().warn('Body report failed: no external callback set', { reporterId });
      return false;
    }

    const result = this.reportBodyCallback(reporterId);
    killLog.get().info('External body report callback returned', { reporterId, success: result });
    return result;
  }  /**
   * Get overall task progress (crewmate tasks only)
   */
  getTaskProgress(): number {
    let totalTasks = 0;
    let completedTasks = 0;
    
    for (const agent of this.agents) {
      if (agent.getRole() === 'CREWMATE') {
        const tasks = agent.getAssignedTasks();
        totalTasks += tasks.length;
        completedTasks += tasks.filter(t => t.isCompleted).length;
      }
    }
    
    return totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
  }
  
  
  /**
   * Broadcast speech from one agent to all agents in hearing range
   * Ghost rules:
   * - DEAD agents can't speak (body on ground)
   * - GHOST agents can speak but only to other GHOSTs
   * - ALIVE agents can speak to other ALIVE agents
   * - GHOSTs can hear ALIVE agents (optionally, based on config)
   */
  private broadcastSpeech(speakerId: string, message: string, zone: string | null): void {
    const speaker = this.agents.find(a => a.getId() === speakerId);
    if (!speaker) {
      speechLog.get().warn('broadcastSpeech: Speaker not found', { speakerId });
      return;
    }

    // Dead agents (body on ground) can't speak
    if (speaker.getPlayerState() === 'DEAD') {
      speechLog.get().debug('broadcastSpeech: Speaker is dead (body)', { speakerName: speaker.getName() });
      return;
    }

    const isGhostSpeaker = speaker.getPlayerState() === 'GHOST';
    speechLog.get().info('Broadcasting speech', { 
      speakerName: speaker.getName(), 
      messagePreview: message.substring(0, 50), 
      zone,
      isGhost: isGhostSpeaker 
    });

    const speakerPos = speaker.getPosition();
    let listenersReached = 0;

    for (const listener of this.agents) {
      if (listener.getId() === speakerId) continue; // Don't broadcast to self

      // Check ghost communication rules
      if (!this.ghostSystem.canHear(listener.getId(), listener.getPlayerState(), speakerId, speaker.getPlayerState())) {
        continue;
      }

      const listenerPos = listener.getPosition();
      const dx = listenerPos.x - speakerPos.x;
      const dy = listenerPos.y - speakerPos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Speech hearing uses the same criteria as vision:
      // Must be within listener's vision radius (line of sight is implied by being able to "see" the speaker)
      // This means speech can't travel through walls or across the map
      const hearingRange = listener.getVisionRadius();

      if (distance <= hearingRange) {
        // Listener can hear the speech (they can see the speaker)
        listener.hearSpeech(speakerId, speaker.getName(), message, zone);
        listenersReached++;

        // Emit heard event for visual feedback on client
        if (this.heardSpeechCallback) {
          const isDirectlyAddressed = message.toLowerCase().includes(listener.getName().toLowerCase());
          this.heardSpeechCallback({
            id: `heard-${Date.now()}-${listener.getId()}`,
            listenerId: listener.getId(),
            listenerName: listener.getName(),
            speakerId: speakerId,
            speakerName: speaker.getName(),
            timestamp: Date.now(),
            message: message.substring(0, 100), // Truncate for event
            distance: distance,
            isDirectlyAddressed,
          });
        }
      }
    }

    speechLog.get().debug('Speech reached listeners', { speakerName: speaker.getName(), listenersReached });
  }/**
   * Get all agents
   */
  getAgents(): AIAgent[] {
    return this.agents;
  }
  
  /**
   * Get agent by ID
   */
  getAgent(id: string): AIAgent | undefined {
    return this.agents.find(a => a.getId() === id);
  }
  
  /**
   * Get zone detector
   */
  getZoneDetector(): ZoneDetector {
    return this.zoneDetector;
  }
  
  /**
   * Get pathfinder
   */
  getPathfinder(): Pathfinder {
    return this.pathfinder;
  }
  
  /**
   * Get all agent positions
   */
  getAgentPositions(): Map<string, Point> {
    const positions = new Map<string, Point>();
    for (const agent of this.agents) {
      positions.set(agent.getId(), agent.getPosition());
    }
    return positions;
  }
  
  /**
   * Check if agent is an impostor (for debugging/UI)
   */
  isImpostor(agentId: string): boolean {
    return this.impostorIds.has(agentId);
  }
  
  /**
   * Get impostor IDs (for debugging)
   */
  getImpostorIds(): string[] {
    return Array.from(this.impostorIds);
  }

  // ==================== VENT SYSTEM METHODS ====================

  /**
   * Get the vent system instance
   */
  getVentSystem(): VentSystem {
    return this.ventSystem;
  }

  /**
   * Attempt to enter a vent (impostor only)
   */
  attemptEnterVent(impostorId: string, ventId: string): VentEvent | null {
    // Verify impostor
    if (!this.impostorIds.has(impostorId)) {
      return null;
    }

    const impostor = this.agents.find(a => a.getId() === impostorId);
    if (!impostor || impostor.getPlayerState() !== 'ALIVE') {
      return null;
    }

    // Build player location info for witness detection
    const allPlayers: import('./VentSystem.ts').PlayerLocationInfo[] = this.agents.map(a => ({
      id: a.getId(),
      name: a.getName(),
      position: a.getPosition(),
      visionRadius: a.getVisionRadius(),
      isAlive: a.getPlayerState() === 'ALIVE',
      role: a.getRole() as 'CREWMATE' | 'IMPOSTOR',
      isInVent: this.ventSystem.getPlayerVentState(a.getId()).isInVent,
    }));

    const ventEvent = this.ventSystem.enterVent(
      impostorId,
      impostor.getName(),
      impostor.getPosition(),
      'IMPOSTOR',
      ventId,
      allPlayers
    );

    if (ventEvent) {
      // Update agent state to be in vent
      impostor.setInVent(true, ventId);

      // Record memories for witnesses
      for (const witness of ventEvent.witnesses || []) {
        const witnessAgent = this.agents.find(a => a.getId() === witness.id);
        if (witnessAgent) {
          witnessAgent.getMemory().addObservation({
            type: 'VENT_SEEN',
            agentId: impostorId,
            ventId,
            action: 'enter',
            location: impostor.getCurrentZone(),
          });
        }
      }

      return ventEvent;
    }

    return null;
  }  /**
   * Attempt to exit a vent (impostor only)
   * Exits at the current vent location
   */
  attemptExitVent(impostorId: string): VentEvent | null {
    // Verify impostor
    if (!this.impostorIds.has(impostorId)) {
      return null;
    }

    const impostor = this.agents.find(a => a.getId() === impostorId);
    if (!impostor) {
      return null;
    }

    // Get the vent they're currently in
    const ventState = this.ventSystem.getPlayerVentState(impostorId);
    if (!ventState.isInVent || !ventState.currentVentId) {
      return null;
    }

    const vent = this.ventSystem.getVent(ventState.currentVentId);
    if (!vent) {
      return null;
    }

    // Build player location info for witness detection
    const allPlayers: import('./VentSystem.ts').PlayerLocationInfo[] = this.agents.map(a => ({
      id: a.getId(),
      name: a.getName(),
      position: a.getPosition(),
      visionRadius: a.getVisionRadius(),
      isAlive: a.getPlayerState() === 'ALIVE',
      role: a.getRole() as 'CREWMATE' | 'IMPOSTOR',
      isInVent: this.ventSystem.getPlayerVentState(a.getId()).isInVent,
    }));

    // Exit at current vent (same destination as current)
    const ventEvent = this.ventSystem.exitVent(
      impostorId,
      impostor.getName(),
      ventState.currentVentId,
      allPlayers
    );

    if (ventEvent) {
      // Update agent state - no longer in vent and teleport to vent position
      impostor.setInVent(false, undefined);
      impostor.setPosition(vent.position);

      // Record memories for witnesses
      for (const witness of ventEvent.witnesses || []) {
        const witnessAgent = this.agents.find(a => a.getId() === witness.id);
        if (witnessAgent) {
          witnessAgent.getMemory().addObservation({
            type: 'VENT_SEEN',
            agentId: impostorId,
            ventId: ventState.currentVentId,
            action: 'exit',
            location: vent.room,
          });
        }
      }

      return ventEvent;
    }

    return null;
  }

  /**
   * Travel between connected vents while inside (impostor only)
   */
  attemptVentTravel(impostorId: string, targetVentId: string): VentEvent | null {
    // Verify impostor
    if (!this.impostorIds.has(impostorId)) {
      return null;
    }

    const impostor = this.agents.find(a => a.getId() === impostorId);
    if (!impostor) {
      return null;
    }

    const success = this.ventSystem.travelInVent(impostorId, targetVentId);

    if (success) {
      // Update the agent's current vent
      impostor.setInVent(true, targetVentId);
      
      // Get destination vent info for the event
      const destVent = this.ventSystem.getVent(targetVentId);
      
      // Return a VentEvent for the travel
      const event: VentEvent = {
        type: 'VENT',
        timestamp: Date.now(),
        playerId: impostorId,
        playerName: impostor.getName(),
        ventId: targetVentId,
        ventRoom: destVent?.room || 'unknown',
        action: 'travel',
        witnesses: [], // Travel is hidden inside vents
      };
      return event;
    }

    return null;
  }

  /**
   * Get vent context for AI decision making
   */
  getVentContext(impostorId: string): {
    isInVent: boolean;
    currentVentId: string | null;
    connectedVents: string[];
    nearbyVents: Array<{ ventId: string; distance: number; room: string }>;
    ventCooldownRemaining: number;
  } | null {
    if (!this.impostorIds.has(impostorId)) {
      return null;
    }

    const impostor = this.agents.find(a => a.getId() === impostorId);
    if (!impostor) {
      return null;
    }

    const ventState = this.ventSystem.getPlayerVentState(impostorId);
    const nearbyVents = this.ventSystem.getVentsInRange(impostor.getPosition());

    // Get connected vents if currently in a vent
    let connectedVents: string[] = [];
    if (ventState.isInVent && ventState.currentVentId) {
      const currentVent = this.ventSystem.getVent(ventState.currentVentId);
      if (currentVent) {
        connectedVents = currentVent.connectedTo;
      }
    }

    return {
      isInVent: ventState.isInVent,
      currentVentId: ventState.currentVentId,
      connectedVents,
      nearbyVents: nearbyVents.map(v => ({
        ventId: v.id,
        distance: Math.sqrt(
          Math.pow(v.position.x - impostor.getPosition().x, 2) +
          Math.pow(v.position.y - impostor.getPosition().y, 2)
        ),
        room: v.room || 'unknown',
      })),
      ventCooldownRemaining: ventState.cooldownRemaining,
    };
  }

  /**
   * Build vent context for AI decision making (returns format matching AIContext['ventContext'])
   */
  buildVentContext(impostorId: string): import('../types/simulation.types.ts').AIContext['ventContext'] {
    if (!this.impostorIds.has(impostorId)) {
      return {
        isInVent: false,
        currentVentId: null,
        connectedVents: [],
        nearbyVents: [],
        ventCooldownRemaining: 0,
      };
    }

    const impostor = this.agents.find(a => a.getId() === impostorId);
    if (!impostor) {
      return {
        isInVent: false,
        currentVentId: null,
        connectedVents: [],
        nearbyVents: [],
        ventCooldownRemaining: 0,
      };
    }

    const ventState = this.ventSystem.getPlayerVentState(impostorId);
    const nearbyVentsRaw = this.ventSystem.getVentsInRange(impostor.getPosition());

    // Calculate witness risk for each vent
    const calculateWitnessRisk = (ventPosition: { x: number; y: number }): number => {
      let witnessCount = 0;
      for (const agent of this.agents) {
        if (agent.getId() === impostorId || agent.getPlayerState() !== 'ALIVE') continue;
        const dist = Math.sqrt(
          Math.pow(agent.getPosition().x - ventPosition.x, 2) +
          Math.pow(agent.getPosition().y - ventPosition.y, 2)
        );
        if (dist < agent.getVisionRadius()) {
          witnessCount++;
        }
      }
      // Convert witness count to risk percentage (0 witnesses = 0%, 3+ = 100%)
      return Math.min(100, witnessCount * 33);
    };

    // Build connected vents if in a vent
    let connectedVents: Array<{ id: string; room: string; witnessRisk: number }> = [];
    if (ventState.isInVent && ventState.currentVentId) {
      const currentVent = this.ventSystem.getVent(ventState.currentVentId);
      if (currentVent) {
        connectedVents = currentVent.connectedTo.map(ventId => {
          const vent = this.ventSystem.getVent(ventId);
          return {
            id: ventId,
            room: vent?.room || 'unknown',
            witnessRisk: vent ? calculateWitnessRisk(vent.position) : 100,
          };
        });
      }
    }

    // Build nearby vents if not in a vent
    const nearbyVents = nearbyVentsRaw.map(v => {
      const distance = Math.sqrt(
        Math.pow(v.position.x - impostor.getPosition().x, 2) +
        Math.pow(v.position.y - impostor.getPosition().y, 2)
      );
      return {
        id: v.id,
        room: v.room || 'unknown',
        distance,
        canEnter: distance <= 1.5, // Interaction range
        witnessRisk: calculateWitnessRisk(v.position),
      };
    });

    return {
      isInVent: ventState.isInVent,
      currentVentId: ventState.currentVentId,
      connectedVents,
      nearbyVents,
      ventCooldownRemaining: ventState.cooldownRemaining,
    };
  }

  /**
   * Check if an impostor can enter a specific vent
   */
  canEnterVent(impostorId: string, ventId: string): boolean {
    if (!this.impostorIds.has(impostorId)) {
      return false;
    }

    const impostor = this.agents.find(a => a.getId() === impostorId);
    if (!impostor || impostor.getPlayerState() !== 'ALIVE') {
      return false;
    }

    return this.ventSystem.canEnterVent(impostorId, impostor.getPosition(), ventId).canEnter;
  }

  /**
   * Check if an impostor can exit their current vent
   */
  canExitVent(impostorId: string): boolean {
    return this.ventSystem.canExitVent(impostorId).canExit;
  }

  /**
   * Get recent vent events for UI/state
   */
  getRecentVentEvents(): VentEvent[] {
    return this.ventSystem.getRecentEvents();
  }

  /**
   * Get list of player IDs currently in vents
   */
  getPlayersInVents(): string[] {
    return this.ventSystem.getPlayersInVents();
  }

  // ==================== SABOTAGE METHODS ====================

  /**
   * Attempt to start a sabotage (impostor only)
   */
  attemptSabotage(impostorId: string, sabotageType: SabotageType): SabotageEvent | null {
    // Verify impostor
    if (!this.impostorIds.has(impostorId)) {
      sabotageLog.get().warn('Non-impostor attempted sabotage', { playerId: impostorId, sabotageType });
      return null;
    }

    const impostor = this.agents.find(a => a.getId() === impostorId);
    if (!impostor || impostor.getPlayerState() !== 'ALIVE') {
      sabotageLog.get().warn('Dead or missing impostor attempted sabotage', { playerId: impostorId });
      return null;
    }

    const event = this.sabotageSystem.startSabotage(sabotageType, impostorId);
    
    if (event) {
      sabotageLog.get().info('Sabotage started', { 
        playerId: impostorId,
        sabotageType,
        event 
      });
    }

    return event;
  }

  /**
   * Attempt to fix a sabotage (any alive player)
   */
  attemptFixSabotage(playerId: string, sabotageType: SabotageType): boolean {
    const player = this.agents.find(a => a.getId() === playerId);
    if (!player || player.getPlayerState() !== 'ALIVE') {
      return false;
    }

    const playerPosition = player.getPosition();
    return this.sabotageSystem.attemptFix(sabotageType, playerId, playerPosition);
  }

  /**
   * Build sabotage context for AI decision making
   */
  buildSabotageContext(agentId: string): import('../types/simulation.types.ts').AIContext['sabotageContext'] {
    const isImpostor = this.impostorIds.has(agentId);
    const context = this.sabotageSystem.getSabotageContext();

    return {
      activeSabotage: context.activeSabotage ? {
        type: context.activeSabotage.type,
        timeRemaining: context.activeSabotage.timeRemaining,
        fixProgress: context.activeSabotage.fixProgress,
        fixLocations: context.activeSabotage.fixLocations,
      } : null,
      cooldownRemaining: isImpostor ? context.cooldownRemaining : 0,
      canSabotage: isImpostor && context.canSabotage,
      availableSabotages: isImpostor ? context.availableSabotages : [],
    };
  }

  /**
   * Update the sabotage system (called each tick)
   */
  updateSabotage(deltaTime: number): void {
    this.sabotageSystem.update(deltaTime);
  }

  /**
   * Get the sabotage system for external configuration (e.g., setting callbacks)
   */
  getSabotageSystem(): SabotageSystem {
    return this.sabotageSystem;
  }

  /**
   * Get current sabotage context for UI/state broadcasting
   */
  getSabotageContext(): ReturnType<SabotageSystem['getSabotageContext']> {
    return this.sabotageSystem.getSabotageContext();
  }

  // ========== Ghost System Methods ==========

  /**
   * Handle an agent becoming a ghost (callback from GhostSystem)
   */
  private handleBecomeGhost(agentId: string): void {
    const agent = this.getAgent(agentId);
    if (!agent) return;

    // Transition the agent to GHOST state
    agent.setPlayerState('GHOST');

    simLog.get().info('Agent became ghost', {
      agentId,
      name: agent.getName(),
      color: agent.getColor(),
    });
  }

  /**
   * Check if an agent is a ghost
   */
  isGhost(agentId: string): boolean {
    return this.ghostSystem.isGhost(agentId);
  }

  /**
   * Check if source agent can see target agent (accounting for ghost rules)
   */
  canSeeAgent(sourceId: string, targetId: string): boolean {
    const source = this.getAgent(sourceId);
    const target = this.getAgent(targetId);
    if (!source || !target) return false;

    return this.ghostSystem.canSee(
      sourceId,
      source.getPlayerState(),
      targetId,
      target.getPlayerState()
    );
  }

  /**
   * Check if source agent can hear target agent (accounting for ghost rules)
   */
  canHearAgent(sourceId: string, targetId: string): boolean {
    const source = this.getAgent(sourceId);
    const target = this.getAgent(targetId);
    if (!source || !target) return false;

    return this.ghostSystem.canHear(
      sourceId,
      source.getPlayerState(),
      targetId,
      target.getPlayerState()
    );
  }

  /**
   * Get vision multiplier for an agent (ghosts get massive vision)
   */
  getVisionMultiplier(agentId: string): number {
    return this.ghostSystem.getVisionMultiplier(agentId);
  }

  /**
   * Get the ghost system for external access
   */
  getGhostSystem(): GhostSystem {
    return this.ghostSystem;
  }

  /**
   * Get all ghost agent IDs
   */
  getAllGhostIds(): string[] {
    return this.ghostSystem.getAllGhostIds();
  }

  /**
   * Record a task completion by a ghost
   */
  recordGhostTaskCompletion(agentId: string): void {
    this.ghostSystem.recordGhostTaskCompletion(agentId);
  }
}
