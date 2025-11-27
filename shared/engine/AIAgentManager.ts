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
import type { WalkableZone, LabeledZone, Task } from '../data/poly3-map.ts';
import type { PlayerRole } from '../types/game.types.ts';
import type { TaskAssignment, AIContext, AIDecision } from '../types/simulation.types.ts';

// ========== Configuration ==========

export interface AgentManagerConfig {
  walkableZones: WalkableZone[];
  labeledZones: LabeledZone[];
  tasks: Task[];
  numAgents: number;
  numImpostors?: number;
  tasksPerAgent?: number;
  aiServerUrl?: string;
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
  
  // AI Decision callbacks (can be set externally for LLM integration)
  private decisionCallback: AIDecisionCallback | null = null;
  private triggerCallback: AITriggerCallback | null = null;
  
  constructor(config: AgentManagerConfig) {
    // Build navigation mesh
    console.log('Building navigation mesh...');
    this.navMeshBuilder = new NavMeshBuilder();
    const navMesh = this.navMeshBuilder.buildFromWalkableZones(config.walkableZones);
    console.log(`Navigation mesh built with ${navMesh.nodes.size} nodes`);
    
    // Initialize pathfinder
    this.pathfinder = new Pathfinder(navMesh, config.walkableZones);
    
    // Initialize zone detector
    this.zoneDetector = new ZoneDetector(config.walkableZones, config.labeledZones);
    const zones = this.zoneDetector.getAllZones();
    console.log(`Zone detector initialized with ${zones.length} zones`);
    
    // Initialize destination selector
    this.destinationSelector = new DestinationSelector(config.walkableZones, config.tasks, navMesh);
    
    // Store available tasks for assignment
    this.availableTasks = config.tasks;
    this.impostorIds = new Set();
    
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
    }
    
    console.log(`Created ${this.agents.length} AI agents (${numImpostors} impostors)`);
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
      
      // Assign role and tasks
      const assignedTasks = this.assignTasksToAgent(tasksPerAgent, role);
      const roleConfig: AIAgentRoleConfig = {
        role,
        assignedTasks
      };
      agent.initializeRole(roleConfig);
      
      this.agents.push(agent);
      
      // Initialize zone detection for starting position
      const zoneEvent = this.zoneDetector.updatePlayerPosition(agent.getId(), startPosition);
      if (zoneEvent) {
        agent.getStateMachine().updateLocation(zoneEvent.toZone, zoneEvent.zoneType);
        console.log(`${agent.getId()} (${agentName}, ${role}) entered ${zoneEvent.toZone}`);
      }
    }
  }
  
  /**
   * Assign random tasks to an agent
   */
  private assignTasksToAgent(count: number, role: PlayerRole): TaskAssignment[] {
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
        isFaking: role === 'IMPOSTOR', // Impostors fake all tasks
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
    // Update all agents synchronously (they no longer block on AI)
    for (const agent of this.agents) {
      // Update agent AI and movement (non-blocking now)
      agent.update(deltaTime);
      
      // Check zone transitions
      const position = agent.getPosition();
      const zoneEvent = this.zoneDetector.updatePlayerPosition(agent.getId(), position);
      
      if (zoneEvent) {
        agent.getStateMachine().updateLocation(zoneEvent.toZone, zoneEvent.zoneType);
      }
    }
  }
  
  /**
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
   */
  private broadcastSpeech(speakerId: string, message: string, zone: string | null): void {
    const speaker = this.agents.find(a => a.getId() === speakerId);
    if (!speaker) return;
    
    const speakerPos = speaker.getPosition();
    const speechRange = 150; // Same as in AIAgent
    
    for (const listener of this.agents) {
      if (listener.getId() === speakerId) continue; // Don't broadcast to self
      
      const listenerPos = listener.getPosition();
      const dx = listenerPos.x - speakerPos.x;
      const dy = listenerPos.y - speakerPos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance <= speechRange) {
        // Listener can hear the speech
        listener.hearSpeech(speakerId, speaker.getName(), message, zone);
      }
    }
  }
  
  /**
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
}
