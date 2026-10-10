import React from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { iconStyle } from '../components/iconStyle';
import { transactionGroups } from '../components/transaction';

const fmt2 = (n) => `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const parseDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export default function DailyView({ expenses = [], categories = [] }) {
  const navigate = useNavigate();
  const location = useLocation();
  const date = location.state?.date;

  if (!date) return <Navigate to="/" replace />;

  const daysWithSpend = [...new Set(expenses.filter(e => e.date && e.amount > 0).map(e => e.date))].sort();
  const idx = daysWithSpend.indexOf(date);
  const prevDay = idx > 0 ? daysWithSpend[idx - 1] : daysWithSpend.filter(d => d < date).pop();
  const nextDay = idx >= 0 ? daysWithSpend[idx + 1] : daysWithSpend.find(d => d > date);

  const dayExpenses = expenses
    .filter(e => e.date === date)
    .sort((a, b) => (a.transactionId || '').localeCompare(b.transactionId || '') || (a.time || '').localeCompare(b.time || ''));
  const total = dayExpenses.reduce((s, e) => s + e.amount, 0);
  const catCount = new Set(dayExpenses.map(e => e.category)).size;
  const avg = dayExpenses.length ? total / dayExpenses.length : 0;

  const day = parseDay(date);
  const title = day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const goDay = (d) => navigate('/daily', { state: { date: d }, replace: true });
  const sheet = (name) => categories.find(c => c.name === name);
  const txGroups = transactionGroups(expenses);

  return (
    <div className="dv">
      <div className="dv-top">
        <button className="xv-round" onClick={() => navigate('/', { state: { year: day.getFullYear(), month: day.getMonth() } })} aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 6l-6 6 6 6"/></svg>
        </button>
        <span className="dv-title">{title}</span>
      </div>

      <div className="yv-summary">
        <span className="yv-label">Total spent</span>
        <span className="dv-total">{fmt2(total)}</span>
        <div className="dv-stats">
          <div><span className="yv-label">Expenses</span><b>{dayExpenses.length}</b></div>
          <div><span className="yv-label">Categories</span><b>{catCount}</b></div>
          <div><span className="yv-label">Avg per item</span><b>{fmt2(avg)}</b></div>
        </div>
      </div>

      <div className="dv-daynav">
        <button className="xv-pill" disabled={!prevDay} onClick={() => goDay(prevDay)} title="Previous day with spending">❮ Previous</button>
        <button className="xv-pill" disabled={!nextDay} onClick={() => goDay(nextDay)} title="Next day with spending">Next ❯</button>
      </div>

      <div className="yv-card cd-list">
        <div className="yv-card-head">
          <span className="yv-card-title">Expenses</span>
        </div>
        {dayExpenses.map((e, i) => {
          const s = sheet(e.category);
          return (
            <div className="cd-item" key={i}>
              <span className="xv-icon" style={iconStyle(s?.color)}>{s?.icon || '•'}</span>
              <div className="cd-mid">
                <div className="cd-merchant">{e.merchant || e.category}</div>
                <div className="yv-muted">{[e.category, e.type, e.paymentMethod, e.entryMethod, e.enteredBy].filter(Boolean).join(' · ')}</div>
                {e.description && <div className="yv-muted">{e.description}</div>}
                {txGroups[e.transactionId]?.count > 1 && (
                  <div className="tx-tag">Split · part of a {fmt2(txGroups[e.transactionId].total)} transaction ({txGroups[e.transactionId].count} entries)</div>
                )}
              </div>
              <div className="cd-amt">{fmt2(e.amount)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
