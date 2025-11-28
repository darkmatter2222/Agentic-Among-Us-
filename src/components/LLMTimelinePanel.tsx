import { useState, useRef, useEffect, useCallback } from 'react';
import './LLMTimelinePanel.css';
import type { LLMTraceEvent } from '@shared/types/llm-trace.types.ts';

const MAX_EVENTS = 50;

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
    
    // Draw simple map outline (Skeld approximation)
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Simple rectangular outline
    ctx.rect(20, 20, width - 40, height - 40);
    ctx.stroke();
    
    // Scale positions to fit canvas (assuming map coords are roughly 0-1800 x 0-1000)
    const scaleX = (width - 60) / 1800;
    const scaleY = (height - 60) / 1000;
    const offsetX = 30;
    const offsetY = 30;
    
    // Draw agents
    agents.forEach(agent => {
      const x = offsetX + agent.position.x * scaleX;
      const y = offsetY + agent.position.y * scaleY;
      
      const isHighlight = agent.id === highlightAgentId;
      const radius = isHighlight ? 8 : 5;
      
      // Draw circle
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = hexColor(agent.color);
      ctx.fill();
      
      if (isHighlight) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Pulsing effect
        ctx.beginPath();
        ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = `${hexColor(agent.color)}88`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });
    
    // Draw zone labels
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'center';
    
  }, [agents, highlightAgentId]);
  
  return (
    <canvas 
      ref={canvasRef} 
      width={320} 
      height={200} 
      className="llm-trace-mini-map"
    />
  );
}

// Modal component for detailed trace view
function TraceDetailModal({ 
  event, 
  onClose 
}: { 
  event: LLMTraceEvent; 
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'prompt' | 'response' | 'context' | 'agents'>('overview');
  const modalRef = useRef<HTMLDivElement>(null);
  
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
          <button className="llm-trace-modal-close" onClick={onClose}>×</button>
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
                <h4>System Prompt</h4>
                <pre className="prompt-text">{event.systemPrompt}</pre>
              </div>
              <div className="prompt-section">
                <h4>User Prompt</h4>
                <pre className="prompt-text">{event.userPrompt}</pre>
              </div>
            </div>
          )}
          
          {activeTab === 'response' && (
            <div className="tab-content response">
              <div className="prompt-section">
                <h4>Raw LLM Response</h4>
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
  
  // Auto-scroll to bottom when new events arrive
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
  }, []);
  
  const filteredEvents = events.filter(e => {
    if (filter === 'all') return true;
    if (filter === 'speech') return e.requestType === 'speech' || e.requestType === 'conversation';
    return e.requestType === filter;
  });
  
  // Limit to last MAX_EVENTS
  const displayEvents = filteredEvents.slice(-MAX_EVENTS);
  
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
          onClose={() => setSelectedEvent(null)} 
        />
      )}
    </div>
  );
}
