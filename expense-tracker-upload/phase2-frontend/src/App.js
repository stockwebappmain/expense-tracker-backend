import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import AddExpense from './pages/AddExpense';
import DailyView from './pages/DailyView';
import YearlyView from './pages/YearlyView';
import Settings from './pages/Settings';
import ExpensesView from './pages/ExpensesView';
import CategoryDetail from './pages/CategoryDetail';
import BottomNav from './components/BottomNav';
import VoiceAssistant from './components/VoiceAssistant';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const pad = (n) => String(n).padStart(2, '0');
const normalizeDate = (raw) => {
  if (raw == null || raw === '') return '';
  const str = String(raw).trim();
  let m = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${pad(m[1])}-${pad(m[2])}`;
  }
  if (/^\d+(\.\d+)?$/.test(str)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(str)) * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const d = new Date(str);
  return isNaN(d) ? str : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expenses, setExpenses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [budget, setBudget] = useState(null);
  const [budgets, setBudgets] = useState([]);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    checkAuth();
  }, []);

  const authHeaders = () => {
    const token = localStorage.getItem('auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const checkAuth = async () => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlToken = params.get('auth_token');
      if (urlToken) {
        localStorage.setItem('auth_token', urlToken);
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      if (!localStorage.getItem('auth_token')) {
        setUser(null);
        return;
      }

      const response = await axios.get(`${API_URL}/api/auth/user`, { headers: authHeaders() });
      setUser(response.data);
      loadData();
    } catch (error) {
      localStorage.removeItem('auth_token');
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const loadData = async () => {
    const headers = authHeaders();
    const [expensesRes, categoriesRes, budgetRes, budgetsRes] = await Promise.allSettled([
      axios.get(`${API_URL}/api/expenses`, { headers }),
      axios.get(`${API_URL}/api/categories`, { headers }),
      axios.get(`${API_URL}/api/budget`, { headers }),
      axios.get(`${API_URL}/api/budgets`, { headers })
    ]);
    const failed = [expensesRes, categoriesRes].find(r => r.status === 'rejected');
    if (failed) {
      const status = failed.reason?.response?.status;
      const detail = failed.reason?.response?.data?.error || '';
      setLoadError(status === 403 || /permission/i.test(detail)
        ? "Your Google account can't open the expense spreadsheet yet. Ask the owner to share it with you as an Editor, then try again."
        : status === 401
          ? 'Your sign-in has expired. Sign out from Profile and sign in again.'
          : `Couldn't load your expenses${detail ? `: ${detail}` : ''}. Check your connection and try again.`);
    } else {
      setLoadError('');
    }
    if (expensesRes.status === 'fulfilled') setExpenses((expensesRes.value.data || []).map(e => ({ ...e, date: normalizeDate(e.date), amount: Number(String(e.amount).replace(/[$,]/g, '')) || 0 })));
    else console.error('Expenses failed:', expensesRes.reason);
    if (categoriesRes.status === 'fulfilled') setCategories(categoriesRes.value.data || []);
    else console.error('Categories failed:', categoriesRes.reason);
    if (budgetRes.status === 'fulfilled') setBudget(budgetRes.value.data);
    else console.error('Budget failed:', budgetRes.reason);
    if (budgetsRes.status === 'fulfilled' && Array.isArray(budgetsRes.value.data)) setBudgets(budgetsRes.value.data);
  };

  const NON_SPEND_TYPES = ['savings', 'transfer'];
  const nonSpend = new Set(categories.filter(c => NON_SPEND_TYPES.includes(String(c.type || '').trim().toLowerCase())).map(c => c.name));
  const spending = expenses.filter(e => !nonSpend.has(e.category));
  const spendCategories = categories.filter(c => !nonSpend.has(c.name));

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <Router>
      <Routes>
        {!user ? (
          <Route path="*" element={<Login onLoginSuccess={checkAuth} />} />
        ) : (
          <>
            <Route path="/" element={<Dashboard expenses={spending} categories={spendCategories} budget={budget} budgets={budgets} onAddExpense={loadData} onOpenAssistant={() => setAssistantOpen(true)} loadError={loadError} onRetry={loadData} />} />
            <Route path="/add" element={<AddExpense categories={categories} expenses={expenses} onAddExpense={loadData} />} />
            <Route path="/daily" element={<DailyView expenses={spending} categories={spendCategories} />} />
            <Route path="/yearly" element={<YearlyView expenses={spending} categories={spendCategories} budget={budget} />} />
            <Route path="/expenses" element={<ExpensesView expenses={spending} categories={spendCategories} />} />
            <Route path="/category" element={<CategoryDetail expenses={spending} categories={spendCategories} />} />
            <Route path="/settings" element={<Settings user={user} />} />
            <Route path="*" element={<Navigate to="/" />} />
          </>
        )}
      </Routes>
      {user && <BottomNav />}
      {user && <VoiceAssistant open={assistantOpen} onClose={() => setAssistantOpen(false)} categories={categories} onSaved={loadData} />}
    </Router>
  );
}

export default App;
