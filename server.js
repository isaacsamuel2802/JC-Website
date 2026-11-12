require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const { promisify } = require('util');
const { rateLimit } = require('express-rate-limit');
const helmet = require('helmet');
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '.jc-website-private-data');
const DB_PATH = path.join(DATA_DIR, 'journalclub.db');
const LEGACY_DB_PATH = path.join(__dirname, 'data', 'journalclub.db');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_SESSION_COOKIE = 'jc_admin_session';
const MEMBER_SESSION_COOKIE = 'jc_member_session';
const SESSION_TTL = 8 * 60 * 60 * 1000;
const sessions = new Map();
const scryptAsync = promisify(crypto.scrypt);
let db;

if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
  console.error('Set ADMIN_USERNAME and ADMIN_PASSWORD in your environment or .env file.');
  process.exit(1);
}
if (Buffer.byteLength(ADMIN_PASSWORD, 'utf8') < 16) {
  console.error('ADMIN_PASSWORD must be at least 16 characters long.');
  process.exit(1);
}
const resolvedDataDir = path.resolve(DATA_DIR);
if (resolvedDataDir === __dirname || resolvedDataDir.startsWith(`${path.resolve(__dirname)}${path.sep}`)) {
  console.error('DATA_DIR must be outside the publicly served project directory.');
  process.exit(1);
}

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb', parameterLimit: 100 }));
app.use(helmet({
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://accounts.google.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://accounts.google.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://*.googleusercontent.com'],
      connectSrc: ["'self'", 'https://accounts.google.com'],
      frameSrc: ["'self'", 'https://accounts.google.com'],
      workerSrc: ["'self'", 'blob:', 'https://cdnjs.cloudflare.com'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use('/data', (_req, res) => res.sendStatus(404));
app.use(['/server.js', '/package.json', '/package-lock.json', '/README.md', '/.gitignore', '/test.html', '/contrast_check.py', '/node_modules', '/*.code-workspace'], (_req, res) => res.sendStatus(404));
app.use(express.static(path.join(__dirname)));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin || origin === 'null') {
    return res.status(403).json({ error: 'A same-origin request is required.' });
  }
  try {
    if (new URL(origin).host !== req.get('host')) {
      return res.status(403).json({ error: 'A same-origin request is required.' });
    }
  } catch {
    return res.status(403).json({ error: 'A valid request origin is required.' });
  }
  next();
});

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false
});

app.post('/api/admin/login', loginRateLimit, (req, res) => {
  const { username, password } = req.body;
  if (!safeEqual(username, ADMIN_USERNAME) || !safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'Admin credentials are incorrect.' });
  }

  createSession(res, ADMIN_SESSION_COOKIE, { type: 'admin', name: 'Administrator', email: '' });
  res.json({ name: 'Administrator' });
});

app.get('/api/admin/session', requireAdmin, (_req, res) => {
  res.json({ name: 'Administrator' });
});

app.post('/api/admin/logout', (req, res) => {
  clearSession(req, res, ADMIN_SESSION_COOKIE);
  res.json({ success: true });
});

app.post('/api/register', loginRateLimit, async (req, res) => {
  const { name, email, password } = req.body;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100
    || typeof email !== 'string' || email.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 1024) {
    return res.status(400).json({ error: 'Enter a valid name and email, and a password of at least 12 characters.' });
  }

  let passwordHash;
  try {
    passwordHash = await hashPassword(password);
  } catch (error) {
    console.error('Member password hashing failed', error);
    return res.status(500).json({ error: 'Unable to register member.' });
  }
  const createdAt = new Date().toISOString();
  const stmt = db.prepare('INSERT INTO members (name, email, password, createdAt) VALUES (?, ?, ?, ?)');
  stmt.run(name.trim(), email.toLowerCase(), passwordHash, createdAt, function (err) {
    if (err) {
      if (err.code === 'SQLITE_CONSTRAINT') {
        return res.status(409).json({ error: 'Email already registered.' });
      }
      return res.status(500).json({ error: 'Database error.' });
    }
    res.json({ id: this.lastID, name: name.trim(), email: email.toLowerCase(), createdAt });
  });
  stmt.finalize();
});

app.post('/api/login', loginRateLimit, (req, res) => {
  const { email, password } = req.body;
  if (typeof email !== 'string' || !email || typeof password !== 'string' || !password
    || email.length > 254 || Buffer.byteLength(password, 'utf8') > 1024) {
    return res.status(400).json({ error: 'Missing email or password.' });
  }

  db.get('SELECT id, name, email, password FROM members WHERE email = ?', email.toLowerCase(), async (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error.' });
    }
    if (!row) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    try {
      let verified = await verifyPassword(password, row.password);
      if (!verified && !isPasswordHash(row.password) && safeEqual(password, row.password)) {
        row.password = await hashPassword(password);
        await runDatabase('UPDATE members SET password = ? WHERE id = ?', [row.password, row.id]);
        verified = true;
      }
      if (!verified) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }
      const member = { id: row.id, name: row.name, email: row.email };
      createSession(res, MEMBER_SESSION_COOKIE, { type: 'member', name: member.name, email: member.email });
      res.json(member);
    } catch (error) {
      console.error('Member login failed', error);
      res.status(500).json({ error: 'Unable to complete member login.' });
    }
  });
});

app.get('/api/session', requireMember, (req, res) => {
  res.json({ name: req.auth.name, email: req.auth.email });
});

app.post('/api/logout', (req, res) => {
  clearSession(req, res, MEMBER_SESSION_COOKIE);
  res.json({ success: true });
});
app.post('/api/auth/google', loginRateLimit, async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(503).json({ error: 'Google Sign-In is not configured on the server.' });
  }
  const { credential } = req.body;
  if (typeof credential !== 'string' || !credential) {
    return res.status(400).json({ error: 'Missing Google credential.' });
  }
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email_verified) {
      return res.status(401).json({ error: 'Please use a verified Google account.' });
    }
    const email = payload.email.toLowerCase();
    const name = (payload.name || email.split('@')).trim().slice(0, 100);

    db.get('SELECT id, name, email FROM members WHERE email = ?', [email], async (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Database error.' });
      }
      if (row) {
        createSession(res, MEMBER_SESSION_COOKIE, { type: 'member', name: row.name, email: row.email });
        return res.json(row);
      }
      const randomPassHash = await hashPassword(crypto.randomBytes(32).toString('hex'));
      const createdAt = new Date().toISOString();
      db.run(
        'INSERT INTO members (name, email, password, createdAt) VALUES (?, ?, ?, ?)',
        [name, email, randomPassHash, createdAt],
        function (insertErr) {
          if (insertErr) {
            return res.status(500).json({ error: 'Unable to create member account.' });
          }
          const member = { id: this.lastID, name, email };
          createSession(res, MEMBER_SESSION_COOKIE, { type: 'member', name, email });
          res.json(member);
        }
      );
    });
  } catch (error) {
    console.error('Google token verification failed:', error);
    res.status(401).json({ error: 'Invalid Google sign-in token.' });
  }
});
app.get('/api/articles', (req, res) => {
  db.all('SELECT * FROM articles ORDER BY createdAt DESC', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error.' });
    }
    res.json(rows);
  });
});

app.post('/api/articles', requireMember, (req, res) => {
  const { title, author, category, date, fileName, fileData, fileText = '' } = req.body;
  if (typeof fileName !== 'string' || !fileName.trim() || fileName.length > 255
    || typeof fileData !== 'string' || !isValidPdfData(fileData)
    || typeof fileText !== 'string' || fileText.length > 200000
    || (title !== undefined && (typeof title !== 'string' || title.length > 200))
    || (author !== undefined && (typeof author !== 'string' || author.length > 100))
    || (category !== undefined && (typeof category !== 'string' || category.length > 100))
    || (date && !isValidEventDate(date))) {
    return res.status(400).json({ error: 'Missing article fields.' });
  }
  const safeFileName = path.basename(fileName.trim());
  const createdAt = new Date().toISOString();
  const stmt = db.prepare(
    'INSERT INTO articles (title, author, category, date, uploadedBy, uploadedByEmail, fileName, fileType, fileData, fileText, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  stmt.run(title || '', author || req.auth.name, category || '', date || '', req.auth.name, req.auth.email, safeFileName, 'application/pdf', fileData, fileText, createdAt, function (err) {
    if (err) {
      return res.status(500).json({ error: 'Database error.' });
    }
    res.json({ id: this.lastID });
  });
  stmt.finalize();
});

app.delete('/api/articles/:id', requireSession, (req, res) => {
  const { id } = req.params;
  db.get('SELECT uploadedByEmail FROM articles WHERE id = ?', id, (selectError, article) => {
    if (selectError) {
      return res.status(500).json({ error: 'Database error.' });
    }
    if (!article) {
      return res.status(404).json({ error: 'Article not found.' });
    }
    if (req.auth.type !== 'admin' && article.uploadedByEmail !== req.auth.email) {
      return res.status(403).json({ error: 'You can only delete your own articles.' });
    }
    db.run('DELETE FROM articles WHERE id = ?', id, function (deleteError) {
      if (deleteError) {
        return res.status(500).json({ error: 'Database error.' });
      }
      res.json({ success: true });
    });
  });
});

app.get('/api/attendance', requireSession, (req, res) => {
  const { memberEmail, date } = req.query;
  let query = 'SELECT a.*, m.name AS memberName FROM attendance a LEFT JOIN members m ON a.memberEmail = m.email';
  const params = [];

  if (req.auth.type === 'member') {
    query += ' WHERE a.memberEmail = ?';
    params.push(req.auth.email);
  } else if (memberEmail) {
    query += ' WHERE a.memberEmail = ?';
    params.push(memberEmail.toLowerCase());
  }
  if (date) {
    query += req.auth.type === 'member' || memberEmail ? ' AND a.date = ?' : ' WHERE a.date = ?';
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

app.post('/api/attendance', requireAdmin, (req, res) => {
  const { date, records } = req.body;
  if (!isValidEventDate(date) || !Array.isArray(records) || records.length > 1000
    || records.some(record => !record || typeof record !== 'object'
      || typeof record.memberEmail !== 'string'
      || record.memberEmail.length > 254
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.memberEmail)
      || !['Present', 'Absent'].includes(record.status)
      || (record.notes !== undefined && (typeof record.notes !== 'string' || record.notes.length > 1000)))) {
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

app.get('/api/members', requireAdmin, (req, res) => {
  db.all('SELECT id, name, email, createdAt FROM members ORDER BY createdAt DESC', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error.' });
    }
    res.json(rows);
  });
});

app.delete('/api/members/:email', requireAdmin, (req, res) => {
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

app.post('/api/settings', requireAdmin, (req, res) => {
  const { siteTitle, siteSubtitle, aboutText } = req.body;
  if (typeof siteTitle !== 'string' || !siteTitle.trim() || siteTitle.length > 160
    || typeof siteSubtitle !== 'string' || !siteSubtitle.trim() || siteSubtitle.length > 500
    || typeof aboutText !== 'string' || !aboutText.trim() || aboutText.length > 5000) {
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

app.post('/api/events', requireAdmin, (req, res) => {
  const { title, description, startDate, endDate, startTime, endTime, location, eventImage } = req.body;
  if (!isValidEventFields({ title, description, startDate, endDate, startTime, endTime, location })) {
    return res.status(400).json({ error: 'A title and valid start date are required.' });
  }
  if (eventImage && !isValidEventImage(eventImage)) {
    return res.status(400).json({ error: 'Event image must be a supported image under 8 MB.' });
  }
  const now = new Date().toISOString();
  const stmt = db.prepare(
    'INSERT INTO events (title, description, startDate, endDate, startTime, endTime, location, eventImage, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  stmt.run(title.trim(), description || '', startDate, endDate || startDate, startTime || '', endTime || '', location || '', eventImage || '', req.auth.name, now, now, function (err) {
    if (err) {
      return res.status(500).json({ error: 'Database error.' });
    }
    res.json({ id: this.lastID, title: title.trim(), startDate, createdBy: req.auth.name });
  });
  stmt.finalize();
});

app.put('/api/events/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { title, description, startDate, endDate, startTime, endTime, location, eventImage } = req.body;
  if (!isValidEventFields({ title, description, startDate, endDate, startTime, endTime, location })) {
    return res.status(400).json({ error: 'A title and valid start date are required.' });
  }
  if (eventImage && !isValidEventImage(eventImage)) {
    return res.status(400).json({ error: 'Event image must be a supported image under 8 MB.' });
  }
  const now = new Date().toISOString();
  const stmt = db.prepare(
    'UPDATE events SET title = ?, description = ?, startDate = ?, endDate = ?, startTime = ?, endTime = ?, location = ?, eventImage = ?, updatedAt = ? WHERE id = ?'
  );
  stmt.run(  title.trim(), description || '', startDate, endDate || startDate, startTime || '', endTime || '', location || '', eventImage || '', now, id, function (err) {
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

app.delete('/api/events/:id', requireAdmin, (req, res) => {
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

app.get('/api/past-events', (req, res) => {
  db.all('SELECT * FROM past_events ORDER BY createdAt DESC, id DESC', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error.' });
    }
    res.json(rows || []);
  });
});

app.post('/api/past-events', requireAdmin, (req, res) => {
  const { title, description, eventDate, location, eventImage } = req.body;
  if (typeof title !== 'string' || !title.trim() || title.length > 200 || !isValidEventDate(eventDate)
    || !isValidOptionalText(description, 5000) || !isValidOptionalText(location, 200)) {
    return res.status(400).json({ error: 'Missing required event fields (title, eventDate).' });
  }
  if (eventImage && !isValidEventImage(eventImage)) {
    return res.status(400).json({ error: 'Event image must be a supported image under 8 MB.' });
  }

  const now = new Date().toISOString();
  db.run(
    'INSERT INTO past_events (title, description, eventDate, location, eventImage, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    title.trim(), description || '', eventDate, location || '', eventImage || '', now, now,
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Database error.' });
      }
      res.status(201).json({ id: this.lastID, title, eventDate, createdAt: now });
    }
  );
});

app.put('/api/past-events/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { title, description, eventDate, location, eventImage } = req.body;
  if (typeof title !== 'string' || !title.trim() || title.length > 200 || !isValidEventDate(eventDate)
    || !isValidOptionalText(description, 5000) || !isValidOptionalText(location, 200)) {
    return res.status(400).json({ error: 'Missing required event fields (title, eventDate).' });
  }
  if (eventImage && !isValidEventImage(eventImage)) {
    return res.status(400).json({ error: 'Event image must be a supported image under 8 MB.' });
  }

  const now = new Date().toISOString();
  db.run(
    'UPDATE past_events SET title = ?, description = ?, eventDate = ?, location = ?, eventImage = ?, updatedAt = ? WHERE id = ?',
    title.trim(), description || '', eventDate, location || '', eventImage || '', now, id,
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Database error.' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Past event not found.' });
      }
      res.json({ success: true });
    }
  );
});

app.delete('/api/past-events/:id', requireAdmin, (req, res) => {
  db.run('DELETE FROM past_events WHERE id = ?', req.params.id, function (err) {
    if (err) {
      return res.status(500).json({ error: 'Database error.' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Past event not found.' });
    }
    res.json({ success: true });
  });
});

function isValidEventImage(dataUrl) {
  if (typeof dataUrl !== 'string') return false;
  const imageData = /^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(dataUrl);
  return Boolean(imageData && imageData[1].length % 4 === 0 && dataUrl.length <= 11_200_000);
}

function isValidPdfData(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > 23_000_000) return false;
  const pdfData = /^data:application\/pdf;base64,([A-Za-z0-9+/]+={0,2})$/i.exec(dataUrl);
  if (!pdfData || pdfData[1].length % 4 !== 0) return false;
  return Buffer.from(pdfData[1], 'base64').subarray(0, 5).toString('ascii') === '%PDF-';
}

function isValidEventDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidOptionalText(value, maxLength) {
  return value === undefined || value === null || (typeof value === 'string' && value.length <= maxLength);
}

function isValidEventFields({ title, description, startDate, endDate, startTime, endTime, location }) {
  const isValidTime = value => !value || (typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value));
  return typeof title === 'string' && Boolean(title.trim()) && title.length <= 200
    && isValidEventDate(startDate)
    && (!endDate || isValidEventDate(endDate))
    && isValidTime(startTime)
    && isValidTime(endTime)
    && isValidOptionalText(description, 5000)
    && isValidOptionalText(location, 200);
}

function safeEqual(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = await scryptAsync(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  });
  return `scrypt$32768$8$1$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

function isPasswordHash(value) {
  return typeof value === 'string' && value.startsWith('scrypt$32768$8$1$');
}

async function verifyPassword(password, storedValue) {
  if (!isPasswordHash(storedValue)) return false;
  const [, n, r, p, saltHex, hashHex] = storedValue.split('$');
  if (n !== '32768' || r !== '8' || p !== '1'
    || !/^[a-f0-9]{32}$/i.test(saltHex) || !/^[a-f0-9]{128}$/i.test(hashHex)) {
    return false;
  }
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  });
  return crypto.timingSafeEqual(actual, expected);
}

function getCookieToken(req, cookieName) {
  const cookies = req.headers.cookie || '';
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${cookieName}=([a-f0-9]{64})(?:;|$)`));
  return match ? match[1] : '';
}

function createSession(res, cookieName, user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { ...user, expiresAt: Date.now() + SESSION_TTL });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.append(
    'Set-Cookie',
    `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}${secure}`
  );
}

function clearSession(req, res, cookieName) {
  const token = getCookieToken(req, cookieName);
  if (token) sessions.delete(token);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.append('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}

function findSession(req, expectedType) {
  for (const [cookieName, type] of [[ADMIN_SESSION_COOKIE, 'admin'], [MEMBER_SESSION_COOKIE, 'member']]) {
    if (expectedType && type !== expectedType) continue;
    const token = getCookieToken(req, cookieName);
    if (!token) continue;
    const session = sessions.get(token);
    if (session && session.expiresAt > Date.now() && session.type === type) {
      return session;
    }
    if (session) sessions.delete(token);
  }
  return null;
}

function requireSession(req, res, next) {
  const session = findSession(req);
  if (!session) return res.status(401).json({ error: 'Sign-in is required.' });
  req.auth = session;
  next();
}

function requireAdmin(req, res, next) {
  const session = findSession(req, 'admin');
  if (!session || session.type !== 'admin') {
    return res.status(401).json({ error: 'Admin sign-in is required.' });
  }
  req.auth = session;
  next();
}

function requireMember(req, res, next) {
  const session = findSession(req, 'member');
  if (!session || session.type !== 'member') {
    return res.status(401).json({ error: 'Member sign-in is required.' });
  }
  req.auth = session;
  next();
}

function runDatabase(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
      if (error) reject(error);
      else resolve(this);
    });
  });
}

function allDatabase(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

async function ensureColumn(table, column, definition) {
  const columns = await allDatabase(`PRAGMA table_info(${table})`);
  if (!columns.some(item => item.name === column)) {
    await runDatabase(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function migrateLegacyPasswords() {
  const members = await allDatabase('SELECT id, password FROM members');
  for (const member of members) {
    if (isPasswordHash(member.password)) continue;
    const passwordHash = await hashPassword(member.password);
    await runDatabase('UPDATE members SET password = ? WHERE id = ?', [passwordHash, member.id]);
  }
}

async function initializeDatabase() {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH) && fs.existsSync(LEGACY_DB_PATH)) {
    const legacy = await new Promise((resolve, reject) => {
      const source = new sqlite3.Database(LEGACY_DB_PATH, error => error ? reject(error) : resolve(source));
    });
    try {
      await new Promise((resolve, reject) => {
        legacy.backup(DB_PATH, error => error ? reject(error) : resolve());
      });
    } finally {
      await new Promise(resolve => legacy.close(() => resolve()));
    }
  }

  db = await new Promise((resolve, reject) => {
    const database = new sqlite3.Database(DB_PATH, error => error ? reject(error) : resolve(database));
  });

  await runDatabase(`CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )`);
  await runDatabase(`CREATE TABLE IF NOT EXISTS articles (
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
  await ensureColumn('articles', 'fileText', 'TEXT');
  await runDatabase(`CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memberEmail TEXT NOT NULL,
    date TEXT NOT NULL,
    status TEXT NOT NULL,
    notes TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    UNIQUE(memberEmail, date)
  )`);
  await runDatabase(`CREATE TABLE IF NOT EXISTS events (
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
  await ensureColumn('events', 'eventImage', 'TEXT');
  await runDatabase(`CREATE TABLE IF NOT EXISTS past_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    eventDate TEXT NOT NULL,
    location TEXT,
    eventImage TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`);
  await runDatabase(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
  await runDatabase('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', ['siteTitle', 'Journal Club']);
  await runDatabase('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', ['siteSubtitle', 'A warm, elegant journal space where members publish articles through PDF uploads.']);
  await runDatabase('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', ['aboutText', 'This club is dedicated to sharing journals, articles, and research through a simple, polished publishing workflow. Members upload PDF files and the journal appears automatically.']);
  await migrateLegacyPasswords();
}

initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Journal Club server running at http://localhost:${PORT}`);
  });
}).catch(error => {
  console.error('Failed to initialize private database:', error);
  process.exit(1);
});
