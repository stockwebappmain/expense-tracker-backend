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
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
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
app.get('/auth/google', passport.authenticate('google', {
  scope: ['profile', 'email', 'https://www.googleapis.com/auth/spreadsheets']
}));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    // Generate JWT token
    const token = jwt.sign(
      {
        id: req.user.id,
        email: req.user.email,
        accessToken: req.user.accessToken
      },
      process.env.JWT_SECRET || 'your-jwt-secret-key',
      { expiresIn: '7d' }
    );

    // Send token as HttpOnly secure cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.redirect(process.env.FRONTEND_URL || 'http://localhost:3000');
  }
);

app.get('/api/auth/user', (req, res) => {
  const token = req.cookies.auth_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-jwt-secret-key');
    res.json({
      id: decoded.id,
      email: decoded.email,
      accessToken: decoded.accessToken
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.get('/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.redirect(process.env.FRONTEND_URL || 'http://localhost:3000');
});

// Middleware to check authentication
const authenticateUser = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
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

    const data = await getSheetData(auth, 'Expenses!A2:H');

    const expenses = data.map(row => ({
      date: row[0],
      time: row[1],
      amount: parseFloat(row[2]),
      category: row[3],
      paymentMethod: row[4],
      merchant: row[5],
      description: row[6],
      type: row[7]
    }));

    res.json(expenses);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add new expense
app.post('/api/expenses', authenticateUser, async (req, res) => {
  try {
    const { date, amount, category, merchant, paymentMethod, type, description } = req.body;
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });

    const auth = google.auth.fromJSON({
      type: 'authorized_user',
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: req.user.refreshToken
    });

    await appendToSheet(auth, 'Expenses!A:H', [
      date, time, amount, category, paymentMethod, merchant, description, type
    ]);

    res.json({ success: true, message: 'Expense added successfully' });
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

    const data = await getSheetData(auth, 'Categories!A2:D');

    const categories = data.map(row => ({
      name: row[0],
      icon: row[1],
      color: row[2],
      budget: parseFloat(row[3])
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

    const budget = data.find(row => row[0] === month && row[1] === year);

    if (budget) {
      res.json({
        month: budget[0],
        year: budget[1],
        totalBudget: parseFloat(budget[2]),
        fixedBudget: parseFloat(budget[3]),
        variableBudget: parseFloat(budget[4])
      });
    } else {
      res.json(null);
    }
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
