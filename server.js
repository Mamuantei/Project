// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const stripePkg = require('stripe');

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_this';
const SITE_URL = process.env.SITE_URL || `http://localhost:${PORT}`;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PUB_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';
const stripe = stripePkg(STRIPE_SECRET_KEY || '');

// ensure uploads folder exists
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\.\-]/g, '');
    cb(null, `${ts}_${safe}`);
  }
});
const upload = multer({ storage });

// allow file serving
app.use('/uploads', express.static(UPLOADS_DIR, { index: false }));

// CORS - in production set origin properly
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve frontend static files (the SPA)
app.use(express.static(path.join(__dirname, 'public')));

// open/create DB
const db = new Database(path.join(__dirname, 'taskearn.db'));

// create tables if not exist
db.prepare(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT,
  password_hash TEXT,
  balance REAL DEFAULT 0,
  is_admin INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  reward REAL DEFAULT 0,
  tags TEXT,
  created_by INTEGER,
  status TEXT DEFAULT 'open',
  assigned_to INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  files TEXT,
  message TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'pending',
  admin_note TEXT
);
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS withdraws (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  status TEXT DEFAULT 'requested',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT
);
`).run();

// helper queries
const createUserStmt = db.prepare(`INSERT INTO users (username, email, password_hash, is_admin, balance) VALUES (@username, @email, @password_hash, @is_admin, @balance)`);
const findUserByUsername = db.prepare(`SELECT id,username,email,balance,is_admin,password_hash,created_at FROM users WHERE username = ?`);
const findUserById = db.prepare(`SELECT id,username,email,balance,is_admin,created_at FROM users WHERE id = ?`);
const updateUserBalance = db.prepare(`UPDATE users SET balance = ? WHERE id = ?`);
const getTasksStmt = db.prepare(`SELECT * FROM tasks ORDER BY status ASC, created_at DESC`);
const getTaskById = db.prepare(`SELECT * FROM tasks WHERE id = ?`);
const insertTaskStmt = db.prepare(`INSERT INTO tasks (title,description,reward,tags,created_by,status) VALUES (@title,@description,@reward,@tags,@created_by,@status)`);
const updateTaskStmt = db.prepare(`UPDATE tasks SET title=@title, description=@description, reward=@reward, tags=@tags, status=@status WHERE id=@id`);
const insertSubmission = db.prepare(`INSERT INTO submissions (task_id, user_id, files, message, status) VALUES (@task_id,@user_id,@files,@message,@status)`);
const getSubmissionsForTask = db.prepare(`SELECT * FROM submissions WHERE task_id = ? ORDER BY created_at DESC`);
const getSubmissionsByUser = db.prepare(`SELECT * FROM submissions WHERE user_id = ? ORDER BY created_at DESC`);


// create default admin user if not exists
(function ensureAdmin(){
  const admin = findUserByUsername.get('admin');
  if(!admin){
    const pw = 'admin123'; // change in production or create using setup script
    const hash = bcrypt.hashSync(pw, 10);
    createUserStmt.run({ username: 'admin', email: null, password_hash: hash, is_admin: 1, balance: 0 });
    console.log('Created default admin user (username: admin, password: admin123). Change immediately for production.');
  }
})();


// --- Auth utilities ---
function generateToken(user) {
  const payload = { id: user.id, username: user.username, is_admin: !!user.is_admin };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if(!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });
  const token = authHeader.replace('Bearer ', '');
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function adminMiddleware(req, res, next) {
  if(!req.user) return res.status(401).json({ error: 'Auth required' });
  if(!req.user.is_admin) return res.status(403).json({ error: 'Admin required' });
  next();
}

// --- API Endpoints ---

// AUTH: register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    if(!username || !password) return res.status(400).json({ error: 'username and password required' });
    const existing = findUserByUsername.get(username);
    if(existing) return res.status(400).json({ error: 'username taken' });
    const hash = await bcrypt.hash(password, 10);
    createUserStmt.run({ username, email: email || null, password_hash: hash, is_admin: 0, balance: 0 });
    const user = findUserByUsername.get(username);
    const token = generateToken(user);
    return res.json({ token, user: { id: user.id, username: user.username, balance: user.balance } });
  } catch(err){
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// AUTH: login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if(!username || !password) return res.status(400).json({ error: 'username and password required' });
    const user = findUserByUsername.get(username);
    if(!user) return res.status(400).json({ error: 'invalid credentials' });
    const ok = await bcrypt.compare(password, user.password_hash || '');
    if(!ok) return res.status(400).json({ error: 'invalid credentials' });
    const token = generateToken(user);
    return res.json({ token, user: { id: user.id, username: user.username, balance: user.balance, is_admin: user.is_admin } });
  } catch(err){
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// AUTH: me
app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = findUserById.get(req.user.id);
  if(!user) return res.status(404).json({ error: 'user not found' });
  res.json({ user });
});

// TASKS: list
app.get('/api/tasks', (req, res) => {
  const rows = getTasksStmt.all();
  res.json({ tasks: rows });
});

// TASKS: create (admin only)
app.post('/api/tasks', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { title, description, reward, tags } = req.body;
    if(!title || !description) return res.status(400).json({ error: 'title & description required' });
    const tagsStr = Array.isArray(tags) ? tags.join(',') : (tags || '');
    const info = insertTaskStmt.run({ title, description, reward: Number(reward||0), tags: tagsStr, created_by: req.user.id, status: 'open' });
    const newTask = getTaskById.get(info.lastInsertRowid);
    res.json({ task: newTask });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'server error' });
  }
});

// TASKS: take/assign (user accepts a task)
app.post('/api/tasks/:id/take', authMiddleware, (req, res) => {
  const id = Number(req.params.id);
  const task = getTaskById.get(id);
  if(!task) return res.status(404).json({ error: 'task not found' });
  if(task.status !== 'open') return res.status(400).json({ error: 'task not open' });
  db.prepare(`UPDATE tasks SET status='assigned', assigned_to = ? WHERE id = ?`).run(req.user.id, id);
  const t = getTaskById.get(id);
  res.json({ ok:true, task: t });
});

// SUBMIT: upload files + message
app.post('/api/submissions', authMiddleware, upload.array('files', 5), (req, res) => {
  try {
    const { task_id, message } = req.body;
    const taskId = Number(task_id);
    const task = getTaskById.get(taskId);
    if(!task) return res.status(404).json({ error: 'task not found' });

    // ensure task is assigned to this user or open (configurable)
    if(task.assigned_to && task.assigned_to !== req.user.id) {
      return res.status(403).json({ error: 'task assigned to another user' });
    }

    const files = (req.files || []).map(f => ({ originalname: f.originalname, filename: f.filename, path: `/uploads/${f.filename}` }));
    const filesJson = JSON.stringify(files);
    const info = insertSubmission.run({ task_id: taskId, user_id: req.user.id, files: filesJson, message: message || '', status: 'pending' });

    // set task status to 'submitted' (workflow)
    db.prepare(`UPDATE tasks SET status='submitted', assigned_to = ? WHERE id = ?`).run(req.user.id, taskId);

    const submission = db.prepare(`SELECT * FROM submissions WHERE id = ?`).get(info.lastInsertRowid);
    return res.json({ ok:true, submission });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server error' });
  }
});

// ADMIN: list submissions (admin)
app.get('/api/admin/submissions', authMiddleware, adminMiddleware, (req, res) => {
  const rows = db.prepare(`SELECT s.*, u.username as user_name, t.title as task_title FROM submissions s LEFT JOIN users u ON s.user_id = u.id LEFT JOIN tasks t ON s.task_id = t.id ORDER BY s.created_at DESC`).all();
  res.json({ submissions: rows });
});

// ADMIN: review submission (approve/reject)
app.post('/api/admin/submissions/:id/review', authMiddleware, adminMiddleware, (req, res) => {
  const id = Number(req.params.id);
  const { action, admin_note } = req.body; // action: approve/reject
  const sub = db.prepare(`SELECT * FROM submissions WHERE id = ?`).get(id);
  if(!sub) return res.status(404).json({ error: 'submission not found' });

  if(action === 'approve') {
    // give reward to user & mark task completed
    const task = getTaskById.get(sub.task_id);
    const reward = task ? Number(task.reward || 0) : 0;
    // update user's balance
    const user = findUserById.get(sub.user_id);
    const newBal = Number(user.balance || 0) + reward;
    updateUserBalance.run(newBal, user.id);

    // set submission status
    db.prepare(`UPDATE submissions SET status='approved', admin_note = ? WHERE id = ?`).run(admin_note||'', id);
    // mark task completed
    db.prepare(`UPDATE tasks SET status='completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(sub.task_id);

    return res.json({ ok:true, credited: reward, newBalance: newBal });
  } else {
    db.prepare(`UPDATE submissions SET status='rejected', admin_note = ? WHERE id = ?`).run(admin_note||'', id);
    // revert task to open or assigned depending on admin decision
    db.prepare(`UPDATE tasks SET status='open', assigned_to = NULL WHERE id = ?`).run(sub.task_id);
    return res.json({ ok:true, rejected: true });
  }
});

// USER: list my submissions
app.get('/api/my/submissions', authMiddleware, (req, res) => {
  const rows = getSubmissionsByUser.all(req.user.id);
  res.json({ submissions: rows });
});

// USER: create withdraw request
app.post('/api/withdraw', authMiddleware, (req, res) => {
  const { amount } = req.body;
  const amt = Number(amount || 0);
  if(amt <= 0) return res.status(400).json({ error: 'invalid amount' });
  const user = findUserById.get(req.user.id);
  if(user.balance < amt) return res.status(400).json({ error: 'insufficient balance' });
  db.prepare(`INSERT INTO withdraws (user_id, amount, status) VALUES (?, ?, 'requested')`).run(req.user.id, amt);
  // reduce user balance immediately to avoid double spends (or mark reserved in a real app)
  updateUserBalance.run(user.balance - amt, user.id);
  res.json({ ok:true });
});

// USER: create Stripe checkout session to add funds (test)
app.post('/api/stripe/create-checkout-session', authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    const amt = Math.round((Number(amount) || 0) * 100); // cents
    if(amt <= 0) return res.status(400).json({ error: 'invalid amount' });
    if(!STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe not configured' });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: { currency: 'inr', product_data: { name: 'Add funds to TaskEarn' }, unit_amount: amt },
        quantity: 1
      }],
      success_url: `${SITE_URL}/?checkout_success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/?checkout_cancel=1`,
      client_reference_id: req.user.id.toString()
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'stripe error' });
  }
});

// Webhook (optional) - you can implement Stripe webhook to credit user after payment
// For demo: we'll provide a simple endpoint to POST credit for a user (admin-only)
app.post('/api/admin/credit-user', authMiddleware, adminMiddleware, (req, res) => {
  const { user_id, amount } = req.body;
  const user = findUserById.get(user_id);
  if(!user) return res.status(404).json({ error: 'user not found' });
  const newBal = Number(user.balance || 0) + Number(amount || 0);
  updateUserBalance.run(newBal, user.id);
  res.json({ ok:true, newBalance: newBal });
});

// get user profile + balance (for frontend)
app.get('/api/profile', authMiddleware, (req, res) => {
  const user = findUserById.get(req.user.id);
  if(!user) return res.status(404).json({ error: 'user not found' });
  res.json({ user });
});

// fallback - send index.html for SPA routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Make sure you created .env with JWT_SECRET and Stripe keys if using payments.');
});
