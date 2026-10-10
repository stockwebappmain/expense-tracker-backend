import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const TABS = [
  { path: '/', label: 'Home', match: ['/'], icon: <path d="M4 11l8-7 8 7v9H4z"/> },
  { path: '/expenses', label: 'Activity', match: ['/expenses', '/category', '/daily'], icon: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/> },
  null,
  { path: '/yearly', label: 'Budget', match: ['/yearly'], icon: <><circle cx="12" cy="12" r="8"/><path d="M12 12V4M12 12l6 4"/></> },
  { path: '/settings', label: 'Profile', match: ['/settings'], icon: <><circle cx="12" cy="8" r="4"/><path d="M4 20c1-4 4-6 8-6s7 2 8 6"/></> }
];

export default function BottomNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <nav className="bottom-nav">
      {TABS.map((tab, i) => tab === null ? (
        <button key="add" className="nav-fab" onClick={() => navigate('/add')} aria-label="Add expense">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      ) : (
        <button key={tab.path} className={`nav-tab ${tab.match.includes(pathname) ? 'active' : ''}`} onClick={() => navigate(tab.path)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{tab.icon}</svg>
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
