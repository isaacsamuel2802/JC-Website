const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'journalclub.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Failed to open database:', err);
    process.exit(1);
  }
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    author TEXT,
    category TEXT,
    date TEXT,
    uploadedBy TEXT,
    uploadedByEmail TEXT,
    fileName TEXT,
    fileType TEXT,
    fileData TEXT,
    fileText TEXT,
    createdAt TEXT NOT NULL
  )`);

  db.all('PRAGMA table_info(articles)', (err, rows) => {
    if (!err && rows && !rows.some(col => col.name === 'fileText')) {
      db.run('ALTER TABLE articles ADD COLUMN fileText TEXT');
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memberEmail TEXT NOT NULL,
    date TEXT NOT NULL,
    status TEXT NOT NULL,
    notes TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    UNIQUE(memberEmail, date)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    startDate TEXT NOT NULL,
    endDate TEXT,
    startTime TEXT,
    endTime TEXT,
    location TEXT,
    eventImage TEXT,
    createdBy TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`);

  db.all('PRAGMA table_info(events)', (err, rows) => {
    if (!err && rows && !rows.some(col => col.name === 'eventImage')) {
      db.run('ALTER TABLE events ADD COLUMN eventImage TEXT');
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  db.get('SELECT COUNT(*) AS count FROM settings', (err, row) => {
    if (!err && row && row.count === 0) {
      const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
      stmt.run('siteTitle', 'Journal Club');
      stmt.run('siteSubtitle', 'A warm, elegant journal space where members publish articles through PDF uploads.');
      stmt.run('aboutText', 'This club is dedicated to sharing journals, articles, and research through a simple, polished publishing workflow. Members upload PDF files and the journal appears automatically.');
      stmt.finalize();
    }
  });
});

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname)));

app.post('/api/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Missing name, email, or password.' });
  }

  const createdAt = new Date().toISOString();
  const stmt = db.prepare('INSERT INTO members (name, email, password, createdAt) VALUES (?, ?, ?, ?)');
  stmt.run(name, email.toLowerCase(), password, createdAt, function (err) {
    if (err) {
      if (err.code === 'SQLITE_CONSTRAINT') {
        return res.status(409).json({ error: 'Email already registered.' });
      }
      return res.status(500).json({ error: 'Database error.' });
    }
    res.json({ id: this.lastID, name, email: email.toLowerCase(), createdAt });
  });
  stmt.finalize();
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Missing email or password.' });
  }

  db.get('SELECT id, name, email, password FROM members WHERE email = ?', email.toLowerCase(), (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error.' });
    }
    if (!row || row.password !== password) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    res.json({ id: row.id, name: row.name, email: row.email });
  });
});

app.get('/api/articles', (req, res) => {
  db.all('SELECT * FROM articles ORDER BY createdAt DESC', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error.' });
    }
    res.json(rows);
  });
});

app.post('/api/articles', (req, res) => {
  const { title, author, category, date, uploadedBy, uploadedByEmail, fileName, fileType, fileData, fileText = '' } = req.body;
  if (!uploadedBy || !uploadedByEmail || !fileName || !fileType || !fileData) {
    return res.status(400).json({ error: 'Missing article fields.' });
  }
  const createdAt = new Date().toISOString();
  const stmt = db.prepare(
    'INSERT INTO articles (title, author, category, date, uploadedBy, uploadedByEmail, fileName, fileType, fileData, fileText, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  stmt.run(title, author, category, date, uploadedBy, uploadedByEmail, fileName, fileType, fileData, fileText, createdAt, function (err) {
    if (err) {
      return res.status(500).json({ error: 'Database error.' });
    }
    res.json({ id: this.lastID });
  });
  stmt.finalize();
});

app.delete('/api/articles/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM articles WHERE id = ?', id, function (err) {
    if (err) {
      return res.status(500).json({ error: 'Database error.' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Article not found.' });
    }
    res.json({ success: true });
  });
});

app.get('/api/attendance', (req, res) => {
  const { memberEmail, date } = req.query;
  let query = 'SELECT a.*, m.name AS memberName FROM attendance a LEFT JOIN members m ON a.memberEmail = m.email';
  const params = [];

  if (memberEmail) {
    query += ' WHERE a.memberEmail = ?';
    params.push(memberEmail.toLowerCase());
  }
  if (date) {
    query += memberEmail ? ' AND a.date = ?' : ' WHERE a.date = ?';
    params.push(date);
  }

  query += ' ORDER BY date DESC, memberEmail ASC';
  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error.' });
    }
    res.json(rows);
  });
});

app.post('/api/attendance', (req, res) => {
  const { date, records } = req.body;
  if (!date || !Array.isArray(records)) {
    return res.status(400).json({ error: 'Missing attendance date or records.' });
  }

  const now = new Date().toISOString();
  const stmt = db.prepare(
    'INSERT INTO attendance (memberEmail, date, status, notes, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?) '
    + 'ON CONFLICT(memberEmail, date) DO UPDATE SET status = excluded.status, notes = excluded.notes, updatedAt = excluded.updatedAt'
  );

  db.serialize(() => {
    records.forEach(record => {
      const email = String(record.memberEmail || '').toLowerCase();
      const status = String(record.status || 'Absent');
      if (!email) return;
      stmt.run(email, date, status, record.notes || '', now, now);
    });
  });

  stmt.finalize(err => {
    if (err) {
      return res.status(500).json({ error: 'Database error.' });
    }
    res.json({ success: true });
  });
});

app.get('/api/members', (req, res) => {
  db.all('SELECT id, name, email, createdAt FROM members ORDER BY createdAt DESC', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error.' });
    }
    res.json(rows);
  });
});

app.delete('/api/members/:email', (req, res) => {
  const { email } = req.params;
  db.run('DELETE FROM members WHERE email = ?', email.toLowerCase(), function (err) {
    if (err) {
      return res.status(500).json({ error: 'Database error.' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Member not found.' });
    }
    res.json({ success: true });
  });
});

app.get('/api/settings', (req, res) => {
  db.all('SELECT key, value FROM settings', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error.' });
    }
    const settings = {};
    rows.forEach(row => {
      settings[row.key] = row.value;
    });
    res.json(settings);
  });
});

app.post('/api/settings', (req, res) => {
  const { siteTitle, siteSubtitle, aboutText } = req.body;
  if (!siteTitle || !siteSubtitle || !aboutText) {
    return res.status(400).json({ error: 'Missing site settings.' });
  }
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  stmt.run('siteTitle', siteTitle);
  stmt.run('siteSubtitle', siteSubtitle);
  stmt.run('aboutText', aboutText, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Database error.' });
    }
    res.json({ success: true });
  });
  stmt.finalize();
});

// Events API
app.get('/api/events', (req, res) => {
  db.all('SELECT * FROM events ORDER BY startDate ASC, startTime ASC', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error.' });
    }
    res.json(rows || []);
  });
});

app.post('/api/events', (req, res) => {
  const { title, description, startDate, endDate, startTime, endTime, location, eventImage, createdBy } = req.body;
  if (!title || !startDate || !createdBy) {
    return res.status(400).json({ error: 'Missing required event fields (title, startDate, createdBy).' });
  }
  const now = new Date().toISOString();
  const stmt = db.prepare(
    'INSERT INTO events (title, description, startDate, endDate, startTime, endTime, location, eventImage, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  stmt.run(title, description || '', startDate, endDate || startDate, startTime || '', endTime || '', location || '', eventImage || '', createdBy, now, now, function (err) {
    if (err) {
      return res.status(500).json({ error: 'Database error.' });
    }
    res.json({ id: this.lastID, title, startDate, createdBy });
  });
  stmt.finalize();
});

app.put('/api/events/:id', (req, res) => {
  const { id } = req.params;
  const { title, description, startDate, endDate, startTime, endTime, location, eventImage } = req.body;
  if (!title || !startDate) {
    return res.status(400).json({ error: 'Missing required fields (title, startDate).' });
  }
  const now = new Date().toISOString();
  const stmt = db.prepare(
    'UPDATE events SET title = ?, description = ?, startDate = ?, endDate = ?, startTime = ?, endTime = ?, location = ?, eventImage = ?, updatedAt = ? WHERE id = ?'
  );
  stmt.run(title, description || '', startDate, endDate || startDate, startTime || '', endTime || '', location || '', eventImage || '', now, id, function (err) {
    if (err) {
      return res.status(500).json({ error: 'Database error.' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    res.json({ success: true, message: 'Event updated.' });
  });
  stmt.finalize();
});

app.delete('/api/events/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM events WHERE id = ?', id, function (err) {
    if (err) {
      return res.status(500).json({ error: 'Database error.' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    res.json({ success: true });
  });
});

app.listen(PORT, () => {
  console.log(`Journal Club server running at http://localhost:${PORT}`);
});
