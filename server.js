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
const Anthropic = require('@anthropic-ai/sdk');

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
app.use(express.json({ limit: '8mb' }));
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

    const data = await getSheetData(auth, 'Expenses!A2:K');

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
      enteredBy: row[9] || '',
      transactionId: row[10] || ''
    }));

    res.json(expenses);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add new expense
app.post('/api/expenses', authenticateUser, async (req, res) => {
  try {
    const { date, amount, category, merchant, paymentMethod, description, entryMethod, createdAt, transactionId } = req.body;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return res.status(400).json({ error: 'Date must be YYYY-MM-DD' });
    const amountNum = toNum(amount);
    if (!amountNum) return res.status(400).json({ error: 'Amount cannot be 0' });
    if (!category) return res.status(400).json({ error: 'Category is required' });
    if (!String(paymentMethod || '').trim()) return res.status(400).json({ error: 'Payment method is required' });
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

    const txId = /^T-[A-Za-z0-9-]{4,40}$/.test(String(transactionId || ''))
      ? transactionId
      : `T-${stamp.replace(/\D/g, '').slice(0, 12)}-${Math.random().toString(36).slice(2, 6)}`;

    await appendToSheet(auth, 'Expenses!A:K', [
      date, stamp, amountNum, match[0], String(paymentMethod).trim(), merchant || '', description || '', type, method, req.user.email || '', txId
    ]);

    res.json({ success: true, type, entryMethod: method, transactionId: txId });
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

// Payment methods: column A type, B nickname, C last 4 digits, D account type
async function loadPaymentMethods(auth) {
  const rows = await getSheetData(auth, 'PaymentMethods!A2:D').catch(() => []);
  return rows
    .map(r => {
      const method = String(r[0] || '').trim();
      const nickname = String(r[1] || '').trim();
      const last4 = String(r[2] || '').replace(/\D/g, '').slice(-4);
      return { method, nickname, last4, accountType: String(r[3] || '').trim(), label: nickname || method };
    })
    .filter(p => p.label);
}

const describePayment = (p) => `${p.label} (${[p.method !== p.label ? p.method : '', p.last4 ? `ends in ${p.last4}` : ''].filter(Boolean).join(', ') || 'no details'})`;

function matchPayment(value, methods) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return '';
  const exact = methods.find(p => p.label.toLowerCase() === v || p.nickname.toLowerCase() === v);
  if (exact) return exact.label;
  const digits = v.replace(/\D/g, '').slice(-4);
  if (digits.length === 4) {
    const byLast4 = methods.find(p => p.last4 === digits);
    if (byLast4) return byLast4.label;
  }
  const byNamePart = methods.find(p => p.nickname && (v.includes(p.nickname.toLowerCase()) || p.nickname.toLowerCase().includes(v)));
  if (byNamePart) return byNamePart.label;
  const byType = methods.filter(p => p.method.toLowerCase() === v);
  return byType.length === 1 ? byType[0].label : '';
}

// ---------- Expense assistant (voice / text) ----------
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY });
const ASSISTANT_MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';
const NON_SPEND_TYPES = ['savings', 'transfer'];

const ASSISTANT_TOOLS = [
  {
    name: 'propose_expenses',
    description: 'Propose one or more expense or refund entries parsed from what the user said, for the user to confirm before anything is saved. Use this whenever the user is recording spending or a refund. Never call it for questions.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['entries', 'spoken_confirmation'],
      properties: {
        entries: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['date', 'amount', 'category', 'merchant', 'paymentMethod', 'description'],
            properties: {
              date: { type: 'string', description: 'Transaction date, YYYY-MM-DD. Resolve words like "yesterday" against today\'s date.' },
              amount: { type: 'number', description: 'Positive for spending, negative for a refund or return.' },
              category: { type: 'string', description: 'Exactly one of the listed category names.' },
              merchant: { type: 'string', description: 'Store or payee, or empty string if not said.' },
              paymentMethod: { type: 'string', description: 'Exactly one of the listed payment methods, or empty string if not said.' },
              description: { type: 'string', description: 'Short note, or empty string.' }
            }
          }
        },
        spoken_confirmation: { type: 'string', description: 'One or two short sentences to read aloud, stating each amount, merchant, category, date and payment method, ending with a question asking whether to save.' }
      }
    }
  },
  {
    name: 'query_expenses',
    description: 'Look up the user\'s recorded expenses to answer a question about their spending. Returns totals, a per-category breakdown and the matching items.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['start_date', 'end_date', 'category', 'merchant', 'payment_method', 'include_savings_and_transfers'],
      properties: {
        start_date: { type: 'string', description: 'Inclusive, YYYY-MM-DD.' },
        end_date: { type: 'string', description: 'Inclusive, YYYY-MM-DD.' },
        category: { type: 'string', description: 'Exact category name to filter by, or empty string for all.' },
        merchant: { type: 'string', description: 'Merchant text to match (case-insensitive, partial), or empty string.' },
        payment_method: { type: 'string', description: 'Payment method to filter by, or empty string.' },
        include_savings_and_transfers: { type: 'boolean', description: 'True only if the user asks about savings, investments or card payments.' }
      }
    }
  }
];

const pad2 = (n) => String(n).padStart(2, '0');
function normalizeSheetDate(raw) {
  const str = String(raw || '').trim();
  let m = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad2(m[1])}-${pad2(m[2])}`;
  const d = new Date(str);
  return isNaN(d) ? str : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function closestCategory(value, names) {
  const v = String(value || '').trim().toLowerCase();
  const exact = names.find(n => n.toLowerCase() === v);
  if (exact) return exact;
  const stem = (t) => t.toLowerCase().replace(/ies\b/g, 'y').replace(/s\b/g, '').trim();
  const sv = stem(v);
  const partial = v && names.find(n => { const sn = stem(n); return sn === sv || sn.includes(sv) || sv.includes(sn); });
  if (partial) return partial;
  return names.find(n => /^misc/i.test(n)) || names.find(n => /^other$/i.test(n)) || names[0] || 'Miscellaneous';
}

const RECEIPT_TOOL = {
  name: 'read_receipt',
  description: 'Record exactly what is printed on a receipt photo.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['merchant', 'date', 'card_text', 'card_last4', 'items', 'subtotal', 'tax', 'total'],
    properties: {
      merchant: { type: 'string', description: 'Store name as printed.' },
      date: { type: 'string', description: 'Receipt date as YYYY-MM-DD, or empty string if not printed.' },
      card_text: { type: 'string', description: 'The card or tender line exactly as printed (for example "CAPITAL ONE- 1317" or "VISA ****1234"), or empty string.' },
      card_last4: { type: 'string', description: 'The last 4 digits of the card used to pay, as printed on the payment/approval line, or empty string. Do not guess.' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'amount', 'category', 'taxable', 'split_category', 'split_percent'],
          properties: {
            name: { type: 'string' },
            taxable: { type: 'boolean', description: 'True if the receipt marks this line as taxed (for example a T flag next to the price). False for lines marked as untaxed (N, 0, F or blank) when the receipt uses such flags.' },
            split_category: { type: 'string', description: 'If a handwritten or printed note says to put part of this item on another category (for example "put 50% on Tree\'s expense" with a bracket covering it), that category name; otherwise empty string.' },
            split_percent: { type: 'number', description: 'Percent of this item that goes to split_category (for example 50), or 0.' },
            amount: { type: 'number', description: 'The line total for this item, counted once (if a quantity and unit price are printed, use the line total, not both).' },
            category: { type: 'string', description: 'Exactly one listed category name.' }
          }
        }
      },
      subtotal: { type: 'number', description: 'Subtotal printed before tax, or 0 if not printed.' },
      tax: { type: 'number', description: 'Total tax printed, or 0.' },
      total: { type: 'number', description: 'Grand total printed (amount charged), or 0 if not visible.' }
    }
  }
};

function runExpenseQuery(rows, categoryRows, q) {
  const nonSpend = new Set(categoryRows
    .filter(r => NON_SPEND_TYPES.includes(String(r[4] || '').trim().toLowerCase()))
    .map(r => String(r[0] || '').trim()));
  const merchantNeedle = String(q.merchant || '').trim().toLowerCase();
  const items = rows
    .filter(r => r[0])
    .map(r => ({ date: normalizeSheetDate(r[0]), amount: toNum(r[2]), category: r[3] || '', paymentMethod: r[4] || '', merchant: r[5] || '' }))
    .filter(e => e.date >= q.start_date && e.date <= q.end_date)
    .filter(e => q.include_savings_and_transfers || !nonSpend.has(e.category))
    .filter(e => !q.category || e.category.toLowerCase() === q.category.toLowerCase())
    .filter(e => !merchantNeedle || e.merchant.toLowerCase().includes(merchantNeedle))
    .filter(e => !q.payment_method || e.paymentMethod.toLowerCase() === q.payment_method.toLowerCase());
  const byCategory = {};
  items.forEach(e => { byCategory[e.category] = Math.round(((byCategory[e.category] || 0) + e.amount) * 100) / 100; });
  return {
    total: Math.round(items.reduce((s, e) => s + e.amount, 0) * 100) / 100,
    count: items.length,
    by_category: byCategory,
    items: items.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 25)
  };
}

app.post('/api/assistant', authenticateUser, async (req, res) => {
  try {
    const transcript = String(req.body.transcript || '').trim().slice(0, 1000);
    const today = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.today || '')) ? req.body.today : new Date().toISOString().slice(0, 10);
    const context = Array.isArray(req.body.context) ? req.body.context.slice(-6) : [];
    if (!transcript) return res.status(400).json({ error: 'Nothing was heard' });

    const auth = google.auth.fromJSON({
      type: 'authorized_user',
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: req.user.refreshToken
    });
    const [categoryRows, paymentMethods, expenseRows] = await Promise.all([
      getSheetData(auth, 'Categories!A2:E'),
      loadPaymentMethods(auth),
      getSheetData(auth, 'Expenses!A2:J')
    ]);
    const categoryNames = categoryRows.map(r => String(r[0] || '').trim()).filter(Boolean);
    const merchants = [...new Set(expenseRows.map(r => String(r[5] || '').trim()).filter(Boolean))].slice(-80);

    const system = [
      'You are the assistant inside a personal expense tracker app. You only help with recording expenses and refunds and answering questions about the user\'s recorded expenses. For anything else, reply with one short sentence saying you can only help with expenses.',
      'When the user describes spending or a refund, call propose_expenses. One receipt or sentence can contain several entries in different categories; propose each separately. Pick the closest listed category; never invent a category.',
      'A payment method is required for every entry. Match what the user says to one listed payment method by its name, its card type or its last 4 digits, and use that name exactly. If the user did not say how they paid, or it matches more than one, do not call any tool; ask one short question naming the options.',
      'If the amount is missing, do not call any tool; ask one short question for it.',
      'When the user asks about their spending, call query_expenses with an explicit date range, then answer in one or two short spoken sentences with dollar amounts. Your replies are read aloud: no markdown, no lists, no emoji.',
      'Earlier turns of this conversation may be included as context. If the user is correcting a previous proposal, propose the corrected entries again in full.'
    ].join('\n');

    const contextText = context.map(t => `${t.role === 'assistant' ? 'Assistant' : 'User'}: ${String(t.text || '').slice(0, 600)}`).join('\n');
    const userText = [
      `Today is ${today}.`,
      `Categories: ${categoryNames.join(', ')}.`,
      `Payment methods (use the name before the brackets): ${paymentMethods.map(describePayment).join('; ') || 'not set'}.`,
      `Known merchants: ${merchants.join(', ') || 'none yet'}.`,
      contextText ? `Conversation so far:\n${contextText}` : '',
      `User said: "${transcript}"`
    ].filter(Boolean).join('\n\n');

    const messages = [{ role: 'user', content: userText }];
    for (let turn = 0; turn < 4; turn++) {
      const response = await anthropic.messages.create({
        model: ASSISTANT_MODEL,
        max_tokens: 4000,
        output_config: { effort: 'low' },
        system,
        tools: ASSISTANT_TOOLS,
        messages
      });

      if (response.stop_reason === 'refusal') {
        return res.json({ kind: 'answer', speech: 'Sorry, I can only help with your expenses.' });
      }

      const toolUses = response.content.filter(b => b.type === 'tool_use');
      const proposal = toolUses.find(b => b.name === 'propose_expenses');
      if (proposal) {
        const entries = (proposal.input.entries || [])
          .map(e => ({
            ...e,
            category: categoryNames.find(n => n.toLowerCase() === String(e.category).toLowerCase()) || e.category,
            paymentMethod: matchPayment(e.paymentMethod, paymentMethods)
          }))
          .filter(e => e.amount && /^\d{4}-\d{2}-\d{2}$/.test(e.date));
        if (!entries.length) return res.json({ kind: 'clarify', speech: 'Sorry, I didn\'t catch the amount. How much was it?' });
        if (entries.some(e => !e.paymentMethod)) {
          return res.json({ kind: 'clarify', speech: `Which card or account did you use? ${paymentMethods.map(p => p.label).join(', ')}.` });
        }
        return res.json({ kind: 'proposal', entries, speech: proposal.input.spoken_confirmation });
      }

      const queries = toolUses.filter(b => b.name === 'query_expenses');
      if (!queries.length) {
        const text = response.content.filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
        return res.json({ kind: 'answer', speech: text || 'Sorry, I didn\'t catch that.' });
      }

      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content: queries.map(q => ({
          type: 'tool_result',
          tool_use_id: q.id,
          content: JSON.stringify(runExpenseQuery(expenseRows, categoryRows, q.input))
        }))
      });
    }
    res.json({ kind: 'answer', speech: 'Sorry, that took too long. Please try asking a simpler question.' });
  } catch (error) {
    console.error('Assistant error:', error);
    const status = error instanceof Anthropic.AuthenticationError ? 503 : 500;
    res.status(status).json({ error: status === 503 ? 'Assistant is not configured (Claude API key missing or invalid)' : error.message });
  }
});

// Receipt scan: photo -> proposed entries split by category
app.post('/api/scan', authenticateUser, async (req, res) => {
  try {
    const image = String(req.body.image || '');
    const mediaType = ['image/jpeg', 'image/png', 'image/webp'].includes(req.body.mediaType) ? req.body.mediaType : 'image/jpeg';
    const today = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.today || '')) ? req.body.today : new Date().toISOString().slice(0, 10);
    if (!image || !/^[A-Za-z0-9+/=]+$/.test(image)) return res.status(400).json({ error: 'No photo received' });
    if (image.length > 7_000_000) return res.status(413).json({ error: 'Photo is too large' });

    const auth = google.auth.fromJSON({
      type: 'authorized_user',
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: req.user.refreshToken
    });
    const [categoryRows, paymentMethods] = await Promise.all([
      getSheetData(auth, 'Categories!A2:E'),
      loadPaymentMethods(auth)
    ]);
    const categoryNames = categoryRows.map(r => String(r[0] || '').trim()).filter(Boolean);

    const response = await anthropic.messages.create({
      model: ASSISTANT_MODEL,
      max_tokens: 6000,
      output_config: { effort: 'medium' },
      system: 'You transcribe receipt photos for a personal expense tracker. Call read_receipt with every purchased item exactly once: its name and its line total (after any per-item discount, negative for returns or coupons). Items are only the things bought; never put subtotal, tax, total, balance, amount paid, card payment, cash, change or savings summary lines in items, they go in their own fields or are left out. If a quantity and unit price are printed, use only the line total. An instant-savings or coupon line right under an item is its own item with a negative amount. Copy numbers carefully; do not calculate or estimate. Read the tax flag printed beside each price to set taxable. If someone has written instructions on the receipt (for example "put 50% on Tree\'s expense" with a bracket or arrow marking some items), apply them to exactly the marked items using split_category and split_percent, matching the closest listed category (for example "Tree - Personal Expenses"). Give each item the closest listed category; never invent a category. Also copy the printed tax and the printed grand total. If the image is not a receipt or cannot be read, do not call the tool; reply with one short sentence saying so.',
      tools: [RECEIPT_TOOL],
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: `Today is ${today}.\nCategories: ${categoryNames.join(', ')}.\nPayment methods (use the name before the brackets): ${paymentMethods.map(describePayment).join('; ') || 'not set'}.` }
        ]
      }]
    });

    if (response.stop_reason === 'refusal') return res.json({ kind: 'answer', speech: 'Sorry, I couldn\'t read that photo.' });
    const call = response.content.find(b => b.type === 'tool_use' && b.name === 'read_receipt');
    if (!call) {
      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
      return res.json({ kind: 'answer', speech: text || 'Sorry, I couldn\'t read that receipt. Try a clearer, closer photo.' });
    }
    const r = call.input;
    const cents = (n) => Math.round(Number(n || 0) * 100);
    let items = (r.items || [])
      .map(it => ({
        name: String(it.name || '').trim(),
        cents: cents(it.amount),
        category: closestCategory(it.category, categoryNames),
        taxable: !!it.taxable,
        splitCategory: it.split_category && Number(it.split_percent) > 0 ? closestCategory(it.split_category, categoryNames) : '',
        splitPercent: Math.min(100, Math.max(0, Number(it.split_percent) || 0))
      }))
      .filter(it => it.cents !== 0)
      .filter(it => !/^(sub ?total|total|grand total|tax|sales tax|balance|amount due|amount paid|change|cash|visa|mastercard|amex|debit|credit|payment|you saved)\b/i.test(it.name));
    if (!items.length) return res.json({ kind: 'answer', speech: 'Sorry, I couldn\'t find any items on that receipt.' });

    const totalCents = cents(r.total);
    const subtotalCents = cents(r.subtotal);
    const sumOf = (list) => list.reduce((sum, it) => sum + it.cents, 0);
    // If the items add up to about twice the receipt, a repeated list was read; keep one copy.
    const reference = subtotalCents || totalCents;
    if (reference && sumOf(items) > reference * 1.6) {
      const half = items.slice(0, Math.ceil(items.length / 2));
      if (Math.abs(sumOf(half) - reference) <= Math.abs(sumOf(items) - reference)) items = half;
    }

    // Apply handwritten splits ("put 50% on Tree's expense") line by line.
    const lines = [];
    items.forEach(it => {
      if (it.splitCategory && it.splitCategory !== it.category) {
        const moved = Math.round(it.cents * it.splitPercent / 100);
        if (moved) lines.push({ ...it, cents: moved, category: it.splitCategory, name: `${it.name} (${it.splitPercent}%)` });
        if (it.cents - moved) lines.push({ ...it, cents: it.cents - moved });
      } else {
        lines.push(it);
      }
    });

    // Tax goes only on lines marked taxable; if none are marked, spread it over everything.
    const itemsCents = sumOf(lines);
    const taxCents = cents(r.tax) || (totalCents && subtotalCents ? totalCents - subtotalCents : 0);
    const taxed = lines.some(l => l.taxable) ? lines.filter(l => l.taxable) : lines;
    const taxBase = sumOf(taxed) || 1;
    let taxLeft = taxCents;
    taxed.forEach((l, i) => {
      const share = i === taxed.length - 1 ? taxLeft : Math.round(taxCents * (l.cents / taxBase));
      l.cents += share;
      taxLeft -= share;
    });
    // Any leftover difference from the printed total (fees, rounding) goes to the largest line.
    const diff = totalCents ? totalCents - (itemsCents + taxCents) : 0;
    if (diff && Math.abs(diff) <= Math.max(100, Math.round(totalCents * 0.05))) {
      lines.reduce((a, b) => (Math.abs(b.cents) > Math.abs(a.cents) ? b : a)).cents += diff;
    }

    const groups = {};
    lines.forEach(l => {
      groups[l.category] = groups[l.category] || { cents: 0, names: [] };
      groups[l.category].cents += l.cents;
      groups[l.category].names.push(l.name);
    });
    const cats = Object.keys(groups);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || '')) ? r.date : today;
    const last4 = String(r.card_last4 || '').replace(/\D/g, '').slice(-4);
    const paymentMethod = (last4.length === 4 && matchPayment(last4, paymentMethods)) || matchPayment(r.card_text, paymentMethods);
    const entries = cats.map(c => ({
      date,
      amount: groups[c].cents / 100,
      category: c,
      merchant: String(r.merchant || '').trim(),
      paymentMethod,
      description: groups[c].names.slice(0, 4).join(', ') + (groups[c].names.length > 4 ? ` +${groups[c].names.length - 4} more` : '')
    }));
    const finalCents = entries.reduce((sum, e) => sum + cents(e.amount), 0);
    const note = totalCents && finalCents === totalCents
      ? `Split into ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}, adding up to the receipt total of $${(totalCents / 100).toFixed(2)}.`
      : `I couldn't read the receipt total, so please check the amounts.`;
    res.json({ kind: 'proposal', entries, speech: note });
  } catch (error) {
    console.error('Scan error:', error);
    const status = error instanceof Anthropic.AuthenticationError ? 503 : 500;
    res.status(status).json({ error: status === 503 ? 'Scanner is not configured (Claude API key missing or invalid)' : error.message });
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
    res.json(await loadPaymentMethods(auth));
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
