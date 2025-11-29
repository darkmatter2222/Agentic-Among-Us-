import { useState, useRef, useEffect, useCallback } from 'react';
import './LLMTimelinePanel.css';
import type { LLMTraceEvent } from '@shared/types/llm-trace.types.ts';

const MAX_EVENTS = 200;

interface LLMTimelinePanelProps {
  width?: number;
  events: LLMTraceEvent[];
}

function hexColor(num: number): string {
  return '#' + num.toString(16).padStart(6, '0');
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString('en-US', { 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit' 
  }) + '.' + date.getMilliseconds().toString().padStart(3, '0');
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function getResultSummary(event: LLMTraceEvent): string {
  if (event.requestType === 'decision' && event.parsedDecision) {
    const { goalType, targetAgentId, reasoning } = event.parsedDecision;
    if (goalType === 'KILL' && targetAgentId) {
      return `KILL → ${event.context.visibleAgents.find(a => a.id === targetAgentId)?.name || targetAgentId}`;
    }
    if (goalType === 'FOLLOW_AGENT' && targetAgentId) {
      return `FOLLOW → ${event.context.visibleAgents.find(a => a.id === targetAgentId)?.name || targetAgentId}`;
    }
    if (goalType === 'AVOID_AGENT' && targetAgentId) {
      return `AVOID → ${event.context.visibleAgents.find(a => a.id === targetAgentId)?.name || targetAgentId}`;
    }
    if (goalType === 'GO_TO_TASK') {
      return `TASK → ${event.parsedDecision.targetTaskIndex !== undefined ? `Task ${event.parsedDecision.targetTaskIndex + 1}` : 'next task'}`;
    }
    return `${goalType}${reasoning ? `: ${reasoning.substring(0, 30)}...` : ''}`;
  }
  
  if (event.requestType === 'thought') {
    const thought = event.rawResponse.substring(0, 50);
    return `💭 ${thought}${event.rawResponse.length > 50 ? '...' : ''}`;
  }
  
  if (event.requestType === 'speech' || event.requestType === 'conversation') {
    const speech = event.rawResponse.substring(0, 50);
    return `💬 ${speech}${event.rawResponse.length > 50 ? '...' : ''}`;
  }
  
  return event.rawResponse.substring(0, 50);
}

function getRequestTypeIcon(type: LLMTraceEvent['requestType']): string {
  switch (type) {
    case 'decision': return '🎯';
    case 'thought': return '💭';
    case 'speech': return '💬';
    case 'conversation': return '🗣️';
    default: return '📝';
  }
}

function getGoalTypeColor(goalType?: string): string {
  if (!goalType) return '#888';
  switch (goalType) {
    case 'KILL': return '#ff4444';
    case 'HUNT': return '#ff6b6b';
    case 'FOLLOW_AGENT': return '#4ecdc4';
    case 'AVOID_AGENT': return '#ffa502';
    case 'GO_TO_TASK': return '#2ed573';
    case 'WANDER': return '#70a1ff';
    case 'SPEAK': return '#a29bfe';
    case 'BUDDY_UP': return '#fd79a8';
    case 'CONFRONT': return '#e17055';
    default: return '#888';
  }
}

// Mini map component for the modal
function MiniMap({ agents, highlightAgentId }: {
  agents: LLMTraceEvent['agentPositions'];
  highlightAgentId: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear
    ctx.fillStyle = '#1a1f2e';
    ctx.fillRect(0, 0, width, height);

    // Actual map bounds from poly3-map.ts
    const MAP_MIN_X = 385;
    const MAP_MAX_X = 2617;
    const MAP_MIN_Y = 225;
    const MAP_MAX_Y = 1483;
    const MAP_WIDTH = MAP_MAX_X - MAP_MIN_X;  // ~2232
    const MAP_HEIGHT = MAP_MAX_Y - MAP_MIN_Y; // ~1258

    // Calculate scale to fit canvas with padding
    const padding = 20;
    const availableWidth = width - padding * 2;
    const availableHeight = height - padding * 2;
    const scale = Math.min(availableWidth / MAP_WIDTH, availableHeight / MAP_HEIGHT);

    // Center the map
    const offsetX = padding + (availableWidth - MAP_WIDTH * scale) / 2;
    const offsetY = padding + (availableHeight - MAP_HEIGHT * scale) / 2;

    // Helper to convert map coords to canvas coords
    const toCanvas = (mapX: number, mapY: number) => ({
      x: offsetX + (mapX - MAP_MIN_X) * scale,
      y: offsetY + (mapY - MAP_MIN_Y) * scale
    });

    // Draw map outline
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const topLeft = toCanvas(MAP_MIN_X, MAP_MIN_Y);
    const bottomRight = toCanvas(MAP_MAX_X, MAP_MAX_Y);
    ctx.rect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
    ctx.stroke();

    // Find the highlighted agent
    const highlightedAgent = agents.find(a => a.id === highlightAgentId);

    // Draw vision radius for highlighted agent
    if (highlightedAgent) {
      const pos = toCanvas(highlightedAgent.position.x, highlightedAgent.position.y);
      const VISION_RADIUS = 150; // Game units - typical vision radius
      const visionRadiusCanvas = VISION_RADIUS * scale;

      // Vision range (translucent fill)
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, visionRadiusCanvas, 0, Math.PI * 2);
      ctx.fillStyle = `${hexColor(highlightedAgent.color)}15`;
      ctx.fill();
      ctx.strokeStyle = `${hexColor(highlightedAgent.color)}40`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Kill range for impostors (red inner circle)
      if (highlightedAgent.role === 'IMPOSTOR') {
        const KILL_RANGE = 1.8; // Game units
        const killRadiusCanvas = KILL_RANGE * scale;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, Math.max(killRadiusCanvas, 3), 0, Math.PI * 2);
        ctx.fillStyle = '#ff000030';
        ctx.fill();
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // Draw agents (non-highlighted first, then highlighted on top)
    const sortedAgents = [...agents].sort((a, b) => {
      if (a.id === highlightAgentId) return 1;
      if (b.id === highlightAgentId) return -1;
      return 0;
    });

    sortedAgents.forEach(agent => {
      const pos = toCanvas(agent.position.x, agent.position.y);
      const isHighlight = agent.id === highlightAgentId;
      const radius = isHighlight ? 8 : 5;

      // Draw dead indicator
      if (agent.state === 'DEAD') {
        ctx.beginPath();
        ctx.moveTo(pos.x - 6, pos.y - 6);
        ctx.lineTo(pos.x + 6, pos.y + 6);
        ctx.moveTo(pos.x + 6, pos.y - 6);
        ctx.lineTo(pos.x - 6, pos.y + 6);
        ctx.strokeStyle = hexColor(agent.color);
        ctx.lineWidth = 2;
        ctx.stroke();
        return;
      }

      // Draw circle
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = hexColor(agent.color);
      ctx.fill();

      // Impostor marker (subtle skull)
      if (agent.role === 'IMPOSTOR') {
        ctx.fillStyle = '#000';
        ctx.font = '8px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('☠', pos.x, pos.y + 1);
      }

      if (isHighlight) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Pulsing effect
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = `${hexColor(agent.color)}88`;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Name label
        ctx.font = 'bold 10px sans-serif';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(agent.name, pos.x, pos.y - radius - 6);
      }
    });

    // Draw zone labels (approximate positions)
    ctx.font = '9px sans-serif';
    ctx.fillStyle = '#475569';
    ctx.textAlign = 'center';
    const zones = [
      { name: 'Cafeteria', x: 1500, y: 450 },
      { name: 'Weapons', x: 2200, y: 650 },
      { name: 'Navigation', x: 2400, y: 900 },
      { name: 'Shields', x: 2100, y: 1100 },
      { name: 'Admin', x: 1800, y: 900 },
      { name: 'Storage', x: 1500, y: 1100 },
      { name: 'Electrical', x: 1100, y: 1000 },
      { name: 'Lower Engine', x: 700, y: 1100 },
      { name: 'Upper Engine', x: 700, y: 500 },
      { name: 'Reactor', x: 500, y: 800 },
      { name: 'Security', x: 900, y: 700 },
      { name: 'MedBay', x: 1100, y: 550 },
      { name: 'O2', x: 2000, y: 600 },
      { name: 'Comms', x: 1900, y: 1200 },
    ];
    zones.forEach(zone => {
      const pos = toCanvas(zone.x, zone.y);
      ctx.fillText(zone.name, pos.x, pos.y);
    });

  }, [agents, highlightAgentId]);

  return (
    <canvas
      ref={canvasRef}
      width={400}
      height={280}
      className="llm-trace-mini-map"
    />
  );
}// Modal component for detailed trace view
function TraceDetailModal({ 
  event, 
  onClose 
}: { 
  event: LLMTraceEvent; 
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'prompt' | 'response' | 'context' | 'agents'>('overview');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Copy helper function
  const copyToClipboard = useCallback(async (text: string, fieldName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, []);

  // Copy all as JSON
  const copyAllAsJson = useCallback(() => {
    const jsonData = {
      agent: {
        id: event.agentId,
        name: event.agentName,
        role: event.agentRole,
        color: hexColor(event.agentColor),
      },
      request: {
        type: event.requestType,
        timestamp: event.timestamp,
        durationMs: event.durationMs,
        success: event.success,
      },
      prompts: {
        systemPrompt: event.systemPrompt,
        userPrompt: event.userPrompt,
      },
      response: {
        raw: event.rawResponse,
        parsed: event.parsedDecision,
        error: event.error,
      },
      context: event.context,
      agentPositions: event.agentPositions,
      tokens: {
        prompt: event.promptTokens,
        completion: event.completionTokens,
      },
    };
    copyToClipboard(JSON.stringify(jsonData, null, 2), 'all');
  }, [event, copyToClipboard]);
  
  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
  
  // Close on click outside
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);
  
  return (
    <div className="llm-trace-modal-backdrop" onClick={handleBackdropClick}>
      <div className="llm-trace-modal" ref={modalRef}>
        <div className="llm-trace-modal-header">
          <div className="llm-trace-modal-title">
            <span 
              className="agent-dot" 
              style={{ backgroundColor: hexColor(event.agentColor) }}
            />
            <span className="agent-name">{event.agentName}</span>
            <span className="request-type">{getRequestTypeIcon(event.requestType)} {event.requestType}</span>
            <span className="timestamp">{formatTimestamp(event.timestamp)}</span>
          </div>
          <div className="header-buttons">
            <button 
              className={`copy-all-btn ${copiedField === 'all' ? 'copied' : ''}`}
              onClick={copyAllAsJson}
              title="Copy all data as JSON"
            >
              {copiedField === 'all' ? '✓ Copied' : '📋 Copy All JSON'}
            </button>
            <button className="llm-trace-modal-close" onClick={onClose}>×</button>
          </div>
        </div>
        
        <div className="llm-trace-modal-tabs">
          <button 
            className={`tab ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            Overview
          </button>
          <button 
            className={`tab ${activeTab === 'prompt' ? 'active' : ''}`}
            onClick={() => setActiveTab('prompt')}
          >
            Prompts
          </button>
          <button 
            className={`tab ${activeTab === 'response' ? 'active' : ''}`}
            onClick={() => setActiveTab('response')}
          >
            Response
          </button>
          <button 
            className={`tab ${activeTab === 'context' ? 'active' : ''}`}
            onClick={() => setActiveTab('context')}
          >
            Context
          </button>
          <button 
            className={`tab ${activeTab === 'agents' ? 'active' : ''}`}
            onClick={() => setActiveTab('agents')}
          >
            Agents ({event.agentPositions.length})
          </button>
        </div>
        
        <div className="llm-trace-modal-content">
          {activeTab === 'overview' && (
            <div className="tab-content overview">
              <div className="overview-grid">
                <div className="overview-section map-section">
                  <h4>Agent Positions</h4>
                  <MiniMap agents={event.agentPositions} highlightAgentId={event.agentId} />
                </div>
                
                <div className="overview-section result-section">
                  <h4>Result</h4>
                  {event.parsedDecision ? (
                    <div className="decision-result">
                      <div className="goal-badge" style={{ backgroundColor: getGoalTypeColor(event.parsedDecision.goalType) }}>
                        {event.parsedDecision.goalType}
                      </div>
                      {event.parsedDecision.targetAgentId && (
                        <div className="target-info">
                          <span className="label">Target:</span>
                          <span className="value">
                            {event.context.visibleAgents.find(a => a.id === event.parsedDecision?.targetAgentId)?.name || event.parsedDecision.targetAgentId}
                          </span>
                        </div>
                      )}
                      {event.parsedDecision.reasoning && (
                        <div className="reasoning">
                          <span className="label">Reasoning:</span>
                          <p>{event.parsedDecision.reasoning}</p>
                        </div>
                      )}
                      {event.parsedDecision.thought && (
                        <div className="thought">
                          <span className="label">Thought:</span>
                          <p>"{event.parsedDecision.thought}"</p>
                        </div>
                      )}
                      {event.parsedDecision.speech && (
                        <div className="speech">
                          <span className="label">Speech:</span>
                          <p>"{event.parsedDecision.speech}"</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="raw-result">
                      <p className="response-preview">{event.rawResponse}</p>
                    </div>
                  )}
                </div>
                
                <div className="overview-section metrics-section">
                  <h4>Metrics</h4>
                  <div className="metrics-grid">
                    <div className="metric">
                      <span className="label">Duration</span>
                      <span className="value">{formatDuration(event.durationMs)}</span>
                    </div>
                    <div className="metric">
                      <span className="label">Status</span>
                      <span className={`value ${event.success ? 'success' : 'error'}`}>
                        {event.success ? '✓ Success' : '✗ Failed'}
                      </span>
                    </div>
                    {event.promptTokens !== undefined && (
                      <div className="metric">
                        <span className="label">Prompt Tokens</span>
                        <span className="value">{event.promptTokens}</span>
                      </div>
                    )}
                    {event.completionTokens !== undefined && (
                      <div className="metric">
                        <span className="label">Completion Tokens</span>
                        <span className="value">{event.completionTokens}</span>
                      </div>
                    )}
                    <div className="metric">
                      <span className="label">Role</span>
                      <span className={`value role-${event.agentRole.toLowerCase()}`}>
                        {event.agentRole}
                      </span>
                    </div>
                    <div className="metric">
                      <span className="label">Zone</span>
                      <span className="value">{event.context.zone || 'Hallway'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {activeTab === 'prompt' && (
            <div className="tab-content prompts">
              <div className="prompt-section">
                <div className="section-header">
                  <h4>System Prompt</h4>
                  <button 
                    className={`copy-btn ${copiedField === 'systemPrompt' ? 'copied' : ''}`}
                    onClick={() => copyToClipboard(event.systemPrompt, 'systemPrompt')}
                  >
                    {copiedField === 'systemPrompt' ? '✓' : '📋'}
                  </button>
                </div>
                <pre className="prompt-text">{event.systemPrompt}</pre>
              </div>
              <div className="prompt-section">
                <div className="section-header">
                  <h4>User Prompt</h4>
                  <button 
                    className={`copy-btn ${copiedField === 'userPrompt' ? 'copied' : ''}`}
                    onClick={() => copyToClipboard(event.userPrompt, 'userPrompt')}
                  >
                    {copiedField === 'userPrompt' ? '✓' : '📋'}
                  </button>
                </div>
                <pre className="prompt-text">{event.userPrompt}</pre>
              </div>
            </div>
          )}
          
          {activeTab === 'response' && (
            <div className="tab-content response">
              <div className="prompt-section">
                <div className="section-header">
                  <h4>Raw LLM Response</h4>
                  <button 
                    className={`copy-btn ${copiedField === 'rawResponse' ? 'copied' : ''}`}
                    onClick={() => copyToClipboard(event.rawResponse, 'rawResponse')}
                  >
                    {copiedField === 'rawResponse' ? '✓' : '📋'}
                  </button>
                </div>
                <pre className="prompt-text">{event.rawResponse}</pre>
              </div>
              {event.error && (
                <div className="prompt-section error-section">
                  <h4>Error</h4>
                  <pre className="error-text">{event.error}</pre>
                </div>
              )}
            </div>
          )}
          
          {activeTab === 'context' && (
            <div className="tab-content context">
              <div className="context-grid">
                <div className="context-section">
                  <h4>Location</h4>
                  <p>{event.context.zone || 'Hallway'}</p>
                </div>
                
                <div className="context-section">
                  <h4>Visible Agents ({event.context.visibleAgents.length})</h4>
                  {event.context.visibleAgents.length > 0 ? (
                    <ul className="agent-list">
                      {event.context.visibleAgents.map((a, i) => (
                        <li key={i}>
                          <span className="agent-name">{a.name}</span>
                          <span className="agent-distance">{a.distance.toFixed(0)}px away</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="empty">No agents visible</p>
                  )}
                </div>
                
                <div className="context-section">
                  <h4>Tasks ({event.context.taskProgress.completed}/{event.context.taskProgress.total})</h4>
                  <ul className="task-list">
                    {event.context.assignedTasks.map((task, i) => (
                      <li key={i} className={task.isCompleted ? 'completed' : ''}>
                        <span className="task-type">{task.taskType}</span>
                        <span className="task-room">{task.room}</span>
                        {task.isCompleted && <span className="task-check">✓</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
          
          {activeTab === 'agents' && (
            <div className="tab-content agents">
              <div className="agents-grid">
                {event.agentPositions.map((agent) => (
                  <div 
                    key={agent.id} 
                    className={`agent-card ${agent.id === event.agentId ? 'highlighted' : ''}`}
                  >
                    <div className="agent-header">
                      <span 
                        className="agent-dot" 
                        style={{ backgroundColor: hexColor(agent.color) }}
                      />
                      <span className="agent-name">{agent.name}</span>
                      {agent.id === event.agentId && <span className="you-badge">This Agent</span>}
                    </div>
                    <div className="agent-details">
                      <div className="detail">
                        <span className="label">Zone:</span>
                        <span className="value">{agent.zone || 'Hallway'}</span>
                      </div>
                      <div className="detail">
                        <span className="label">State:</span>
                        <span className="value">{agent.activityState}</span>
                      </div>
                      <div className="detail">
                        <span className="label">Goal:</span>
                        <span className="value">{agent.currentGoal || 'None'}</span>
                      </div>
                      <div className="detail">
                        <span className="label">Position:</span>
                        <span className="value">({agent.position.x.toFixed(0)}, {agent.position.y.toFixed(0)})</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Timeline entry component
function TimelineEntry({ 
  event, 
  onClick 
}: { 
  event: LLMTraceEvent; 
  onClick: () => void;
}) {
  const summary = getResultSummary(event);
  const isKillDecision = event.parsedDecision?.goalType === 'KILL';
  
  return (
    <div 
      className={`timeline-entry ${isKillDecision ? 'kill-entry' : ''} ${!event.success ? 'error-entry' : ''}`}
      onClick={onClick}
    >
      <div className="entry-time">{formatTimestamp(event.timestamp)}</div>
      <div className="entry-content">
        <div className="entry-header">
          <span 
            className="agent-dot" 
            style={{ backgroundColor: hexColor(event.agentColor) }}
          />
          <span className="entry-type">{getRequestTypeIcon(event.requestType)}</span>
          {event.parsedDecision?.goalType && (
            <span 
              className="goal-badge-small" 
              style={{ backgroundColor: getGoalTypeColor(event.parsedDecision.goalType) }}
            >
              {event.parsedDecision.goalType}
            </span>
          )}
        </div>
        <div className="entry-summary">{summary}</div>
        <div className="entry-meta">
          <span className="duration">{formatDuration(event.durationMs)}</span>
          <span className="zone">{event.context.zone || 'Hallway'}</span>
        </div>
      </div>
    </div>
  );
}

export function LLMTimelinePanel({ width = 320, events }: LLMTimelinePanelProps) {
  const [selectedEvent, setSelectedEvent] = useState<LLMTraceEvent | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [filter, setFilter] = useState<'all' | 'decision' | 'thought' | 'speech'>('all');
  const listRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copiedFiltered, setCopiedFiltered] = useState(false);

  // Auto-scroll to bottom when new events arrive (newest events at bottom)
  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [events.length, autoScroll]);

  // Check if user scrolled away from bottom
  const handleScroll = useCallback(() => {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  }, []);  // Events come in newest-first from App.tsx, reverse to show chronologically (oldest at top, newest at bottom)
  const chronologicalEvents = [...events].reverse();
  
  const filteredEvents = chronologicalEvents.filter(e => {
    if (filter === 'all') return true;
    if (filter === 'speech') return e.requestType === 'speech' || e.requestType === 'conversation';
    return e.requestType === filter;
  });

  // Limit to last MAX_EVENTS (newest events at bottom, chronological order)
  const displayEvents = filteredEvents.slice(-MAX_EVENTS);

  // Copy filtered events to clipboard as JSON
  const handleCopyFiltered = useCallback(async () => {
    if (displayEvents.length === 0) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(displayEvents, null, 2));
      setCopiedFiltered(true);
      setTimeout(() => setCopiedFiltered(false), 2000);
    } catch (err) {
      console.error('Failed to copy events:', err);
    }
  }, [displayEvents]);
  
  if (isCollapsed) {
    return (
      <div className="llm-timeline-panel collapsed" style={{ width: 40 }}>
        <button 
          className="collapse-btn" 
          onClick={() => setIsCollapsed(false)}
          title="Expand LLM Timeline"
        >
          ◀
        </button>
        <div className="collapsed-label">LLM</div>
        <div className="event-count">{events.length}</div>
      </div>
    );
  }
  
  return (
    <div className="llm-timeline-panel" style={{ width }}>
      <div className="panel-header">
        <h3>🧠 LLM Timeline</h3>
        <div className="header-actions">
          <span className="event-count">{events.length} events</span>
          <button 
            className="collapse-btn" 
            onClick={() => setIsCollapsed(true)}
            title="Collapse"
          >
            ▶
          </button>
        </div>
      </div>
      
      <div className="filter-bar">
        <button 
          className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All
        </button>
        <button 
          className={`filter-btn ${filter === 'decision' ? 'active' : ''}`}
          onClick={() => setFilter('decision')}
        >
          🎯 Decisions
        </button>
        <button 
          className={`filter-btn ${filter === 'thought' ? 'active' : ''}`}
          onClick={() => setFilter('thought')}
        >
          💭 Thoughts
        </button>
        <button 
          className={`filter-btn ${filter === 'speech' ? 'active' : ''}`}
          onClick={() => setFilter('speech')}
        >
          💬 Speech
        </button>
        <button
          className={`copy-filtered-btn ${copiedFiltered ? 'copied' : ''}`}
          onClick={handleCopyFiltered}
          disabled={displayEvents.length === 0}
          title={`Copy ${displayEvents.length} ${filter} events as JSON`}
        >
          {copiedFiltered ? '✓' : '📋'}
        </button>
      </div>

      <div
        className="timeline-list"
        ref={listRef}
        onScroll={handleScroll}
      >
        {displayEvents.length === 0 ? (
          <div className="empty-state">
            <p>No LLM events yet</p>
            <p className="hint">Events will appear here as agents think and make decisions</p>
          </div>
        ) : (
          displayEvents.map((event) => (
            <TimelineEntry 
              key={event.id} 
              event={event} 
              onClick={() => setSelectedEvent(event)}
            />
          ))
        )}
      </div>
      
      {!autoScroll && (
        <button
          className="scroll-to-bottom"
          onClick={() => {
            if (listRef.current) {
              listRef.current.scrollTop = listRef.current.scrollHeight;
              setAutoScroll(true);
            }
          }}
        >
          ↓ New events
        </button>
      )}

      {selectedEvent && (
        <TraceDetailModal
          event={selectedEvent}
          onClose={() =>setSelectedEvent(null)} 
        />
      )}
    </div>
  );
}
