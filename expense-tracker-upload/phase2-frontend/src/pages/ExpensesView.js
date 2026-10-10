import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import MonthYearNav from '../components/MonthYearNav';
import { iconStyle } from '../components/iconStyle';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmt = (n) => `$${Math.round(n).toLocaleString()}`;

const TYPE_OPTIONS = [{ value: 'Fixed', label: 'Fixed' }, { value: 'Variable', label: 'Variable' }, { value: 'All', label: 'All' }];
const SORT_OPTIONS = [{ value: 'budget', label: '% budget used' }, { value: 'amount', label: 'Amount spent' }, { value: 'name', label: 'Name' }];

function Cycler({ label, options, value, onChange }) {
  const i = Math.max(0, options.findIndex(o => o.value === value));
  const step = (d) => onChange(options[(i + d + options.length) % options.length].value);
  return (
    <div className="ph-nav xv-cycler" role="group" aria-label={label}>
      <button onClick={() => step(-1)} aria-label={`Previous ${label}`}>❮</button>
      <span className="ph-month xv-cycler-val">{options[i].label}</span>
      <button onClick={() => step(1)} aria-label={`Next ${label}`}>❯</button>
    </div>
  );
}

export default function ExpensesView({ expenses = [], categories = [] }) {
  const navigate = useNavigate();
  const location = useLocation();
  const now = new Date();
  const [year, setYear] = useState(location.state?.year ?? now.getFullYear());
  const [month, setMonth] = useState(location.state?.month ?? now.getMonth());

  const [type, setType] = useState(location.state?.type || 'All');
  const [sortBy, setSortBy] = useState('budget');
  const [desc, setDesc] = useState(true);

  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthExpenses = expenses.filter(e => e.date && e.date.startsWith(prefix) && (type === 'All' || e.type === type));

  const totals = {};
  monthExpenses.forEach(e => { totals[e.category] = (totals[e.category] || 0) + e.amount; });

  const rows = Object.entries(totals).map(([name, spent]) => {
    const sheet = categories.find(c => c.name === name);
    const budget = sheet?.budget || 0;
    return {
      name,
      spent,
      budget,
      pct: budget ? (spent / budget) * 100 : 0,
      icon: sheet?.icon || '•',
      color: sheet?.color || '#0F6E7A'
    };
  });

  rows.sort((a, b) => {
    let diff;
    if (sortBy === 'amount') diff = a.spent - b.spent;
    else if (sortBy === 'name') diff = a.name.localeCompare(b.name);
    else diff = a.pct - b.pct;
    return desc ? -diff : diff;
  });

  const spentTotal = rows.reduce((s, r) => s + r.spent, 0);
  const budgetTotal = rows.reduce((s, r) => s + r.budget, 0);
  const label = type === 'All' ? 'expense categories' : `${type.toLowerCase()} expense categories`;

  const openCategory = (name) => navigate('/category', { state: { name, year, month, backTo: '/expenses', backState: { year, month, type } } });

  const barColor = (pct) => (pct > 100 ? '#D64545' : pct >= 100 ? '#E07B2E' : pct >= 80 ? '#E08A00' : '#0F6E7A');

  return (
    <div className="xv">
      <MonthYearNav year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m); }} onYearClick={() => navigate('/yearly', { state: { year } })} left={<button className="xv-round" onClick={() => navigate('/', { state: { year, month } })} aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 6l-6 6 6 6"/></svg>
        </button>} />

      <div className="myn xv-controls2">
        <Cycler label="Expense type" options={TYPE_OPTIONS} value={type} onChange={setType} />
        <Cycler label="Sort by" options={SORT_OPTIONS} value={sortBy} onChange={setSortBy} />
        <button className="xv-dir2" onClick={() => setDesc(!desc)} aria-label={`Toggle sort direction, currently ${desc ? 'highest' : 'lowest'} first`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ transform: desc ? 'none' : 'rotate(180deg)' }}><path d="M12 5v14M6 13l6 6 6-6"/></svg>
          {sortBy === 'name' ? (desc ? 'Z–A' : 'A–Z') : (desc ? 'Highest' : 'Lowest')}
        </button>
      </div>

      <div className="xv-summary">
        <span><b>{rows.length}</b> {label}</span>
        <span><b>{fmt(spentTotal)}</b> {budgetTotal > 0 && <span className="xv-muted">of {fmt(budgetTotal)} budgeted</span>}</span>
      </div>

      {rows.length === 0 && <div className="xv-empty">No {type === 'All' ? '' : type.toLowerCase() + ' '}expenses in {MONTHS[month]} {year}</div>}

      {rows.map(r => {
        const left = r.budget - r.spent;
        return (
          <div className="xv-row xv-link" key={r.name} role="button" tabIndex={0} onClick={() => openCategory(r.name)} onKeyDown={e => e.key === 'Enter' && openCategory(r.name)}>
            <span className="xv-icon" style={iconStyle(r.color)}>{r.icon}</span>
            <div className="xv-body">
              <div className="xv-head">
                <b>{r.name}</b>
                <span><b>{fmt(r.spent)}</b> {r.budget > 0 && <span className="xv-muted">of {fmt(r.budget)}</span>}</span>
              </div>
              <div className="xv-bar"><i style={{ width: `${r.budget ? Math.min(r.pct, 100) : 0}%`, background: barColor(r.pct) }} /></div>
              <div className="xv-sub">
                {r.budget > 0 ? (
                  <>
                    <span style={r.pct > 100 ? { color: '#D64545', fontWeight: 700 } : undefined}>
                      {r.pct.toFixed(0)}% used{r.pct > 100 ? ' · Over budget' : r.pct >= 100 ? ' · Budget reached' : ''}
                    </span>
                    <span>{left >= 0 ? `${fmt(left)} left` : `${fmt(-left)} over`}</span>
                  </>
                ) : (
                  <span>No budget set in Categories sheet</span>
                )}
              </div>
            </div>
            <svg className="xv-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 6l6 6-6 6"/></svg>
          </div>
        );
      })}
    </div>
  );
}
