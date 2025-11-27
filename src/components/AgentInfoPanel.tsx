import { useState, useRef, useCallback } from 'react';
import './AgentInfoPanel.css';
import type { TaskAssignment } from '@shared/types/simulation.types.ts';
import type { PlayerRole } from '@shared/types/game.types.ts';
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
}

interface ExpandedAgentCardProps {
  agent: AgentSummary;
  onClose: () => void;
}

function ExpandedAgentCard({ agent, onClose }: ExpandedAgentCardProps) {
  const role = getRoleBadge(agent.role);
  const totalTasks = agent.assignedTasks?.length ?? 0;
  const completed = agent.tasksCompleted ?? 0;
  const taskPercent = totalTasks > 0 ? (completed / totalTasks) * 100 : 0;
  const colorName = getColorName(agent.color);
  
  return (
    <div className="expanded-agent-card">
      <div className="expanded-card__header">
        <div className="expanded-card__title">
          <span className="agent-color-dot large" style={{ backgroundColor: hexColor(agent.color) }} />
          <span className="expanded-card__name">{colorName}</span>
          <span className={`role-badge ${role.className}`}>{role.label}</span>
        </div>
        <button className="expanded-card__close" onClick={onClose}>×</button>
      </div>
      
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
    </div>
  );
}

export function AgentInfoPanel({ agents, width = 380, taskProgress = 0 }: AgentInfoPanelProps) {
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [columnWidths, setColumnWidths] = useState<number[]>([90, 80, 70, 80]); // Agent, Zone, Status, Tasks
  const resizingRef = useRef<{ index: number; startX: number; startWidth: number } | null>(null);
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
      <header className="agent-panel__header">
        <h2>Agents</h2>
        <div className="agent-panel__counts">
          <span className="count-badge crew">{crewmateCount} Crew</span>
          <span className="count-badge imp">{impostorCount} Imp</span>
        </div>
      </header>
      
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
              const role = getRoleBadge(agent.role);
              const totalTasks = agent.assignedTasks?.length ?? 0;
              const completed = agent.tasksCompleted ?? 0;
              const colorName = getColorName(agent.color);
              
              return (
                <tr 
                  key={agent.id} 
                  className="agent-row clickable"
                  onClick={() => setExpandedAgentId(agent.id)}
                >
                  <td className="agent-row__id" style={{ width: columnWidths[0] }}>
                    <span className="agent-color-dot" style={{ backgroundColor: hexColor(agent.color) }} />
                    <span className="agent-num">{colorName}</span>
                    <span className={`role-badge mini ${role.className}`}>{role.label}</span>
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
    </aside>
  );
}
