import { RouteApp } from './router.tsx'
import { Landing, MockFrame, MockStat, MockBars, MockList } from './Landing.tsx'
import Tool from './Tool.tsx'

function ProductLanding() {
  return (
    <Landing
      name="History Doctor"
      icon="monitoring"
      tagline="Temporal workflow history analyzer"
      headline="Catch Temporal history limits before they page you"
      support="Drop in an Event History export and see size, Actions cost, payload bloat, retries, and how close you are to Continue-As-New."
      audience="For Temporal Cloud and self-hosted teams who ship long-running workflows."
      features={[
        {
          icon: 'folder_open',
          title: 'Paste or drop histories',
          body: 'Works on exported JSON in the browser. Nothing leaves your machine.',
        },
        {
          icon: 'payments',
          title: 'Actions & cost',
          body: 'Project Temporal Cloud Actions spend from retries, timers, and heartbeats.',
        },
        {
          icon: 'warning',
          title: 'Limit radar',
          body: 'Track event count and history byte size against Temporal hard limits.',
        },
      ]}
      slides={[
        {
          title: 'Overview',
          caption: 'Event count, history size, and estimated Actions cost at a glance.',
          preview: (
            <MockFrame title="Overview">
              <div className="mock-stats">
                <MockStat label="Events" value="48.2k" tone="warn" />
                <MockStat label="Size" value="42 MB" tone="warn" />
                <MockStat label="Est. cost" value="$12.40" />
              </div>
            </MockFrame>
          ),
        },
        {
          title: 'Recommendations',
          caption: 'Prioritized findings so you know what to fix first.',
          preview: (
            <MockFrame title="Recommendations">
              <MockList
                items={[
                  { badge: 'High', text: 'Continue-As-New before the 50k event hard limit', tone: 'bad' },
                  { badge: 'Medium', text: 'Large activity payloads are bloating history size', tone: 'warn' },
                  { badge: 'Medium', text: 'Retry storms are driving Actions spend', tone: 'warn' },
                ]}
              />
            </MockFrame>
          ),
        },
        {
          title: 'Timeline',
          caption: 'See which event types dominate the history.',
          preview: (
            <MockFrame title="Timeline">
              <MockBars
                items={[
                  { label: 'ActivityTaskScheduled', w: 88 },
                  { label: 'TimerStarted', w: 62 },
                  { label: 'WorkflowTaskCompleted', w: 45 },
                ]}
              />
            </MockFrame>
          ),
        },
      ]}
    />
  )
}

export default function App() {
  return <RouteApp landing={<ProductLanding />} tool={<Tool />} />
}
