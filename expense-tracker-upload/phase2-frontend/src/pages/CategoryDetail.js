import React, { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import MonthYearNav from '../components/MonthYearNav';
import { transactionGroups } from '../components/transaction';
import { iconStyle } from '../components/iconStyle';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const fmt = (n) => `$${Math.round(n).toLocaleString()}`;
const fmt2 = (n) => `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function CategoryDetail({ expenses = [], categories = [] }) {
  const navigate = useNavigate();
  const location = useLocation();
  const now = new Date();
  const name = location.state?.name;
  const backTo = location.state?.backTo || '/';
  const backState = location.state?.backState;

  const [year, setYear] = useState(location.state?.year ?? now.getFullYear());
  const [month, setMonth] = useState(location.state?.month ?? now.getMonth());
  const [allMonths, setAllMonths] = useState(true);

  if (!name) return <Navigate to="/" replace />;

  const sheet = categories.find(c => c.name === name);
  const monthlyBudget = sheet?.budget || 0;
  const color = sheet?.color || '#0F6E7A';
  const icon = sheet?.icon || '•';

  const catExpenses = expenses.filter(e => e.category === name);
  const txGroups = transactionGroups(expenses);
  const monthTotals = Array.from({ length: 12 }, (_, m) => {
    const prefix = `${year}-${String(m + 1).padStart(2, '0')}`;
    return catExpenses.filter(e => e.date.startsWith(prefix)).reduce((s, e) => s + e.amount, 0);
  });
  const yearTotal = monthTotals.reduce((a, b) => a + b, 0);
  const overCount = monthlyBudget ? monthTotals.filter(t => t > monthlyBudget).length : 0;

  const chartHeight = 110;
  const chartMax = Math.max(...monthTotals, monthlyBudget, 1);
  const budgetLine = monthlyBudget ? (monthlyBudget / chartMax) * (chartHeight - 4) : null;

  const barColor = (t, m) => {
    if (t === 0) return '#D5E0E4';
    if (monthlyBudget && t > monthlyBudget) return '#E07B2E';
    return !allMonths && m === month ? color : '#8FC3C9';
  };

  const prefix = allMonths ? `${year}-` : `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthList = catExpenses
    .filter(e => e.date.startsWith(prefix))
    .sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
  const monthTotal = allMonths ? yearTotal : monthTotals[month];
  const pickMonth = (m) => { setMonth(m); setAllMonths(false); };

  return (
    <div className="cd">
      <MonthYearNav year={year} month={month} onChange={(y, m) => { setYear(y); if (m !== month) pickMonth(m); }} onYearClick={() => navigate('/yearly', { state: { year } })} left={<button className="xv-round" onClick={() => navigate(backTo, { state: backState })} aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 6l-6 6 6 6"/></svg>
        </button>} />

      <div className="xv-top">
        <div className="cd-title cd-title-row"><span className="xv-icon cd-icon" style={iconStyle(color)}>{icon}</span>{name}</div>
      </div>

      <div className="yv-summary">
        <div className="yv-summary-row">
          <span className="yv-label">{name} in {year}</span>
          <span className="yv-total">{fmt(yearTotal)}</span>
        </div>
        <div className="yv-stats">
          <div><span className="yv-label">Monthly budget</span><b>{monthlyBudget ? fmt(monthlyBudget) : '—'}</b></div>
          <div><span className="yv-label">Over budget</span><b>{overCount} {overCount === 1 ? 'month' : 'months'}</b></div>
        </div>
      </div>

      <div className="yv-card">
        <div className="yv-card-head">
          <span className="yv-card-title">Spending by month</span>
          <span className="yv-muted">Tap a month to see its expenses</span>
        </div>
        <div className="yv-chart" style={{ height: chartHeight }}>
          {budgetLine !== null && <div className="yv-budget-line" style={{ bottom: budgetLine }} />}
          {monthTotals.map((t, m) => (
            <button
              key={m}
              className={`yv-bar ${!allMonths && m === month ? 'cd-bar-on' : ''}`}
              title={`${MONTHS[m]}: ${t ? fmt(t) : 'no spending'}`}
              aria-label={`${MONTHS[m]} ${t ? fmt(t) : 'no spending'}`}
              onClick={() => pickMonth(m)}
              style={{ height: t ? Math.max((t / chartMax) * (chartHeight - 4), 4) : 4, background: barColor(t, m) }}
            />
          ))}
        </div>
        <div className="yv-months">
          {INITIALS.map((l, i) => <span key={i} style={!allMonths && i === month ? { color: '#12202B', fontWeight: 700 } : undefined}>{l}</span>)}
        </div>
        {monthlyBudget > 0 && (
          <div className="yv-legend">
            <span style={{ color: '#B4571A' }}>&#9632; Over budget</span>
            <span>- - Monthly budget {fmt(monthlyBudget)}</span>
          </div>
        )}
      </div>

      <div className="yv-card cd-list">
        <div className="yv-card-head">
          <span className="yv-card-title">{allMonths ? `All of ${year}` : `${MONTHS[month]} ${year}`}</span>
          <span className="cd-month-total">
            {fmt2(monthTotal)}{monthlyBudget > 0 && <span className="yv-muted"> of {fmt(allMonths ? monthlyBudget * 12 : monthlyBudget)}</span>}
          </span>
        </div>
        <div className="cd-toggle">
          <button className={allMonths ? 'on' : ''} onClick={() => setAllMonths(true)}>All months</button>
          <button className={!allMonths ? 'on' : ''} onClick={() => setAllMonths(false)}>{MONTHS[month]}</button>
        </div>
        {monthList.length === 0 && <div className="yv-muted cd-empty">No {name} expenses {allMonths ? `in ${year}` : 'this month'}</div>}
        {monthList.map((e, i) => (
          <div className="cd-item" key={i}>
            <div className="cd-date">
              <b>{Number(e.date.slice(8, 10))}</b>
              <span>{MONTHS[Number(e.date.slice(5, 7)) - 1].slice(0, 3)}</span>
            </div>
            <div className="cd-mid">
              <div className="cd-merchant">{e.merchant || name}</div>
              <div className="yv-muted">{[e.paymentMethod, e.type, e.description].filter(Boolean).join(' · ')}</div>
              {txGroups[e.transactionId]?.count > 1 && (
                <div className="tx-tag">Split · part of a {fmt2(txGroups[e.transactionId].total)} transaction</div>
              )}
            </div>
            <div className="cd-amt">{fmt2(e.amount)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
