// Expense Tracker Backend - Node.js for Google Cloud Run
// Deploy to: Google Cloud Run

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { google } = require('googleapis');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const jwt = require('jsonwebtoken');

// Load .env file only in development (not in production/Cloud Run)
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const app = express();

// Middleware
const FRONTEND_URLS = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',').map(u => u.trim().replace(/\/$/, '')).filter(Boolean);
const pickFrontend = (candidate) => (FRONTEND_URLS.includes(candidate) ? candidate : FRONTEND_URLS[0]);

app.use(cors({
  origin: FRONTEND_URLS,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: true
}));

// Passport Configuration
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback'
}, (accessToken, refreshToken, profile, done) => {
  const user = {
    id: profile.id,
    name: profile.displayName,
    email: profile.emails[0].value,
    accessToken: accessToken,
    refreshToken: refreshToken
  };
  return done(null, user);
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

app.use(passport.initialize());
app.use(passport.session());

// Google Sheets Setup
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const sheetsClient = google.sheets('v4');

// Authentication Routes
app.get('/auth/google', (req, res, next) => passport.authenticate('google', {
  scope: ['profile', 'email', 'https://www.googleapis.com/auth/spreadsheets'],
  accessType: 'offline',
  prompt: 'consent',
  state: pickFrontend(req.query.from)
})(req, res, next));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    // Generate JWT token
    const token = jwt.sign(
      {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        accessToken: req.user.accessToken,
        refreshToken: req.user.refreshToken
      },
      process.env.JWT_SECRET || 'your-jwt-secret-key',
      { expiresIn: '7d' }
    );

    // Redirect with token in URL for localStorage storage
    res.redirect(`${pickFrontend(req.query.state)}?auth_token=${token}`);
  }
);

app.get('/api/auth/user', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-jwt-secret-key');
    res.json({
      id: decoded.id,
      email: decoded.email,
      name: decoded.name,
      accessToken: decoded.accessToken
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.get('/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.redirect(FRONTEND_URLS[0]);
});

// Middleware to check authentication
const authenticateUser = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'your-jwt-secret-key');
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const toNum = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
};

// Google Sheets API Helper
async function getSheetData(auth, range) {
  try {
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: range,
      auth: auth
    });
    return response.data.values || [];
  } catch (error) {
    console.error('Error reading sheet:', error);
    throw error;
  }
}

async function appendToSheet(auth, range, values) {
  try {
    const response = await sheetsClient.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: range,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [values] },
      auth: auth
    });
    return response.data;
  } catch (error) {
    console.error('Error appending to sheet:', error);
    throw error;
  }
}

// API Routes

// Get all expenses
app.get('/api/expenses', authenticateUser, async (req, res) => {
  try {
    const auth = google.auth.fromJSON({
      type: 'authorized_user',
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: req.user.refreshToken
    });

    const data = await getSheetData(auth, 'Expenses!A2:J');

    const expenses = data.filter(row => row[0]).map(row => ({
      date: row[0],
      createdAt: row[1],
      time: row[1],
      amount: toNum(row[2]),
      category: row[3],
      paymentMethod: row[4],
      merchant: row[5],
      description: row[6],
      type: row[7],
      entryMethod: row[8] || '',
      enteredBy: row[9] || ''
    }));

    res.json(expenses);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add new expense
app.post('/api/expenses', authenticateUser, async (req, res) => {
  try {
    const { date, amount, category, merchant, paymentMethod, description, entryMethod, createdAt } = req.body;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return res.status(400).json({ error: 'Date must be YYYY-MM-DD' });
    const amountNum = toNum(amount);
    if (!amountNum) return res.status(400).json({ error: 'Amount cannot be 0' });
    if (!category) return res.status(400).json({ error: 'Category is required' });
    const ENTRY_METHODS = ['Manual', 'Voice', 'Text', 'Email', 'Scan'];
    const method = ENTRY_METHODS.includes(entryMethod) ? entryMethod : 'Manual';
    const stamp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(createdAt || ''))
      ? createdAt
      : new Date().toISOString().replace('T', ' ').slice(0, 19);

    const auth = google.auth.fromJSON({
      type: 'authorized_user',
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: req.user.refreshToken
    });

    const categoryRows = await getSheetData(auth, 'Categories!A2:E');
    const match = categoryRows.find(row => String(row[0] || '').trim().toLowerCase() === String(category).trim().toLowerCase());
    if (!match) return res.status(400).json({ error: `Unknown category: ${category}` });
    const type = match[4] || '';

    await appendToSheet(auth, 'Expenses!A:J', [
      date, stamp, amountNum, match[0], paymentMethod || '', merchant || '', description || '', type, method, req.user.email || ''
    ]);

    res.json({ success: true, type, entryMethod: method });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Parse voice input with Claude API
app.post('/api/voice/parse', authenticateUser, async (req, res) => {
  try {
    const { transcript } = req.body;

    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Parse this expense voice input and extract details. Respond ONLY with JSON:
{
  "action": "add" | "query" | "show",
  "amount": number,
  "category": string,
  "merchant": string,
  "timeframe": string
}
Voice: "${transcript}"`
      }]
    }, {
      headers: {
        'x-api-key': process.env.CLAUDE_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    const parsed = JSON.parse(response.data.content[0].text);
    res.json(parsed);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get categories
app.get('/api/categories', authenticateUser, async (req, res) => {
  try {
    const auth = google.auth.fromJSON({
      type: 'authorized_user',
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: req.user.refreshToken
    });

    const data = await getSheetData(auth, 'Categories!A2:E');

    const categories = data.map(row => ({
      name: row[0],
      icon: row[1],
      color: row[2],
      budget: toNum(row[3]),
      type: row[4]
    }));

    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get budget
app.get('/api/budget', authenticateUser, async (req, res) => {
  try {
    const auth = google.auth.fromJSON({
      type: 'authorized_user',
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: req.user.refreshToken
    });

    const data = await getSheetData(auth, 'Budget!A2:F');
    const today = new Date();
    const month = today.toLocaleString('en-US', { month: 'long' });
    const year = today.getFullYear();

    const budget = data.find(row => row[0] === month && String(row[1]) === String(year));

    if (budget) {
      res.json({
        month: budget[0],
        year: budget[1],
        totalBudget: toNum(budget[2]),
        fixedBudget: toNum(budget[3]),
        variableBudget: toNum(budget[4])
      });
    } else {
      res.json(null);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get payment methods
app.get('/api/payment-methods', authenticateUser, async (req, res) => {
  try {
    const auth = google.auth.fromJSON({
      type: 'authorized_user',
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: req.user.refreshToken
    });
    const data = await getSheetData(auth, 'PaymentMethods!A2:A');
    res.json(data.map(row => String(row[0] || '').trim()).filter(Boolean));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get every month's budget row
app.get('/api/budgets', authenticateUser, async (req, res) => {
  try {
    const auth = google.auth.fromJSON({
      type: 'authorized_user',
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: req.user.refreshToken
    });
    const data = await getSheetData(auth, 'Budget!A2:F');
    res.json(data.filter(row => row[0]).map(row => ({
      month: row[0],
      year: String(row[1]),
      totalBudget: toNum(row[2]),
      fixedBudget: toNum(row[3]),
      variableBudget: toNum(row[4])
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
