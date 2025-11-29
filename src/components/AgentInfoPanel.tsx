import { useState, useRef, useCallback, useEffect } from 'react';
import './AgentInfoPanel.css';
import type { TaskAssignment } from '@shared/types/simulation.types.ts';
import type { PlayerRole } from '@shared/types/game.types.ts';
import type { LLMQueueStats, GodModeCommand } from '@shared/types/protocol.types.ts';
import type { LLMTraceEvent } from '@shared/types/llm-trace.types.ts';
import { getColorName } from '@shared/constants/colors.ts';
import { getSimulationClient } from '../ai/SimulationClient.ts';
import { errorLogger } from '../logging/index.ts';

export interface AgentSummary {
  id: string;
  color: number;
  activityState: string;
  currentZone: string | null;
  locationState: string;
  goal: string | null;
  playerState?: 'ALIVE' | 'DEAD';
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
  recentlyHeard?: Array<{
    speakerName: string;
    message: string;
    timestamp: number;
    wasDirectlyAddressed: boolean;
  }>;
  isBeingFollowed?: boolean;
  buddyId?: string | null;
  // Kill status (impostors only)
  killStatus?: {
    cooldownRemaining: number;
    canKill: boolean;
    hasTargetInRange: boolean;
    killCount: number;
  };
  // God Mode status
  godMode?: {
    isActive: boolean;
    guidingPrinciples: string[];
    lastWhisper?: string;
    lastWhisperTimestamp?: number;
    currentCommand?: string;
  };
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

// Kill status indicator for impostors
function KillStatusIcon({ killStatus }: { killStatus?: AgentSummary['killStatus'] }) {
  if (!killStatus) return null;
  
  // If on cooldown, show countdown timer
  if (killStatus.cooldownRemaining > 0) {
    const seconds = Math.ceil(killStatus.cooldownRemaining / 1000);
    return (
      <span className="kill-status-timer" title={`Kill cooldown: ${seconds}s`}>
        {seconds}s
      </span>
    );
  }
  
  // Ready to kill - show skull with appropriate color
  let className = 'kill-status-icon ready';
  let title = 'Kill ready - no target in range';
  
  if (killStatus.hasTargetInRange) {
    // Ready AND target in range - bright red (kill opportunity!)
    className = 'kill-status-icon ready-target';
    title = 'KILL READY - Target in range!';
  }
  
  // Add kill count to title
  if (killStatus.killCount > 0) {
    title += ` (${killStatus.killCount} kill${killStatus.killCount !== 1 ? 's' : ''})`;
  }
  
  return (
    <span className={className} title={title}>
      ☠️
    </span>
  );
}

interface AgentInfoPanelProps {
  agents: AgentSummary[];
  width?: number;
  taskProgress?: number;
  selectedAgentId?: string | null;
  onAgentSelect?: (agentId: string) => void;
  llmQueueStats?: LLMQueueStats;
  llmTraceEvents?: LLMTraceEvent[];
}

interface ExpandedAgentCardProps {
  agent: AgentSummary;
  onClose: () => void;
  llmTraceEvents?: LLMTraceEvent[];
}

type TabType = 'overview' | 'memory' | 'suspicion' | 'control';

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

// God Mode Control Panel - Divine intervention tools
function GodModeControlPanel({ agent }: { agent: AgentSummary }) {
  const [whisperText, setWhisperText] = useState('');
  const [principleText, setPrincipleText] = useState('');
  const [principles, setPrinciples] = useState<string[]>(agent.godMode?.guidingPrinciples ?? []);
  const [speakText, setSpeakText] = useState('');

  const client = getSimulationClient();
  const isImpostor = agent.role === 'IMPOSTOR';

  const sendCommand = (command: GodModeCommand) => {
    client.sendGodCommand(agent.id, command);
  };

  const handleWhisper = () => {
    if (whisperText.trim()) {
      client.sendWhisper(agent.id, whisperText.trim());
      setWhisperText('');
    }
  };

  const handleAddPrinciple = () => {
    if (principleText.trim() && !principles.includes(principleText.trim())) {
      const newPrinciples = [...principles, principleText.trim()];
      setPrinciples(newPrinciples);
      client.setGuidingPrinciples(agent.id, newPrinciples);
      setPrincipleText('');
    }
  };

  const handleRemovePrinciple = (principle: string) => {
    const newPrinciples = principles.filter(p => p !== principle);
    setPrinciples(newPrinciples);
    client.setGuidingPrinciples(agent.id, newPrinciples);
  };

  const handleSpeak = () => {
    if (speakText.trim()) {
      sendCommand({ action: 'speak', message: speakText.trim() });
      setSpeakText('');
    }
  };

  return (
    <>
      {/* God Mode Status */}
      {agent.godMode?.isActive && (
        <div className="god-mode-active-banner">
          <span className="god-icon">⚡</span>
          <span>Divine Control Active: {agent.godMode.currentCommand}</span>
        </div>
      )}

      {/* Quick Commands Section */}
      <div className="expanded-card__section">
        <div className="section-label">⚡ Quick Commands</div>
        <div className="god-commands-grid">
          <button className="god-cmd-btn" onClick={() => sendCommand({ action: 'wander' })} title="Make agent wander randomly">
            🚶 Wander
          </button>
          <button className="god-cmd-btn" onClick={() => sendCommand({ action: 'idle' })} title="Make agent stop and wait">
            ⏸️ Idle
          </button>
          {agent.assignedTasks && agent.assignedTasks.length > 0 && (
            <button 
              className="god-cmd-btn" 
              onClick={() => {
                const nextTask = agent.assignedTasks?.findIndex(t => !t.isCompleted) ?? 0;
                sendCommand({ action: 'go-to-task', taskIndex: nextTask });
              }} 
              title="Go to next incomplete task"
            >
              📋 Do Task
            </button>
          )}
          {isImpostor && (
            <>
              <button className="god-cmd-btn impostor" onClick={() => sendCommand({ action: 'hunt' })} title="Hunt for isolated targets">
                🎯 Hunt
              </button>
              <button className="god-cmd-btn impostor" onClick={() => sendCommand({ action: 'enter-vent' })} title="Enter nearest vent">
                🕳️ Vent
              </button>
              <button className="god-cmd-btn impostor" onClick={() => sendCommand({ action: 'exit-vent' })} title="Exit current vent">
                ↗️ Exit Vent
              </button>
              <button className="god-cmd-btn impostor" onClick={() => sendCommand({ action: 'flee-body' })} title="Flee from the body">
                🏃 Flee
              </button>
              <button className="god-cmd-btn impostor" onClick={() => sendCommand({ action: 'create-alibi' })} title="Create an alibi">
                🎭 Alibi
              </button>
              <button className="god-cmd-btn impostor danger" onClick={() => sendCommand({ action: 'self-report' })} title="Self-report the body">
                📢 Self Report
              </button>
            </>
          )}
        </div>
      </div>

      {/* Task Selection */}
      {agent.assignedTasks && agent.assignedTasks.length > 0 && (
        <div className="expanded-card__section">
          <div className="section-label">📋 Go To Task</div>
          <div className="task-command-list">
            {agent.assignedTasks.map((task, idx) => (
              <button
                key={idx}
                className={`task-cmd-btn ${task.isCompleted ? 'completed' : ''}`}
                onClick={() => sendCommand({ action: 'go-to-task', taskIndex: idx })}
                disabled={task.isCompleted}
              >
                <span className="task-check">{task.isCompleted ? '✓' : '○'}</span>
                <span className="task-name">{task.taskType}</span>
                <span className="task-room">{task.room}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Make Agent Speak */}
      <div className="expanded-card__section">
        <div className="section-label">🗣️ Make Agent Speak</div>
        <div className="god-input-row">
          <input
            type="text"
            className="god-input"
            placeholder="What should they say..."
            value={speakText}
            onChange={(e) => setSpeakText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSpeak()}
          />
          <button className="god-send-btn" onClick={handleSpeak} disabled={!speakText.trim()}>
            Say
          </button>
        </div>
      </div>

      {/* Divine Whisper */}
      <div className="expanded-card__section">
        <div className="section-label">👁️ Divine Whisper</div>
        <p className="god-hint">Inject a thought into the agent's mind. This will influence their next LLM decision.</p>
        <div className="god-input-row">
          <input
            type="text"
            className="god-input"
            placeholder="A voice whispers: You should vent more often..."
            value={whisperText}
            onChange={(e) => setWhisperText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleWhisper()}
          />
          <button className="god-send-btn" onClick={handleWhisper} disabled={!whisperText.trim()}>
            Whisper
          </button>
        </div>
        {agent.godMode?.lastWhisper && (
          <div className="last-whisper">
            <span className="whisper-icon">👁️</span>
            <span className="whisper-text">"{agent.godMode.lastWhisper}"</span>
          </div>
        )}
      </div>

      {/* Guiding Principles */}
      <div className="expanded-card__section">
        <div className="section-label">📜 Guiding Principles</div>
        <p className="god-hint">Persistent behavioral directives that influence all future decisions.</p>
        <div className="god-input-row">
          <input
            type="text"
            className="god-input"
            placeholder="Always be suspicious of Red..."
            value={principleText}
            onChange={(e) => setPrincipleText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddPrinciple()}
          />
          <button className="god-send-btn" onClick={handleAddPrinciple} disabled={!principleText.trim()}>
            Add
          </button>
        </div>
        {principles.length > 0 && (
          <div className="principles-list">
            {principles.map((principle, idx) => (
              <div key={idx} className="principle-item">
                <span className="principle-text">{principle}</span>
                <button 
                  className="principle-remove" 
                  onClick={() => handleRemovePrinciple(principle)}
                  title="Remove principle"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Clear God Mode */}
      <div className="expanded-card__section">
        <button 
          className="god-clear-btn"
          onClick={() => client.clearGodMode(agent.id)}
        >
          🔄 Return to Normal AI Control
        </button>
      </div>
    </>
  );
}function ExpandedAgentCard({ agent, onClose, llmTraceEvents }: ExpandedAgentCardProps) {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
  const role = getRoleBadge(agent.role);
  const totalTasks = agent.assignedTasks?.length ?? 0;
  const completed = agent.tasksCompleted ?? 0;
  const taskPercent = totalTasks > 0 ? (completed / totalTasks) * 100 : 0;
  const colorName = getColorName(agent.color);

  // Get ALL LLM traces for this agent only
  const agentTraces = llmTraceEvents
    ?.filter(e => e.agentId === agent.id) ?? [];

  const handleCopyTraces = useCallback(async () => {
    if (agentTraces.length === 0) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(agentTraces, null, 2));
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch (err) {
      errorLogger.error('Failed to copy traces', { error: err });
    }
  }, [agentTraces]);

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
        <div className="expanded-card__actions">
          <button
            className={`copy-traces-btn ${copyStatus === 'copied' ? 'copied' : ''}`}
            onClick={handleCopyTraces}
            disabled={agentTraces.length === 0}
            title={`Copy last ${agentTraces.length} LLM traces to clipboard`}
          >
            {copyStatus === 'copied' ? '✓ Copied!' : `📋 Copy ${agentTraces.length} Traces`}
          </button>
          <button className="expanded-card__close" onClick={onClose}>×</button>
        </div>
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
        <button
          className={`tab-btn god-mode-tab ${activeTab === 'control' ? 'active' : ''}`}
          onClick={() => setActiveTab('control')}
        >
          ⚡ Control
        </button>
      </div>      {/* Tab Content */}
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
                  agent.visibleAgentIds.map((id: string) => (
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

            <div className="expanded-card__section">
              <div className="section-label">Recently Heard</div>
              <div className="conversation-list">
                {agent.recentlyHeard && agent.recentlyHeard.length > 0 ? (
                  agent.recentlyHeard.map((heard, idx) => (
                    <div key={idx} className={`conversation-item ${heard.wasDirectlyAddressed ? 'directly-addressed' : ''}`}>
                      <span className="conversation-speaker">
                        {heard.wasDirectlyAddressed && <span className="heard-icon" title="Directly addressed">👂</span>}
                        {heard.speakerName}:
                      </span>
                      <span className="conversation-message">"{heard.message}"</span>
                    </div>
                  ))
                ) : (
                  <p className="no-conversations">Nothing heard recently...</p>
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

        {activeTab === 'control' && (
          <GodModeControlPanel agent={agent} />
        )}
      </div>
    </div>
  );
}// LLM Queue Statistics Panel - Capacity-aware monitoring
type TimeInterval = '1min' | '5min';

function LLMQueuePanel({ stats, isCollapsed, onToggle, height, onHeightChange }: {
  stats?: LLMQueueStats;
  isCollapsed: boolean;
  onToggle: () => void;
  height?: number;
  onHeightChange?: (height: number) => void;
}) {
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [_timeInterval, setTimeInterval] = useState<TimeInterval>('1min');

  const getHealthColor = (utilization: number, queueDepth: number) => {
    if (queueDepth > 10 || utilization > 0.9) return '#e74c3c';
    if (queueDepth > 5 || utilization > 0.7) return '#f39c12';
    return '#2ecc71';
  };

  const getCapacityColor = (utilization: number) => {
    if (utilization > 0.9) return '#e74c3c';
    if (utilization > 0.7) return '#f39c12';
    if (utilization > 0.5) return '#f1c40f';
    return '#2ecc71';
  };

  const getThinkingCoeffColor = (coeff: number) => {
    if (coeff >= 1.3) return '#2ecc71';
    if (coeff >= 1.0) return '#4caf50';
    if (coeff >= 0.5) return '#f39c12';
    return '#e74c3c';
  };

  const handleCopyStats = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!stats) return;
    const jsonStr = JSON.stringify(stats, null, 2);
    try {
      await navigator.clipboard.writeText(jsonStr);
      setCopyFeedback('Copied!');
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch {
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
      const deltaY = startY - e.clientY;
      const newHeight = Math.max(100, Math.min(700, startHeight + deltaY));
      onHeightChange?.(newHeight);
    };
    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [height, onHeightChange]);

  const healthColor = stats ? getHealthColor(stats.capacityUtilization || 0, stats.queueDepth) : '#666';

  return (
    <div
      className={`collapsible-panel llm-queue-panel ${isCollapsed ? 'collapsed' : ''} ${isResizing ? 'resizing' : ''}`}
      style={!isCollapsed && height ? { height: `${height}px`, maxHeight: `${height}px` } : undefined}
    >
      {!isCollapsed && (
        <div className="llm-resize-handle" onMouseDown={handleResizeStart} title="Drag to resize">
          <div className="resize-grip" />
        </div>
      )}
      <header className="panel-header" onClick={onToggle}>
        <div className="panel-header__left">
          <span className={`collapse-icon ${isCollapsed ? '' : 'expanded'}`}></span>
          <h3>LLM Capacity</h3>
          <span className="health-indicator" style={{ backgroundColor: healthColor }} />
        </div>
        <div className="panel-header__right">
          {stats && <span className="queue-depth-badge">{stats.queueDepth} queued</span>}
          {stats && (
            <button className="copy-stats-btn" onClick={handleCopyStats} title="Copy stats as JSON">
              {copyFeedback || ''}
            </button>
          )}
        </div>
      </header>

      {!isCollapsed && stats && (
        <div className="panel-content llm-panel-content">
          {/* Time Interval Selector */}
          <div className="interval-selector">
            <button className={`interval-btn ${_timeInterval === '1min' ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setTimeInterval('1min'); }}>1m</button>
            <button className={`interval-btn ${_timeInterval === '5min' ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setTimeInterval('5min'); }}>5m</button>
          </div>

          {/* Capacity Utilization - Main KPI */}
          <div className="capacity-section">
            <div className="capacity-header">
              <span className="capacity-label">Capacity</span>
              <span className="capacity-percent" style={{ color: getCapacityColor(stats.capacityUtilization || 0) }}>
                {Math.round((stats.capacityUtilization || 0) * 100)}%
              </span>
            </div>
            <div className="capacity-bar">
              <div className="capacity-fill" style={{ 
                width: `${Math.min(100, (stats.capacityUtilization || 0) * 100)}%`,
                backgroundColor: getCapacityColor(stats.capacityUtilization || 0)
              }} />
              <div className="capacity-target" style={{ left: `${(stats.capacityConfig?.targetUtilization || 0.7) * 100}%` }} />
            </div>
            <div className="capacity-details">
              <span className="capacity-used">{stats.tokensPerSecondTotal || 0} tok/s</span>
              <span className="capacity-max">/ {stats.capacityConfig?.maxTokensPerSecond || 500} max</span>
            </div>
          </div>

          {/* Thinking Coefficient */}
          <div className="thinking-coeff-section">
            <div className="llm-stat-row">
              <span className="stat-label">Agent Think Rate</span>
              <span className="thinking-coeff-value" style={{ color: getThinkingCoeffColor(stats.thinkingCoefficient || 1) }}>
                {((stats.thinkingCoefficient || 1) * 100).toFixed(0)}%
                {(stats.thinkingCoefficient || 1) > 1.2 && ' '}
                {(stats.thinkingCoefficient || 1) < 0.5 && ' '}
              </span>
            </div>
            <div className="thinking-bar">
              <div className="thinking-fill" style={{ 
                width: `${Math.min(100, ((stats.thinkingCoefficient || 1) / 1.5) * 100)}%`,
                backgroundColor: getThinkingCoeffColor(stats.thinkingCoefficient || 1)
              }} />
            </div>
          </div>

          {/* Available Capacity */}
          <div className="llm-stat-row highlight-row">
            <span className="stat-label">Available</span>
            <span className="stat-value available-value">+{stats.availableCapacity || 0} tok/s</span>
          </div>

          <div className="stats-divider" />

          {/* Token Throughput */}
          <div className="throughput-section">
            <div className="section-title">Token Throughput</div>
            <div className="throughput-grid">
              <div className="throughput-item"><span className="throughput-label">In/sec</span><span className="throughput-value">{stats.tokensPerSecondIn || 0}</span></div>
              <div className="throughput-item"><span className="throughput-label">Out/sec</span><span className="throughput-value">{stats.tokensPerSecondOut || 0}</span></div>
              <div className="throughput-item"><span className="throughput-label">In/min</span><span className="throughput-value">{stats.tokensPerMinuteIn?.toLocaleString() || 0}</span></div>
              <div className="throughput-item"><span className="throughput-label">Out/min</span><span className="throughput-value">{stats.tokensPerMinuteOut?.toLocaleString() || 0}</span></div>
            </div>
          </div>

          {/* Avg Per Request */}
          <div className="avg-section">
            <div className="section-title">Avg Per Request</div>
            <div className="avg-grid">
              <div className="avg-item"><span className="avg-label">Tokens In</span><span className="avg-value">{stats.avgTokensIn || 0}</span></div>
              <div className="avg-item"><span className="avg-label">Tokens Out</span><span className="avg-value">{stats.avgTokensOut || 0}</span></div>
              <div className="avg-item"><span className="avg-label">Time</span><span className="avg-value">{stats.avgProcessingTimeMs || 0}ms</span></div>
              <div className="avg-item"><span className="avg-label">Rate</span><span className="avg-value">{stats.processedPerSecond?.toFixed(2) || 0}/s</span></div>
            </div>
          </div>

          <div className="stats-divider" />

          {/* Queue Status */}
          <div className="queue-status-section">
            <div className="llm-stat-row">
              <span className="stat-label">Queue</span>
              <div className="queue-depth-bar">
                <div className="queue-depth-fill" style={{
                  width: `${Math.min(100, stats.queueDepth * 10)}%`,
                  backgroundColor: stats.queueDepth > 5 ? '#f39c12' : '#4caf50'
                }} />
              </div>
              <span className="stat-value">{stats.queueDepth}</span>
            </div>
            <div className="llm-stat-row">
              <span className="stat-label">Status</span>
              <span className={`processing-indicator ${stats.processingCount > 0 ? 'active' : ''}`}>
                {stats.processingCount > 0 ? ' Processing' : ' Idle'}
              </span>
            </div>
          </div>

          {/* Totals */}
          <div className="llm-totals">
            <div className="total-item"><span className="total-label">Processed</span><span className="total-value success">{stats.totalProcessed?.toLocaleString()}</span></div>
            <div className="total-item"><span className="total-label">Timeouts</span><span className="total-value warning">{stats.totalTimedOut}</span></div>
            <div className="total-item"><span className="total-label">Failed</span><span className="total-value error">{stats.totalFailed}</span></div>
          </div>

          {/* Lifetime Tokens */}
          <div className="llm-totals token-totals">
            <div className="total-item"><span className="total-label">Total In</span><span className="total-value info">{(stats.totalPromptTokens || 0).toLocaleString()}</span></div>
            <div className="total-item"><span className="total-label">Total Out</span><span className="total-value info">{(stats.totalCompletionTokens || 0).toLocaleString()}</span></div>
          </div>

          {/* Recent Requests Timeline */}
          {stats.recentRequests && stats.recentRequests.length > 0 && (
            <div className="recent-requests">
              <div className="recent-header">Recent ({stats.recentRequests.length})</div>
              <div className="request-timeline">
                {stats.recentRequests.slice(-10).map((req, idx) => (
                  <div key={idx}
                    className={`request-dot ${req.success ? 'success' : req.timedOut ? 'timeout' : 'failed'}`}
                    title={`${req.durationMs}ms - ${req.promptTokens || 0} in / ${req.completionTokens || 0} out`}
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
export function AgentInfoPanel({ agents, width = 380, taskProgress = 0, selectedAgentId, onAgentSelect, llmQueueStats, llmTraceEvents }: AgentInfoPanelProps) {
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [columnWidths, setColumnWidths] = useState<number[]>([90, 80, 70, 80]); // Agent, Zone, Status, Tasks
  const resizingRef = useRef<{ index: number; startX: number; startWidth: number } | null>(null);
  
  // Collapse states for panels
  const [agentsPanelCollapsed, setAgentsPanelCollapsed] = useState(false);
  const [llmPanelCollapsed, setLlmPanelCollapsed] = useState(false);
  const [llmPanelHeight, setLlmPanelHeight] = useState<number>(420);
  
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
                  llmTraceEvents={llmTraceEvents}
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
                          <span className={`agent-num ${agent.role === 'IMPOSTOR' ? 'impostor-name' : 'crewmate-name'}${agent.playerState === 'DEAD' ? ' agent-dead' : ''}`}>{colorName}</span>
                          {agent.role === 'IMPOSTOR' && <KillStatusIcon killStatus={agent.killStatus} />}
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
