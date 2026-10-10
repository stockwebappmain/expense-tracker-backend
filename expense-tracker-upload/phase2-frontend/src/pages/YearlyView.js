import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { iconStyle } from '../components/iconStyle';

const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (n) => `$${Math.round(n).toLocaleString()}`;

export default function YearlyView({ expenses = [], categories = [], budget }) {
  const navigate = useNavigate();
  const now = new Date();
  const location = useLocation();
  const [year, setYear] = useState(location.state?.year ?? now.getFullYear());

  const categoryBudgetSum = categories.reduce((sum, c) => sum + (c.budget || 0), 0);
  const monthlyBudget = budget?.totalBudget || categoryBudgetSum || 0;
  const yearlyBudget = monthlyBudget * 12;

  const yearExpenses = expenses.filter(e => e.date && e.date.startsWith(String(year)));
  const monthTotals = Array.from({ length: 12 }, (_, m) => {
    const prefix = `${year}-${String(m + 1).padStart(2, '0')}`;
    return yearExpenses.filter(e => e.date.startsWith(prefix)).reduce((s, e) => s + e.amount, 0);
  });

  const yearTotal = monthTotals.reduce((a, b) => a + b, 0);
  const monthsWithData = monthTotals.filter(t => t > 0).length;
  const monthlyAvg = monthsWithData ? yearTotal / monthsWithData : 0;
  const overBudgetCount = monthlyBudget ? monthTotals.filter(t => t > monthlyBudget).length : 0;

  const chartMax = Math.max(...monthTotals, monthlyBudget, 1);
  const chartHeight = 100;
  const budgetLine = monthlyBudget ? (monthlyBudget / chartMax) * (chartHeight - 4) : null;
  const isCurrentMonth = (m) => year === now.getFullYear() && m === now.getMonth();

  const barColor = (total, m) => {
    if (total === 0) return '#D5E0E4';
    if (monthlyBudget && total > monthlyBudget) return '#E07B2E';
    if (isCurrentMonth(m)) return '#0F6E7A';
    return '#8FC3C9';
  };

  const catTotals = {};
  yearExpenses.forEach(e => { catTotals[e.category] = (catTotals[e.category] || 0) + e.amount; });
  const catRows = Object.entries(catTotals)
    .sort(([, a], [, b]) => b - a)
    .map(([name, amount]) => {
      const sheet = categories.find(c => c.name === name);
      const catYearBudget = (sheet?.budget || 0) * 12;
      return {
        name,
        amount,
        icon: sheet?.icon || '•',
        color: sheet?.color || '#6B7782',
        barPct: catYearBudget ? Math.min((amount / catYearBudget) * 100, 100) : 0,
        sharePct: yearlyBudget ? (amount / yearlyBudget) * 100 : 0
      };
    });

  const openMonth = (m) => navigate('/', { state: { year, month: m } });

  return (
    <div className="yv">
      <div className="yv-top">
        <button className="yv-round" onClick={() => navigate('/')} aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 6l-6 6 6 6"/></svg>
        </button>
        <div className="yv-yearnav">
          <button onClick={() => setYear(year - 1)} aria-label="Previous year">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 6l-6 6 6 6"/></svg>
          </button>
          <span>{year}</span>
          <button onClick={() => setYear(year + 1)} aria-label="Next year">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 6l6 6-6 6"/></svg>
          </button>
        </div>
        <button className="yv-pill" onClick={() => navigate('/')}>Month view</button>
      </div>

      <div className="yv-summary">
        <div className="yv-summary-row">
          <span className="yv-label">Spent so far in {year}</span>
          <span className="yv-total">{fmt(yearTotal)}</span>
        </div>
        <div className="yv-stats">
          <div><span className="yv-label">Monthly avg</span><b>{fmt(monthlyAvg)}</b></div>
          <div><span className="yv-label">Over budget</span><b>{overBudgetCount} {overBudgetCount === 1 ? 'month' : 'months'}</b></div>
        </div>
      </div>

      <div className="yv-card">
        <div className="yv-card-head">
          <span className="yv-card-title">Spending by month</span>
          <span className="yv-muted">Tap a month to open it</span>
        </div>
        <div className="yv-chart" style={{ height: chartHeight }}>
          {budgetLine !== null && <div className="yv-budget-line" style={{ bottom: budgetLine }} />}
          {monthTotals.map((t, m) => (
            <button
              key={m}
              className="yv-bar"
              aria-label={`${MONTH_NAMES[m]} ${t ? fmt(t) : 'no data'}`}
              title={`${MONTH_NAMES[m]}: ${t ? fmt(t) : 'no data'}`}
              onClick={() => openMonth(m)}
              style={{ height: t ? Math.max((t / chartMax) * (chartHeight - 4), 4) : 4, background: barColor(t, m) }}
            />
          ))}
        </div>
        <div className="yv-months">
          {MONTH_INITIALS.map((l, i) => <span key={i}>{l}</span>)}
        </div>
        <div className="yv-legend">
          <span>&#9632; Under budget</span>
          <span style={{ color: '#B4571A' }}>&#9632; Over budget</span>
          {monthlyBudget > 0 && <span>- - Monthly budget {fmt(monthlyBudget)}</span>}
        </div>
      </div>

      <div className="yv-card yv-cats">
        <div className="yv-card-head">
          <span className="yv-card-title">Categories</span>
          <span className="yv-muted">Spent · % of {fmt(yearlyBudget)} yearly budget</span>
        </div>
        {catRows.length === 0 && <div className="yv-muted">No expenses in {year} yet</div>}
        {catRows.map(c => (
          <div className="yv-cat xv-link" key={c.name} role="button" tabIndex={0} onClick={() => navigate('/category', { state: { name: c.name, year, month: year === now.getFullYear() ? now.getMonth() : 11, backTo: '/yearly', backState: { year } } })}>
            <span className="yv-cat-icon" style={iconStyle(c.color)}>{c.icon}</span>
            <div className="yv-cat-mid">
              <div className="yv-cat-name">{c.name}</div>
              <div className="yv-cat-track"><div style={{ width: `${c.barPct}%`, background: c.color }} /></div>
            </div>
            <div className="yv-cat-right">
              <div className="yv-cat-amt">{fmt(c.amount)}</div>
              <div className="yv-muted">{c.sharePct.toFixed(0)}%</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
