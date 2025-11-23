/**
 * AI Agent Manager
 * Manages all AI agents, their movement, and interactions
 */

import type { Point } from '../data/poly3-map.ts';
import { NavMeshBuilder } from './NavMesh.ts';
import { Pathfinder } from './Pathfinder.ts';
import { ZoneDetector } from './ZoneDetector.ts';
import { DestinationSelector } from './DestinationSelector.ts';
import { AIAgent, type AIAgentConfig } from './AIAgent.ts';
import type { WalkableZone, LabeledZone, Task } from '../data/poly3-map.ts';

export interface AgentManagerConfig {
  walkableZones: WalkableZone[];
  labeledZones: LabeledZone[];
  tasks: Task[];
  numAgents: number;
}

export class AIAgentManager {
  private agents: AIAgent[];
  private navMeshBuilder: NavMeshBuilder;
  private pathfinder: Pathfinder;
  private zoneDetector: ZoneDetector;
  private destinationSelector: DestinationSelector;
  
  constructor(config: AgentManagerConfig) {
    // Build navigation mesh
    console.log('Building navigation mesh...');
    this.navMeshBuilder = new NavMeshBuilder();
    const navMesh = this.navMeshBuilder.buildFromWalkableZones(config.walkableZones);
    console.log(`Navigation mesh built with ${navMesh.nodes.size} nodes`);
    
    // Initialize pathfinder
    this.pathfinder = new Pathfinder(navMesh);
    
    // Initialize zone detector
    this.zoneDetector = new ZoneDetector(config.walkableZones, config.labeledZones);
    const zones = this.zoneDetector.getAllZones();
    console.log(`Zone detector initialized with ${zones.length} zones`);
    
    // Initialize destination selector
    this.destinationSelector = new DestinationSelector(config.walkableZones, config.tasks);
    
    // Create agents
    this.agents = [];
    this.createAgents(config.numAgents, zones);
    console.log(`Created ${this.agents.length} AI agents`);
  }
  
  /**
   * Create AI agents with random starting positions
   */
  private createAgents(numAgents: number, zones: any[]): void {
    const colors = [
      0xFF0000, // Red
      0x0000FF, // Blue
      0x00FF00, // Green
      0xFFFF00, // Yellow
      0xFF00FF, // Magenta
      0x00FFFF, // Cyan
      0xFFA500, // Orange
      0x800080  // Purple
    ];
    
    const walkableZones = zones.filter(z => z.isWalkable);
    
    for (let i = 0; i < numAgents; i++) {
      // Select random starting zone
      const zone = walkableZones[Math.floor(Math.random() * walkableZones.length)];
      
      // Get a random point in that zone
      const startPosition = this.destinationSelector.selectRandomDestination(
        zone.center,
        [zone],
        { avoidEdges: true }
      ) || zone.center;
      
      const agentConfig: AIAgentConfig = {
        id: `agent_${i}`,
        color: colors[i % colors.length],
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
      
      this.agents.push(agent);
    }
  }
  
  /**
   * Update all agents (call every frame)
   */
  update(deltaTime: number): void {
    for (const agent of this.agents) {
      // Update agent AI and movement
      agent.update(deltaTime);
      
      // Check zone transitions
      const position = agent.getPosition();
      const zoneEvent = this.zoneDetector.updatePlayerPosition(agent.getId(), position);
      
      if (zoneEvent) {
        // Zone changed
        agent.getStateMachine().updateLocation(zoneEvent.toZone, zoneEvent.zoneType);
        console.log(`${agent.getId()} entered ${zoneEvent.toZone} (${zoneEvent.zoneType})`);
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
}
