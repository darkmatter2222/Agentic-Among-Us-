import './AgentInfoPanel.css';

export interface AgentSummary {
  id: string;
  color: number;
  activityState: string;
  currentZone: string | null;
  locationState: string;
  goal: string | null;
}

function hexColor(num: number): string {
  return '#' + num.toString(16).padStart(6, '0');
}

interface AgentInfoPanelProps {
  agents: AgentSummary[];
  width?: number;
}

export function AgentInfoPanel({ agents, width = 340 }: AgentInfoPanelProps) {
  return (
    <aside className="agent-panel" style={{ width }}>
      <header className="agent-panel__header">
        <h2>Agents</h2>
        <span className="agent-panel__count">{agents.length}</span>
      </header>
      <div className="agent-panel__content">
        <table className="agent-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Zone</th>
              <th>Status</th>
              <th>Goal</th>
            </tr>
          </thead>
          <tbody>
          {agents.map(agent => (
            <tr key={agent.id} className="agent-row">
              <td className="agent-row__id">
                <span className="agent-color-dot" style={{ backgroundColor: hexColor(agent.color) }} />
                {agent.id.replace('agent_', '')}
              </td>
                <td className="agent-row__zone" title={agent.currentZone ?? 'Unknown'}>
                  {agent.currentZone?.replace(' (ROOM)', '').replace(' (HALLWAY)', '') ?? '?'}
                </td>
                <td className="agent-row__status">
                  <span className={`status-badge status-badge--${agent.activityState.toLowerCase()}`}>
                    {agent.activityState}
                  </span>
                </td>
                <td className="agent-row__goal" title={agent.goal ?? 'Idle'}>
                  {agent.goal ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </aside>
  );
}
