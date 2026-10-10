import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { iconStyle } from '../components/iconStyle';
import { newTransactionId } from '../components/transaction';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';
const FALLBACK_PAYMENT_METHODS = ['Credit Card', 'Debit Card', 'Cash', 'Bank Transfer'].map(m => ({ method: m, nickname: '', last4: '', label: m }));
const paymentText = (p) => `${p.label}${p.last4 ? ` ••${p.last4}` : ''}${p.nickname && p.method ? ` · ${p.method}` : ''}`;
const LAST_PAYMENT_KEY = 'last_payment_method';

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localStamp = (d = new Date()) => `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const readStorage = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const writeStorage = (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } };

const fmt2 = (n) => `${n < 0 ? '−' : ''}$${Math.abs(Number(n)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function shrinkPhoto(file, maxSide = 1600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82).split(',')[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not open that photo')); };
    img.src = url;
  });
}

export default function AddExpense({ categories = [], expenses = [], onAddExpense }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [paymentMethods, setPaymentMethods] = useState(FALLBACK_PAYMENT_METHODS);
  const [form, setForm] = useState({
    date: location.state?.date || localDate(),
    amount: '',
    category: '',
    merchant: '',
    paymentMethod: readStorage(LAST_PAYMENT_KEY) || '',
    description: ''
  });
  const [isRefund, setIsRefund] = useState(false);
  const [scan, setScan] = useState({ status: 'idle', entries: [], message: '' });
  const fileRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = readStorage('auth_token');
    axios.get(`${API_URL}/api/payment-methods`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(res => {
        if (!Array.isArray(res.data) || !res.data.length) return;
        setPaymentMethods(res.data.map(p => (typeof p === 'string' ? { method: p, nickname: '', last4: '', label: p } : p)));
      })
      .catch(() => {});
  }, []);

  const sortedCategories = useMemo(
    () => [...categories].filter(c => c.name).sort((a, b) => a.name.localeCompare(b.name)),
    [categories]
  );
  const selected = sortedCategories.find(c => c.name === form.category);

  const merchantHistory = useMemo(() => {
    const last = {};
    [...expenses].sort((a, b) => String(a.date).localeCompare(String(b.date))).forEach(e => {
      if (e.merchant) last[e.merchant] = e.category;
    });
    return last;
  }, [expenses]);

  const set = (field) => (e) => {
    const value = e.target.value;
    setForm(prev => {
      const next = { ...prev, [field]: value };
      if (field === 'merchant' && !prev.category && merchantHistory[value]) next.category = merchantHistory[value];
      return next;
    });
  };

  const headers = () => {
    const token = readStorage('auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const onPhoto = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setScan({ status: 'reading', entries: [], message: '' });
    try {
      const image = await shrinkPhoto(file);
      const res = await axios.post(`${API_URL}/api/scan`, { image, mediaType: 'image/jpeg', today: localDate() }, { headers: headers() });
      setEditingIndex(-1);
      if (res.data?.kind === 'proposal') setScan({ status: 'review', entries: res.data.entries, message: res.data.speech });
      else setScan({ status: 'idle', entries: [], message: res.data?.speech || 'Could not read that receipt.' });
    } catch (err) {
      setScan({ status: 'idle', entries: [], message: err.response?.data?.error || err.message || 'Could not read that receipt.' });
    }
  };

  const saveScanned = async () => {
    setScan(prev => ({ ...prev, status: 'saving' }));
    try {
      const transactionId = newTransactionId();
      for (const entry of scan.entries) {
        await axios.post(`${API_URL}/api/expenses`, { ...entry, amount: Number(entry.amount), transactionId, entryMethod: 'Scan', createdAt: localStamp() }, { headers: headers() });
      }
      await onAddExpense();
      const [y, m] = scan.entries[0].date.split('-').map(Number);
      navigate('/', { state: { year: y, month: m - 1 } });
    } catch (err) {
      setScan(prev => ({ ...prev, status: 'review', message: err.response?.data?.error || 'Could not save. Try again.' }));
    }
  };

  const [editingIndex, setEditingIndex] = useState(-1);
  const updateScanned = (index, field, value) => {
    setScan(prev => ({ ...prev, entries: prev.entries.map((en, i) => (i === index ? { ...en, [field]: value } : en)) }));
  };
  const removeScanned = (index) => {
    setEditingIndex(-1);
    setScan(prev => {
      const entries = prev.entries.filter((_, i) => i !== index);
      return { ...prev, entries, status: entries.length ? prev.status : 'idle' };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const entered = Math.abs(parseFloat(form.amount));
    if (!(entered > 0)) return setError('Enter an amount greater than 0.');
    const amount = isRefund ? -entered : entered;
    if (!form.category) return setError('Choose a category.');
    if (!form.paymentMethod) return setError('Choose how you paid.');

    setSaving(true);
    try {
      const token = readStorage('auth_token');
      await axios.post(`${API_URL}/api/expenses`, {
        ...form,
        amount,
        entryMethod: 'Manual',
        createdAt: localStamp()
      }, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      writeStorage(LAST_PAYMENT_KEY, form.paymentMethod);
      await onAddExpense();
      const [y, m] = form.date.split('-').map(Number);
      navigate('/', { state: { year: y, month: m - 1 } });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save. Check your connection and try again.');
      setSaving(false);
    }
  };

  return (
    <div className="ae">
      <div className="ae-top">
        <button className="xv-round" onClick={() => navigate(-1)} aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 6l-6 6 6 6"/></svg>
        </button>
        <span className="ae-title">Add expense</span>
      </div>

      <label className={`ae-scan ${scan.status === 'reading' || scan.status === 'saving' ? 'is-busy' : ''}`}>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPhoto} className="ae-file" disabled={scan.status === 'reading' || scan.status === 'saving'} />
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M8 9h8M8 12h8M8 15h5"/></svg>
        {scan.status === 'reading' ? 'Reading receipt…' : 'Scan a receipt'}
      </label>

      {scan.message && scan.status !== 'review' && scan.status !== 'saving' && <div className="ae-error" role="alert">{scan.message}</div>}

      {(scan.status === 'review' || scan.status === 'saving') && scan.entries.length > 0 && (
        <div className="ae-card ae-scanned">
          <div className="ae-scanned-head">From your receipt</div>
          {scan.message && <div className="yv-muted">{scan.message}</div>}
          {scan.entries.map((entry, i) => {
            const c = sortedCategories.find(x => x.name === entry.category);
            if (editingIndex === i) {
              return (
                <div className="ae-scan-edit" key={i}>
                  <div className="ae-scan-edit-row">
                    <span className="ae-currency-sm">$</span>
                    <input type="number" inputMode="decimal" step="0.01" value={entry.amount}
                      onChange={e => updateScanned(i, 'amount', e.target.value === '' ? '' : Number(e.target.value))} aria-label="Amount" />
                    <select value={entry.category} onChange={e => updateScanned(i, 'category', e.target.value)} aria-label="Category">
                      {sortedCategories.map(x => <option key={x.name} value={x.name}>{x.icon ? `${x.icon}  ` : ''}{x.name}</option>)}
                    </select>
                  </div>
                  <div className="ae-scan-edit-row">
                    <input type="date" value={entry.date} onChange={e => updateScanned(i, 'date', e.target.value)} aria-label="Date" />
                    <input type="text" value={entry.merchant} onChange={e => updateScanned(i, 'merchant', e.target.value)} placeholder="Merchant" aria-label="Merchant" />
                  </div>
                  <div className="ae-scan-edit-row ae-scan-edit-actions">
                    <button type="button" className="ae-edit ae-remove" onClick={() => removeScanned(i)}>Remove</button>
                    <button type="button" className="ae-edit ae-done" onClick={() => setEditingIndex(-1)} disabled={!(Number(entry.amount))}>Done</button>
                  </div>
                </div>
              );
            }
            return (
              <div className="va-entry" key={i}>
                <span className="xv-icon" style={iconStyle(c?.color)}>{c?.icon || '•'}</span>
                <div className="cd-mid">
                  <div className="cd-merchant">{entry.category}</div>
                  <div className="yv-muted">{[entry.merchant, entry.paymentMethod || 'card not shown', entry.date].filter(Boolean).join(' · ')}</div>
                  {entry.description && <div className="yv-muted">{entry.description}</div>}
                </div>
                <div className={`cd-amt ${entry.amount < 0 ? 'va-refund' : ''}`}>{fmt2(entry.amount)}</div>
                <button type="button" className="ae-edit" onClick={() => setEditingIndex(i)}>Edit</button>
              </div>
            );
          })}
          {scan.entries.length > 1 && (
            <div className="ae-scan-total">Total {fmt2(scan.entries.reduce((sum, en) => sum + (Number(en.amount) || 0), 0))}</div>
          )}
          {scan.entries.some(en => !en.paymentMethod) && (
            <label className="ae-field">
              <span className="ae-label">Paid with (the receipt didn't show the card)</span>
              <select value="" onChange={e => { const v = e.target.value; setScan(prev => ({ ...prev, entries: prev.entries.map(en => (en.paymentMethod ? en : { ...en, paymentMethod: v })) })); }}>
                <option value="">Choose a payment method…</option>
                {paymentMethods.map(p => <option key={p.label} value={p.label}>{paymentText(p)}</option>)}
              </select>
            </label>
          )}
          <div className="va-actions">
            <button type="button" className="va-btn ghost" onClick={() => { setEditingIndex(-1); setScan({ status: 'idle', entries: [], message: '' }); }} disabled={scan.status === 'saving'}>Discard</button>
            <button type="button" className="va-btn" onClick={saveScanned} disabled={scan.status === 'saving' || editingIndex !== -1 || scan.entries.some(en => !en.paymentMethod || !Number(en.amount))}>
              {scan.status === 'saving' ? 'Saving…' : scan.entries.length > 1 ? `Save all ${scan.entries.length}` : 'Save'}
            </button>
          </div>
        </div>
      )}

      <form className="ae-card" onSubmit={handleSubmit} noValidate>
        <div className="ae-kind" role="group" aria-label="Expense or refund">
          <button type="button" className={!isRefund ? 'on' : ''} onClick={() => setIsRefund(false)}>Expense</button>
          <button type="button" className={isRefund ? 'on refund' : ''} onClick={() => setIsRefund(true)}>Refund</button>
        </div>

        <label className="ae-amount">
          <span className="ae-label">{isRefund ? 'Refund amount' : 'Amount'}</span>
          <div className="ae-amount-row">
            <span className={`ae-currency ${isRefund ? 'ae-refund' : ''}`}>{isRefund ? '−$' : '$'}</span>
            <input type="number" inputMode="decimal" step="0.01" min="0" placeholder="0.00" value={form.amount} onChange={set('amount')} autoFocus />
          </div>
        </label>

        <label className="ae-field">
          <span className="ae-label">Date</span>
          <input type="date" value={form.date} onChange={set('date')} required />
        </label>

        <label className="ae-field">
          <span className="ae-label">Merchant</span>
          <input type="text" list="ae-merchants" placeholder="e.g. Costco, Shell, Netflix" value={form.merchant} onChange={set('merchant')} />
          <datalist id="ae-merchants">
            {Object.keys(merchantHistory).sort().map(m => <option key={m} value={m} />)}
          </datalist>
        </label>

        <label className="ae-field">
          <span className="ae-label">Category</span>
          <div className="ae-select-wrap">
            {selected && <span className="ae-cat-icon" style={iconStyle(selected.color)}>{selected.icon}</span>}
            <select value={form.category} onChange={set('category')} required className={selected ? 'has-icon' : ''}>
              <option value="">Choose a category…</option>
              {sortedCategories.map(c => <option key={c.name} value={c.name}>{c.icon ? `${c.icon}  ` : ''}{c.name}</option>)}
            </select>
          </div>
          {selected && (
            <span className="ae-type">
              Type: <b>{selected.type || 'Not set in Categories sheet'}</b> · filled in from the Categories sheet
            </span>
          )}
        </label>

        <label className="ae-field">
          <span className="ae-label">Paid with</span>
          <select value={form.paymentMethod} onChange={set('paymentMethod')} required>
            <option value="">Choose a payment method…</option>
            {paymentMethods.map(p => <option key={p.label} value={p.label}>{paymentText(p)}</option>)}
          </select>
        </label>

        <label className="ae-field">
          <span className="ae-label">Note <span className="ae-optional">(optional)</span></span>
          <textarea rows="2" placeholder="Anything to remember" value={form.description} onChange={set('description')} />
        </label>

        {error && <div className="ae-error" role="alert">{error}</div>}

        <button type="submit" className="ae-save" disabled={saving}>
          {saving ? 'Saving…' : isRefund ? 'Save refund' : 'Save expense'}
        </button>
      </form>
    </div>
  );
}
