import './AgentInfoPanel.css';

export interface AgentSummary {
  id: string;
  activityState: string;
  currentZone: string | null;
  locationState: string;
  goal: string | null;
}

interface AgentInfoPanelProps {
  agents: AgentSummary[];
}

export function AgentInfoPanel({ agents }: AgentInfoPanelProps) {
  return (
    <aside className="agent-panel">
      <header className="agent-panel__header">
        <h2>Agent Activity</h2>
        <span className="agent-panel__count">{agents.length} active</span>
      </header>
      <div className="agent-panel__list">
        {agents.map(agent => (
          <section key={agent.id} className="agent-card">
            <h3 className="agent-card__title">{agent.id}</h3>
            <dl className="agent-card__details">
              <div>
                <dt>Status</dt>
                <dd>{agent.activityState}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{agent.currentZone ?? 'Unknown'}</dd>
              </div>
              <div>
                <dt>Zone Type</dt>
                <dd>{agent.locationState}</dd>
              </div>
              <div>
                <dt>Goal</dt>
                <dd>{agent.goal ?? 'Idle'}</dd>
              </div>
            </dl>
          </section>
        ))}
      </div>
    </aside>
  );
}
