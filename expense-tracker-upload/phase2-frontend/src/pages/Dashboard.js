import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import MonthYearNav from '../components/MonthYearNav';
import { iconStyle } from '../components/iconStyle';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const categoryColors = {
  Housing: '#0F6E7A',
  Food: '#E07B2E',
  Transport: '#3A7BD5',
  Shopping: '#7A4FB5',
  Entertainment: '#8A96A0',
  Utilities: '#E87C5A',
  Health: '#2A9D8F',
  Other: '#8A96A0'
};

const categoryIcons = {
  Housing: '🏠',
  Food: '🍔',
  Transport: '🚗',
  Shopping: '🛒',
  Entertainment: '🎬',
  Utilities: '⚡',
  Health: '🏥',
  Other: '•••'
};

export default function Dashboard({ expenses, categories, budget, budgets = [], onAddExpense, onOpenAssistant, loadError, onRetry }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [currentDate, setCurrentDate] = useState(() =>
    location.state?.year != null ? new Date(location.state.year, location.state.month, 1) : new Date()
  );
  const [todayTotal, setTodayTotal] = useState(0);
  const [monthTotal, setMonthTotal] = useState(0);
  const [fixedTotal, setFixedTotal] = useState(0);
  const [variableTotal, setVariableTotal] = useState(0);
  const [topCategories, setTopCategories] = useState([]);
  const [dailySpending, setDailySpending] = useState({});

  useEffect(() => {
    calculateStats();
  }, [expenses, categories, currentDate]);

  const calculateStats = () => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const monthStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;

    const todayExpenses = expenses.filter(e => e.date === today);
    const monthExpenses = expenses.filter(e => e.date.startsWith(monthStr));

    setTodayTotal(todayExpenses.reduce((sum, e) => sum + e.amount, 0));
    setMonthTotal(monthExpenses.reduce((sum, e) => sum + e.amount, 0));

    const fixed = monthExpenses.filter(e => e.type === 'Fixed').reduce((sum, e) => sum + e.amount, 0);
    const variable = monthExpenses.filter(e => e.type === 'Variable').reduce((sum, e) => sum + e.amount, 0);
    setFixedTotal(fixed);
    setVariableTotal(variable);

    const catTotals = {};
    monthExpenses.filter(e => e.type === 'Variable').forEach(e => {
      catTotals[e.category] = (catTotals[e.category] || 0) + e.amount;
    });

    const pctUsed = ([name, amount]) => {
      const b = (categories || []).find(c => c.name === name)?.budget;
      return b ? amount / b : -1;
    };
    const sorted = Object.entries(catTotals)
      .sort((a, b) => pctUsed(b) - pctUsed(a))
      .slice(0, 5)
      .map(([name, amount]) => ({ name, amount }));

    setTopCategories(sorted);

    const daily = {};
    monthExpenses.forEach(e => {
      daily[e.date] = (daily[e.date] || 0) + e.amount;
    });
    setDailySpending(daily);
  };

  const sheetCat = (name) => (categories || []).find(c => c.name === name);
  const catColor = (name) => sheetCat(name)?.color || categoryColors[name] || '#8A96A0';
  const catIcon = (name) => sheetCat(name)?.icon || categoryIcons[name] || '•';

  const catPct = (cat) => sheetCat(cat.name)?.budget ? (cat.amount / sheetCat(cat.name).budget) * 100 : null;
  const pctStyle = (pct) => pct > 100 ? { color: '#D64545', fontWeight: 700 } : pct >= 80 ? { color: '#E08A00', fontWeight: 700 } : undefined;

  const changeMonth = (offset) => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1));
  };

  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthBudget = budgets.find(b => b.month === MONTH_NAMES[currentDate.getMonth()] && String(b.year) === String(currentDate.getFullYear()));
  const categoryBudgetSum = (categories || []).reduce((sum, c) => sum + (c.budget || 0), 0);
  budget = monthBudget || (categoryBudgetSum > 0 ? { totalBudget: categoryBudgetSum } : null);
  const remaining = budget ? budget.totalBudget - monthTotal : 0;
  const budgetPercent = budget ? Math.min((monthTotal / budget.totalBudget) * 100, 100) : 0;


  const getDaysInMonth = () => {
    return new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
  };

  const getWeekDay = (day) => {
    const d = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    return d.getDay();
  };

  const getDayColor = (date) => {
    const amount = dailySpending[date] || 0;
    const monthAvg = monthTotal / getDaysInMonth();
    if (amount === 0) return 'transparent';
    if (amount < monthAvg * 0.3) return '#D5EAEC';
    if (amount < monthAvg * 0.7) return '#8FC3C9';
    return '#0F6E7A';
  };

  return (
    <div className="dashboard-container">
      <div className="dashboard-content">
        <MonthYearNav
          year={currentDate.getFullYear()}
          month={currentDate.getMonth()}
          onChange={(y, m) => setCurrentDate(new Date(y, m, 1))}
          onYearClick={() => navigate('/yearly', { state: { year: currentDate.getFullYear() } })}
          left={
            <button className="ph-mic" title="Ask or add by voice" aria-label="Open voice assistant" onClick={() => onOpenAssistant && onOpenAssistant()}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 2c-2.2 0-4 1.8-4 4v7c0 2.2 1.8 4 4 4s4-1.8 4-4V6c0-2.2-1.8-4-4-4z" fill="currentColor"/>
                <path d="M4 12a8 8 0 0 0 16 0"/>
                <path d="M12 20v2"/>
              </svg>
            </button>
          }
        />

        {/* Budget Card */}
        {loadError && (
          <div className="load-error" role="alert">
            <div>{loadError}</div>
            <button onClick={() => onRetry && onRetry()}>Try again</button>
          </div>
        )}

        {(
          <div className={`budget-card-dark ${budget && remaining < 0 ? 'over-budget' : ''}`}>
            <div className="budget-label">{!budget ? 'Spent this month' : remaining < 0 ? 'Over budget by' : 'Remaining budget'}</div>
            <div className="budget-amount">${(budget ? Math.abs(remaining) : monthTotal).toFixed(0)}</div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${budget ? budgetPercent : 0}%` }}></div>
            </div>
            <div className="budget-info">{budget ? `$${monthTotal.toFixed(0)} spent of $${budget.totalBudget.toFixed(0)}` : 'No budget set for this month'}</div>
            <div className="budget-breakdown">
              <button className="breakdown-btn" onClick={() => navigate('/expenses', { state: { year: currentDate.getFullYear(), month: currentDate.getMonth(), type: 'Fixed' } })}>
                <span>Fixed</span>
                <strong>${fixedTotal.toFixed(0)}</strong>
              </button>
              <button className="breakdown-btn" onClick={() => navigate('/expenses', { state: { year: currentDate.getFullYear(), month: currentDate.getMonth(), type: 'Variable' } })}>
                <span>Variable</span>
                <strong>${variableTotal.toFixed(0)}</strong>
              </button>
            </div>
          </div>
        )}

        {/* Top Categories */}
        {topCategories.length === 0 && (
          <div className="categories-card">
            <div className="card-header">
              <span className="card-title">Top 5 Variable Categories</span>
              <span className="card-subtitle">% of budget used</span>
            </div>
            <div className="empty-note">No variable spending in {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} yet.</div>
          </div>
        )}
        {topCategories.length > 0 && (
          <div className="categories-card">
            <div className="card-header">
              <span className="card-title">Top 5 Variable Categories</span>
              <span className="card-subtitle">% of budget used</span>
            </div>
            <div className="categories-content">
              <div className="donut-chart">
                <svg width="118" height="118" viewBox="0 0 130 130" style={{transform: 'rotate(-90deg)'}} fill="none" strokeWidth="16">
                  {topCategories.map((cat, idx) => {
                    const total = topCategories.reduce((sum, c) => sum + c.amount, 0);
                    const percent = (cat.amount / total) * 100;
                    const circumference = 2 * Math.PI * 52;
                    const offset = topCategories.slice(0, idx).reduce((sum, c) => sum + (c.amount / total) * circumference, 0);
                    const gap = topCategories.length > 1 ? 4 : 0;
                    const dasharray = Math.max((percent / 100) * circumference - gap, 1);
                    return (
                      <circle
                        key={idx}
                        cx="65"
                        cy="65"
                        r="52"
                        stroke={catColor(cat.name)}
                        strokeDasharray={`${dasharray} ${circumference}`}
                        strokeDashoffset={-offset}
                      />
                    );
                  })}
                </svg>
                <div className="donut-center">
                  <div className="donut-label">Spent</div>
                  <div className="donut-amount">${variableTotal.toFixed(0)}</div>
                </div>
              </div>
              <div className="categories-list">
                {topCategories.map((cat, i) => (
                  <div key={i} className="category-row">
                    <div className="category-icon" style={iconStyle(catColor(cat.name))}>
                      {catIcon(cat.name)}
                    </div>
                    <span className="category-name">{cat.name}</span>
                    <strong className="category-amount">${cat.amount.toFixed(0)}</strong>
                    <span className="category-percent" style={catPct(cat) !== null ? pctStyle(catPct(cat)) : undefined} title={catPct(cat) === null ? 'No budget set for this category in the Categories sheet' : undefined}>{catPct(cat) !== null ? `${catPct(cat).toFixed(0)}%` : '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Daily Spending Calendar */}
        <div className="daily-card">
          <div className="card-header">
            <span className="card-title">Daily spending</span>
            <span className="card-subtitle">Darker = more spent</span>
          </div>
          <div className="calendar-grid">
            <span className="week-label">S</span>
            <span className="week-label">M</span>
            <span className="week-label">T</span>
            <span className="week-label">W</span>
            <span className="week-label">T</span>
            <span className="week-label">F</span>
            <span className="week-label">S</span>

            {Array.from({length: getWeekDay(1)}).map((_, i) => (
              <span key={`empty-${i}`}></span>
            ))}

            {Array.from({length: getDaysInMonth()}).map((_, i) => {
              const day = i + 1;
              const date = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              return (
                <div
                  key={day}
                  className={`day-cell ${dailySpending[date] > 0 ? 'has-spend' : 'no-spend'}`}
                  role={dailySpending[date] > 0 ? 'button' : undefined}
                  tabIndex={dailySpending[date] > 0 ? 0 : undefined}
                  onClick={dailySpending[date] > 0 ? () => navigate('/daily', { state: { date } }) : undefined}
                  onKeyDown={dailySpending[date] > 0 ? (ev) => ev.key === 'Enter' && navigate('/daily', { state: { date } }) : undefined}
                  style={{backgroundColor: getDayColor(date), color: getDayColor(date) === '#0F6E7A' ? '#fff' : undefined}}
                  title={`${date}: $${(dailySpending[date] || 0).toFixed(2)}`}
                >
                  <span className="day-num">{day}</span>
                  {dailySpending[date] > 0 && <span className="day-amt">${Math.round(dailySpending[date])}</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
