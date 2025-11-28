import { useState, useRef, useCallback, useEffect } from 'react';
import './AgentInfoPanel.css';
import type { TaskAssignment } from '@shared/types/simulation.types.ts';
import type { PlayerRole } from '@shared/types/game.types.ts';
import type { LLMQueueStats } from '@shared/types/protocol.types.ts';
import { getColorName } from '@shared/constants/colors.ts';

export interface AgentSummary {
  id: string;
  color: number;
  activityState: string;
  currentZone: string | null;
  locationState: string;
  goal: string | null;
  // Extended data
  role?: PlayerRole;
  currentThought?: string | null;
  recentSpeech?: string | null;
  assignedTasks?: TaskAssignment[];
  tasksCompleted?: number;
  visibleAgentIds?: string[];
  // Memory & Suspicion data
  suspicionLevels?: Record<string, number>;
  memoryContext?: string;
  suspicionContext?: string;
  recentConversations?: Array<{
    speakerName: string;
    message: string;
    timestamp: number;
  }>;
  isBeingFollowed?: boolean;
  buddyId?: string | null;
}

function hexColor(num: number): string {
  return '#' + num.toString(16).padStart(6, '0');
}

function getRoleBadge(role?: PlayerRole): { label: string; className: string } {
  if (role === 'IMPOSTOR') {
    return { label: 'IMP', className: 'role-badge--impostor' };
  }
  return { label: 'CREW', className: 'role-badge--crewmate' };
}

interface AgentInfoPanelProps {
  agents: AgentSummary[];
  width?: number;
  taskProgress?: number;
  selectedAgentId?: string | null;
  onAgentSelect?: (agentId: string) => void;
  llmQueueStats?: LLMQueueStats;
}

interface ExpandedAgentCardProps {
  agent: AgentSummary;
  onClose: () => void;
}

type TabType = 'overview' | 'memory' | 'suspicion';

function SuspicionBar({ level, name }: { level: number; name: string }) {
  const getBarColor = (l: number) => {
    if (l >= 70) return '#e74c3c'; // Red - high suspicion
    if (l >= 40) return '#f39c12'; // Orange - moderate
    if (l >= 20) return '#f1c40f'; // Yellow - slight
    return '#2ecc71'; // Green - trusted
  };
  
  return (
    <div className="suspicion-item">
      <span className="suspicion-name">{name}</span>
      <div className="suspicion-bar">
        <div 
          className="suspicion-fill" 
          style={{ width: `${level}%`, backgroundColor: getBarColor(level) }}
        />
      </div>
      <span className="suspicion-value">{Math.round(level)}%</span>
    </div>
  );
}

function ExpandedAgentCard({ agent, onClose }: ExpandedAgentCardProps) {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const role = getRoleBadge(agent.role);
  const totalTasks = agent.assignedTasks?.length ?? 0;
  const completed = agent.tasksCompleted ?? 0;
  const taskPercent = totalTasks > 0 ? (completed / totalTasks) * 100 : 0;
  const colorName = getColorName(agent.color);
  
  // Get suspicion data sorted by level
  const suspicionEntries = agent.suspicionLevels 
    ? Object.entries(agent.suspicionLevels)
        .map(([id, level]) => ({ id, level }))
        .sort((a, b) => b.level - a.level)
    : [];
  
  return (
    <div className="expanded-agent-card">
      <div className="expanded-card__header">
      <div className="expanded-card__title">
        <span className="agent-color-dot large" style={{ backgroundColor: hexColor(agent.color) }} />
        <span className={`expanded-card__name ${agent.role === 'IMPOSTOR' ? 'impostor-name' : 'crewmate-name'}`}>{colorName}</span>
        <span className={`role-badge ${role.className}`}>{role.label}</span>
          {agent.isBeingFollowed && <span className="followed-badge">👀 Being Followed</span>}
          {agent.buddyId && <span className="buddy-badge">🤝 Buddy</span>}
        </div>
        <button className="expanded-card__close" onClick={onClose}>×</button>
      </div>
      
      {/* Tab Navigation */}
      <div className="expanded-card__tabs">
        <button 
          className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button 
          className={`tab-btn ${activeTab === 'memory' ? 'active' : ''}`}
          onClick={() => setActiveTab('memory')}
        >
          Memory
        </button>
        <button 
          className={`tab-btn ${activeTab === 'suspicion' ? 'active' : ''}`}
          onClick={() => setActiveTab('suspicion')}
        >
          Suspicions
        </button>
      </div>
      
      {/* Tab Content */}
      <div className="expanded-card__tab-content">
        {activeTab === 'overview' && (
          <>
            <div className="expanded-card__section">
              <div className="section-label">Location</div>
              <div className="section-value">{agent.currentZone?.replace(' (ROOM)', '').replace(' (HALLWAY)', '') ?? 'Unknown'}</div>
            </div>
            
            <div className="expanded-card__section">
              <div className="section-label">Status</div>
              <div className="section-value">
                <span className={`status-badge status-badge--${agent.activityState.toLowerCase()}`}>
                  {agent.activityState}
                </span>
              </div>
            </div>
            
            <div className="expanded-card__section">
              <div className="section-label">Current Goal</div>
              <div className="section-value goal-text">{agent.goal ?? 'Idle'}</div>
            </div>
            
            <div className="expanded-card__section">
              <div className="section-label">Task Progress</div>
              <div className="task-progress-container">
                <div className="task-progress-bar">
                  <div 
                    className="task-progress-fill" 
                    style={{ width: `${taskPercent}%` }}
                  />
                </div>
                <span className="task-progress-text">{completed}/{totalTasks}</span>
              </div>
              {agent.assignedTasks && agent.assignedTasks.length > 0 && (
                <div className="task-list">
                  {agent.assignedTasks.map((task, idx) => (
                    <div key={idx} className={`task-item ${task.isCompleted ? 'completed' : ''}`}>
                      <span className="task-check">{task.isCompleted ? '✓' : '○'}</span>
                      <span className="task-name">{task.taskType}</span>
                      <span className="task-location">{task.room}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div className="expanded-card__section">
              <div className="section-label">Current Thought</div>
              <div className="thought-bubble">
                {agent.currentThought ? (
                  <p className="thought-text">💭 {agent.currentThought}</p>
                ) : (
                  <p className="thought-text empty">No recent thoughts...</p>
                )}
              </div>
            </div>
            
            <div className="expanded-card__section">
              <div className="section-label">Visible Agents ({agent.visibleAgentIds?.length ?? 0})</div>
              <div className="visible-agents-list">
                {agent.visibleAgentIds && agent.visibleAgentIds.length > 0 ? (
                  agent.visibleAgentIds.map(id => (
                    <span key={id} className="visible-agent-tag">{id.replace('agent_', '#')}</span>
                  ))
                ) : (
                  <span className="no-visible">None in sight</span>
                )}
              </div>
            </div>
            
            {agent.recentSpeech && (
              <div className="expanded-card__section">
                <div className="section-label">Last Speech</div>
                <div className="speech-bubble-preview">
                  <p>🗣️ "{agent.recentSpeech}"</p>
                </div>
              </div>
            )}
          </>
        )}
        
        {activeTab === 'memory' && (
          <>
            <div className="expanded-card__section">
              <div className="section-label">Recent Observations</div>
              <div className="memory-context-box">
                {agent.memoryContext ? (
                  <pre className="memory-text">{agent.memoryContext}</pre>
                ) : (
                  <p className="memory-text empty">No recent observations recorded...</p>
                )}
              </div>
            </div>
            
            <div className="expanded-card__section">
              <div className="section-label">Recent Conversations</div>
              <div className="conversation-list">
                {agent.recentConversations && agent.recentConversations.length > 0 ? (
                  agent.recentConversations.map((conv, idx) => (
                    <div key={idx} className="conversation-item">
                      <span className="conversation-speaker">{conv.speakerName}:</span>
                      <span className="conversation-message">"{conv.message}"</span>
                    </div>
                  ))
                ) : (
                  <p className="no-conversations">No recent conversations...</p>
                )}
              </div>
            </div>
          </>
        )}
        
        {activeTab === 'suspicion' && (
          <>
            <div className="expanded-card__section">
              <div className="section-label">Suspicion Levels</div>
              <div className="suspicion-list">
                {suspicionEntries.length > 0 ? (
                  suspicionEntries.map(({ id, level }) => (
                    <SuspicionBar key={id} name={id.replace('agent_', '')} level={level} />
                  ))
                ) : (
                  <p className="no-suspicion">No suspicion data yet...</p>
                )}
              </div>
            </div>
            
            <div className="expanded-card__section">
              <div className="section-label">Suspicion Context</div>
              <div className="suspicion-context-box">
                {agent.suspicionContext ? (
                  <pre className="suspicion-text">{agent.suspicionContext}</pre>
                ) : (
                  <p className="suspicion-text empty">No suspicion reasoning yet...</p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// LLM Queue Statistics Panel
function LLMQueuePanel({ stats, isCollapsed, onToggle, height, onHeightChange }: {
  stats?: LLMQueueStats;
  isCollapsed: boolean;
  onToggle: () => void;
  height?: number;
  onHeightChange?: (height: number) => void;
}) {
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const getHealthColor = (avgTime: number, queueDepth: number) => {
    if (queueDepth > 10 || avgTime > 800) return '#e74c3c'; // Red - unhealthy
    if (queueDepth > 5 || avgTime > 500) return '#f39c12'; // Orange - warning
    return '#2ecc71'; // Green - healthy
  };

const handleCopyStats = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent panel collapse
    if (!stats) return;

    const jsonStr = JSON.stringify(stats, null, 2);
    try {
      await navigator.clipboard.writeText(jsonStr);
      setCopyFeedback('Copied!');
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch (err) {
      setCopyFeedback('Failed');
      setTimeout(() => setCopyFeedback(null), 2000);
    }
  }, [stats]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    const startY = e.clientY;
    const startHeight = height || 300;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = startY - e.clientY; // Dragging up increases height
      const newHeight = Math.max(100, Math.min(600, startHeight + deltaY));
      onHeightChange?.(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [height, onHeightChange]);  const healthColor = stats
    ? getHealthColor(stats.avgProcessingTimeMs1Min, stats.queueDepth)
    : '#666';

  return (
    <div 
      className={`collapsible-panel llm-queue-panel ${isCollapsed ? 'collapsed' : ''} ${isResizing ? 'resizing' : ''}`}
      style={!isCollapsed && height ? { height: `${height}px`, maxHeight: `${height}px` } : undefined}
    >
      {/* Resize Handle */}
      {!isCollapsed && (
        <div className="llm-resize-handle" onMouseDown={handleResizeStart} title="Drag to resize">
          <div className="resize-grip" />
        </div>
      )}
      <header className="panel-header" onClick={onToggle}>
        <div className="panel-header__left">
          <span className={`collapse-icon ${isCollapsed ? '' : 'expanded'}`}>▶</span>
          <h3>LLM Queue</h3>
          <span className="health-indicator" style={{ backgroundColor: healthColor }} />
        </div>
        <div className="panel-header__right">
          {stats && <span className="queue-depth-badge">{stats.queueDepth} queued</span>}
          {stats && (
            <button className="copy-stats-btn" onClick={handleCopyStats} title="Copy stats as JSON">
              {copyFeedback || '📋'}
            </button>
          )}
        </div>
      </header>

      {!isCollapsed && stats && (
        <div className="panel-content">
          {/* Queue Depth Visualization */}
          <div className="llm-stat-row">
            <span className="stat-label">Queue Depth</span>
            <div className="queue-depth-bar">
              <div
                className="queue-depth-fill"
                style={{
                  width: `${Math.min(100, stats.queueDepth * 10)}%`,
                  backgroundColor: stats.queueDepth > 5 ? '#f39c12' : '#4caf50'
                }}
              />
            </div>
            <span className="stat-value">{stats.queueDepth}</span>
          </div>

          {/* Processed Per Second KPI */}
          <div className="llm-stat-row kpi-row">
            <span className="stat-label">Processed/sec</span>
            <div className="kpi-values">
              <span className="kpi-value" title="Last 1 minute">
                <span className="kpi-number">{stats.processedPerSecond1Min.toFixed(2)}</span>
                <span className="kpi-period">1m</span>
              </span>
              <span className="kpi-divider">|</span>
              <span className="kpi-value" title="Last 5 minutes">
                <span className="kpi-number">{stats.processedPerSecond5Min.toFixed(2)}</span>
                <span className="kpi-period">5m</span>
              </span>
            </div>
          </div>

          {/* Processing indicator */}
          <div className="llm-stat-row">
            <span className="stat-label">Processing</span>
            <span className={`processing-indicator ${stats.processingCount > 0 ? 'active' : ''}`}>
              {stats.processingCount > 0 ? '⚡ Active' : '○ Idle'}
            </span>
          </div>          {/* Avg Processing Time - 1 Min */}
          <div className="llm-stat-row">
            <span className="stat-label">Avg Time (1m)</span>
            <div className="time-bar">
              <div 
                className="time-fill"
                style={{ 
                  width: `${Math.min(100, stats.avgProcessingTimeMs1Min / 10)}%`,
                  backgroundColor: stats.avgProcessingTimeMs1Min > 500 ? '#f39c12' : '#4caf50'
                }}
              />
            </div>
            <span className="stat-value">{stats.avgProcessingTimeMs1Min}ms</span>
          </div>
          
          {/* Avg Processing Time - 5 Min */}
          <div className="llm-stat-row">
            <span className="stat-label">Avg Time (5m)</span>
            <div className="time-bar">
              <div 
                className="time-fill"
                style={{ 
                  width: `${Math.min(100, stats.avgProcessingTimeMs5Min / 10)}%`,
                  backgroundColor: stats.avgProcessingTimeMs5Min > 500 ? '#f39c12' : '#4caf50'
                }}
              />
            </div>
            <span className="stat-value">{stats.avgProcessingTimeMs5Min}ms</span>
          </div>
          
          {/* Token Throughput */}
          <div className="llm-stat-row kpi-row">
            <span className="stat-label">Tokens/sec</span>
            <div className="kpi-values">
              <span className="kpi-value" title="Completion tokens per second (1 min)">
                <span className="kpi-number">{stats.tokensPerSecond1Min?.toFixed(1) || '0'}</span>
                <span className="kpi-period">out</span>
              </span>
            </div>
          </div>

          <div className="llm-stat-row kpi-row">
            <span className="stat-label">Tokens/min</span>
            <div className="kpi-values">
              <span className="kpi-value" title="Total tokens per minute">
                <span className="kpi-number">{stats.tokensPerMinute1Min?.toFixed(0) || '0'}</span>
                <span className="kpi-period">1m</span>
              </span>
            </div>
          </div>

          {/* Avg Tokens Per Request */}
          <div className="llm-stat-row kpi-row">
            <span className="stat-label">Avg Tokens</span>
            <div className="kpi-values">
              <span className="kpi-value" title="Avg prompt tokens per request">
                <span className="kpi-number">{stats.avgPromptTokens1Min?.toFixed(0) || '0'}</span>
                <span className="kpi-period">in</span>
              </span>
              <span className="kpi-divider">|</span>
              <span className="kpi-value" title="Avg completion tokens per request">
                <span className="kpi-number">{stats.avgCompletionTokens1Min?.toFixed(0) || '0'}</span>
                <span className="kpi-period">out</span>
              </span>
            </div>
          </div>

          {/* Totals */}
          <div className="llm-totals">
            <div className="total-item">
              <span className="total-label">Processed</span>
              <span className="total-value success">{stats.totalProcessed}</span>
            </div>
            <div className="total-item">
              <span className="total-label">Timeouts</span>
              <span className="total-value warning">{stats.totalTimedOut}</span>
            </div>
            <div className="total-item">
              <span className="total-label">Failed</span>
              <span className="total-value error">{stats.totalFailed}</span>
            </div>
          </div>

          {/* Total Tokens */}
          <div className="llm-totals token-totals">
            <div className="total-item">
              <span className="total-label">Total In</span>
              <span className="total-value info">{(stats.totalPromptTokens || 0).toLocaleString()}</span>
            </div>
            <div className="total-item">
              <span className="total-label">Total Out</span>
              <span className="total-value info">{(stats.totalCompletionTokens || 0).toLocaleString()}</span>
            </div>
          </div>

          {/* Recent Requests Timeline */}
          {stats.recentRequests.length > 0 && (
            <div className="recent-requests">
              <div className="recent-header">Recent Requests</div>
              <div className="request-timeline">
                {stats.recentRequests.slice(-10).map((req, idx) => (
                  <div
                    key={idx}
                    className={`request-dot ${req.success ? 'success' : req.timedOut ? 'timeout' : 'failed'}`}
                    title={`${req.durationMs}ms - ${req.promptTokens || 0} in / ${req.completionTokens || 0} out - ${req.success ? 'Success' : req.timedOut ? 'Timeout' : 'Failed'}`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AgentInfoPanel({ agents, width = 380, taskProgress = 0, selectedAgentId, onAgentSelect, llmQueueStats }: AgentInfoPanelProps) {
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [columnWidths, setColumnWidths] = useState<number[]>([90, 80, 70, 80]); // Agent, Zone, Status, Tasks
  const resizingRef = useRef<{ index: number; startX: number; startWidth: number } | null>(null);
  
  // Collapse states for panels
  const [agentsPanelCollapsed, setAgentsPanelCollapsed] = useState(false);
  const [llmPanelCollapsed, setLlmPanelCollapsed] = useState(false);
  const [llmPanelHeight, setLlmPanelHeight] = useState<number>(280);
  
  // Sync expanded agent with selected agent from parent
  useEffect(() => {
    if (selectedAgentId) {
      setExpandedAgentId(selectedAgentId);
    }
  }, [selectedAgentId]);
  
  const expandedAgent = expandedAgentId ? agents.find(a => a.id === expandedAgentId) : null;
  
  const crewmateCount = agents.filter(a => a.role === 'CREWMATE').length;
  const impostorCount = agents.filter(a => a.role === 'IMPOSTOR').length;
  
  const handleMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = { index, startX: e.clientX, startWidth: columnWidths[index] };
    
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const { index, startX, startWidth } = resizingRef.current;
      const diff = e.clientX - startX;
      const newWidth = Math.max(40, startWidth + diff);
      setColumnWidths(prev => {
        const next = [...prev];
        next[index] = newWidth;
        return next;
      });
    };
    
    const handleMouseUp = () => {
      resizingRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [columnWidths]);
  
  return (
    <aside className="agent-panel" style={{ width }}>
      {/* Agents Collapsible Panel */}
      <div className={`collapsible-panel agents-panel ${agentsPanelCollapsed ? 'collapsed' : ''}`}>
        <header className="panel-header" onClick={() => setAgentsPanelCollapsed(!agentsPanelCollapsed)}>
          <div className="panel-header__left">
            <span className={`collapse-icon ${agentsPanelCollapsed ? '' : 'expanded'}`}>▶</span>
            <h3>Agents</h3>
          </div>
          <div className="panel-header__right">
            <span className="count-badge crew">{crewmateCount} Crew</span>
            <span className="count-badge imp">{impostorCount} Imp</span>
          </div>
        </header>
        
        {!agentsPanelCollapsed && (
          <div className="panel-content">
            {/* Global Task Progress */}
            <div className="global-task-progress">
              <div className="global-progress-label">
                <span>Crew Task Progress</span>
                <span className="progress-percent">{Math.round(taskProgress)}%</span>
              </div>
              <div className="global-progress-bar">
                <div 
                  className="global-progress-fill" 
                  style={{ width: `${taskProgress}%` }}
                />
              </div>
            </div>
            
            <div className="agent-panel__content">
              {expandedAgent ? (
                <ExpandedAgentCard 
                  agent={expandedAgent} 
                  onClose={() => setExpandedAgentId(null)} 
                />
              ) : (
                <table className="agent-table">
                  <thead>
                    <tr>
                      <th style={{ width: columnWidths[0] }}>
                        Agent
                        <span className="resize-handle" onMouseDown={(e) => handleMouseDown(0, e)} />
                      </th>
                      <th style={{ width: columnWidths[1] }}>
                        Zone
                        <span className="resize-handle" onMouseDown={(e) => handleMouseDown(1, e)} />
                      </th>
                      <th style={{ width: columnWidths[2] }}>
                        Status
                        <span className="resize-handle" onMouseDown={(e) => handleMouseDown(2, e)} />
                      </th>
                      <th style={{ width: columnWidths[3] }}>
                        Tasks
                        <span className="resize-handle" onMouseDown={(e) => handleMouseDown(3, e)} />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                  {agents.map(agent => {
                    const totalTasks = agent.assignedTasks?.length ?? 0;
                    const completed = agent.tasksCompleted ?? 0;
                    const colorName = getColorName(agent.color);
                    
                    return (
                      <tr
                        key={agent.id}
                        className="agent-row clickable"
                        onClick={() => {
                          setExpandedAgentId(agent.id);
                          onAgentSelect?.(agent.id);
                        }}
                      >
                        <td className="agent-row__id" style={{ width: columnWidths[0] }}>
                          <span className="agent-color-dot" style={{ backgroundColor: hexColor(agent.color) }} />
                          <span className={`agent-num ${agent.role === 'IMPOSTOR' ? 'impostor-name' : 'crewmate-name'}`}>{colorName}</span>
                        </td>
                        <td className="agent-row__zone" style={{ width: columnWidths[1] }} title={agent.currentZone ?? 'Unknown'}>
                          {agent.currentZone?.replace(' (ROOM)', '').replace(' (HALLWAY)', '') ?? '?'}
                        </td>
                        <td className="agent-row__status" style={{ width: columnWidths[2] }}>
                          <span className={`status-badge status-badge--${agent.activityState.toLowerCase()}`}>
                            {agent.activityState}
                          </span>
                        </td>
                        <td className="agent-row__tasks" style={{ width: columnWidths[3] }}>
                          <div className="mini-progress">
                            <div className="mini-progress-bar">
                              <div 
                                className="mini-progress-fill"
                                style={{ width: totalTasks > 0 ? `${(completed / totalTasks) * 100}%` : '0%' }}
                              />
                            </div>
                            <span className="mini-progress-text">{completed}/{totalTasks}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
      
      {/* LLM Queue Stats Panel */}
      <LLMQueuePanel
        stats={llmQueueStats}
        isCollapsed={llmPanelCollapsed}
        onToggle={() => setLlmPanelCollapsed(!llmPanelCollapsed)}
        height={llmPanelHeight}
        onHeightChange={setLlmPanelHeight}
      />
    </aside>
  );
}
