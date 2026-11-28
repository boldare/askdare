import { render } from 'preact';
import { App } from './app';
import type { DashboardEntry } from './host';
import './dashboard.css';

const entry: DashboardEntry = {
  mount(element, host) {
    render(<App host={host} />, element);
    return () => render(null, element);
  },
};

(globalThis as { askdareAdminDashboard?: DashboardEntry }).askdareAdminDashboard = entry;
window.dispatchEvent(new Event('askdare-admin-dashboard'));
