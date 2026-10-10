import React from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export default function Settings({ user }) {
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      localStorage.removeItem('auth_token');
      window.location.href = '/';
    } catch (error) {
      localStorage.removeItem('auth_token');
      window.location.href = '/';
    }
  };

  return (
    <div className="settings-container">
      <header className="settings-header">
        <button onClick={() => navigate('/')}>← Back</button>
        <h1>Settings</h1>
      </header>

      <div className="settings-content">
        {user && (
          <div className="user-profile">
            <h2>Profile</h2>
            <div className="profile-card">
              <p><strong>Name:</strong> {user.name}</p>
              <p><strong>Email:</strong> {user.email}</p>
            </div>
          </div>
        )}

        <div className="settings-section">
          <h2>Preferences</h2>
          <div className="setting-item">
            <span>Theme</span>
            <select>
              <option>Light</option>
              <option>Dark</option>
              <option>Auto</option>
            </select>
          </div>
          <div className="setting-item">
            <span>Currency</span>
            <select>
              <option>USD ($)</option>
              <option>EUR (€)</option>
              <option>GBP (£)</option>
            </select>
          </div>
          <div className="setting-item">
            <span>Notifications</span>
            <input type="checkbox" defaultChecked />
          </div>
        </div>

        <div className="settings-section">
          <h2>About</h2>
          <div className="about-info">
            <p><strong>Expense Tracker v1.0</strong></p>
            <p>Track your spending with ease. Add expenses manually or with voice input.</p>
            <p><small>© 2026 Expense Tracker</small></p>
          </div>
        </div>

        <div className="settings-section danger">
          <button className="logout-btn" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}
