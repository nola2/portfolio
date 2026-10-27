require('dotenv').config();
const path = require('path'), crypto = require('crypto');
const express = require('express'), helmet = require('helmet'), rateLimit = require('express-rate-limit');
const multer = require('multer'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const { pool, init } = require('./db');

const { JWT_SECRET, ADMIN_USER, ADMIN_PASSWORD, DATABASE_URL } = process.env;
if (!JWT_SECRET || !ADMIN_USER || !ADMIN_PASSWORD || !DATABASE_URL) {
  console.error('Missing env vars. Set DATABASE_URL, JWT_SECRET, ADMIN_USER, ADMIN_PASSWORD (see .env.example).');
  process.exit(1);
}
const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const up = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, f, cb) => /^image\/(jpeg|png|webp)$/.test(f.mimetype) ? cb(null, true)
    : cb(Object.assign(new Error('Only JPG, PNG or WEBP images are allowed'), { code: 'BAD_TYPE' }))
});
const upPdf = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, f, cb) => f.mimetype === 'application/pdf' ? cb(null, true)
    : cb(Object.assign(new Error('Only PDF files are allowed'), { code: 'BAD_TYPE' }))
});
const saveImage = async f => (await pool.query('INSERT INTO images(mime,data) VALUES($1,$2) RETURNING id', [f.mimetype, f.buffer])).rows[0].id;
const dropImage = id => id ? pool.query('DELETE FROM images WHERE id=$1', [id]) : null;
const imgUrl = id => id ? `/api/image/${id}` : null;

function auth(req, res, next) {
  try { jwt.verify(req.cookies.token, JWT_SECRET); next(); }
  catch (e) { res.status(401).json({ error: 'Not logged in' }); }
}

/* ---------- public API ---------- */
app.get('/api/profile', wrap(async (req, res) => {
  const p = (await pool.query('SELECT * FROM profile WHERE id=1')).rows[0] || {};
  p.photo_url = imgUrl(p.photo_id); p.resume_custom = !!p.resume_id; res.json(p);
}));
app.get('/api/projects', wrap(async (req, res) => {
  const r = await pool.query('SELECT * FROM projects ORDER BY position, id');
  res.json(r.rows.map(p => ({ ...p, technologies: p.technologies || [], image_url: imgUrl(p.image_id) })));
}));
app.get('/api/skills', wrap(async (req, res) => res.json((await pool.query('SELECT * FROM skills ORDER BY position, id')).rows)));
app.get('/api/image/:id', wrap(async (req, res) => {
  const r = await pool.query('SELECT mime,data FROM images WHERE id=$1', [parseInt(req.params.id) || 0]);
  if (!r.rowCount) return res.sendStatus(404);
  res.set('Content-Type', r.rows[0].mime).set('Cache-Control', 'public, max-age=31536000, immutable').send(r.rows[0].data);
}));
app.post('/api/contact', rateLimit({ windowMs: 3600e3, max: 5, message: { error: 'Too many messages, try later.' } }), wrap(async (req, res) => {
  const { name, email, message, website } = req.body || {};
  if (website) return res.json({ ok: true }); // honeypot: bots fill this
  if (!name || !email || !message || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Please fill in all fields with a valid email.' });
  await pool.query('INSERT INTO messages(name,email,message) VALUES($1,$2,$3)', [String(name).slice(0, 100), String(email).slice(0, 150), String(message).slice(0, 3000)]);
  res.json({ ok: true });
}));

/* ---------- admin API ---------- */
app.post('/api/admin/login', rateLimit({ windowMs: 15 * 60e3, max: 10, message: { error: 'Too many attempts, try later.' } }), (req, res) => {
  const { username, password } = req.body || {};
  if (!same(username || '', ADMIN_USER) || !same(password || '', ADMIN_PASSWORD)) return res.status(401).json({ error: 'Wrong username or password' });
  res.cookie('token', jwt.sign({ a: 1 }, JWT_SECRET, { expiresIn: '12h' }), { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 12 * 3600e3 });
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => { res.clearCookie('token'); res.json({ ok: true }); });
app.get('/api/admin/me', auth, (req, res) => res.json({ ok: true }));

const PF = ['lead', 'about', 'cgpa', 'solved', 'project_count', 'graduate_year', 'degree', 'institution', 'period'];
app.put('/api/admin/profile', auth, wrap(async (req, res) => {
  const vals = PF.map(k => String(req.body[k] ?? '').trim().slice(0, 1000) || null);
  await pool.query(`UPDATE profile SET ${PF.map((k, i) => `${k}=$${i + 1}`).join(',')} WHERE id=1`, vals);
  res.json({ ok: true });
}));
app.post('/api/admin/photo', auth, up.single('photo'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose an image first' });
  const old = (await pool.query('SELECT photo_id FROM profile WHERE id=1')).rows[0]?.photo_id;
  const id = await saveImage(req.file);
  await pool.query('UPDATE profile SET photo_id=$1 WHERE id=1', [id]); await dropImage(old);
  res.json({ photo_url: imgUrl(id) });
}));
app.delete('/api/admin/photo', auth, wrap(async (req, res) => {
  const old = (await pool.query('SELECT photo_id FROM profile WHERE id=1')).rows[0]?.photo_id;
  await pool.query('UPDATE profile SET photo_id=NULL WHERE id=1'); await dropImage(old);
  res.json({ ok: true });
}));

app.post('/api/admin/resume', auth, upPdf.single('resume'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a PDF first' });
  if (req.file.buffer.subarray(0, 4).toString() !== '%PDF') return res.status(400).json({ error: 'That file is not a valid PDF' });
  const old = (await pool.query('SELECT resume_id FROM profile WHERE id=1')).rows[0]?.resume_id;
  const id = await saveImage(req.file);
  await pool.query('UPDATE profile SET resume_id=$1 WHERE id=1', [id]); await dropImage(old);
  res.json({ ok: true });
}));
app.delete('/api/admin/resume', auth, wrap(async (req, res) => {
  const old = (await pool.query('SELECT resume_id FROM profile WHERE id=1')).rows[0]?.resume_id;
  await pool.query('UPDATE profile SET resume_id=NULL WHERE id=1'); await dropImage(old);
  res.json({ ok: true });
}));

const clean = b => ({
  title: String(b.title || '').trim().slice(0, 150),
  description: String(b.description || '').trim().slice(0, 1200),
  category: ['software', 'vision', 'security'].includes(b.category) ? b.category : 'software',
  technologies: String(b.technologies || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 15),
  link: /^https?:\/\//i.test(b.link || '') ? b.link.trim() : null
});
const posOf = async v => (v !== undefined && v !== '' && !isNaN(v)) ? parseInt(v) : (await pool.query('SELECT COALESCE(MAX(position),0)+1 AS n FROM projects')).rows[0].n;

app.post('/api/admin/projects', auth, up.single('image'), wrap(async (req, res) => {
  const p = clean(req.body);
  if (!p.title || !p.description) return res.status(400).json({ error: 'Title and description are required' });
  const img = req.file ? await saveImage(req.file) : null;
  const r = await pool.query('INSERT INTO projects(title,description,category,technologies,link,image_id,position) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [p.title, p.description, p.category, p.technologies, p.link, img, await posOf(req.body.position)]);
  res.json({ id: r.rows[0].id });
}));
app.put('/api/admin/projects/:id', auth, up.single('image'), wrap(async (req, res) => {
  const id = parseInt(req.params.id) || 0, p = clean(req.body);
  const cur = (await pool.query('SELECT image_id FROM projects WHERE id=$1', [id])).rows[0];
  if (!cur) return res.sendStatus(404);
  if (!p.title || !p.description) return res.status(400).json({ error: 'Title and description are required' });
  let img = cur.image_id;
  if (req.file) img = await saveImage(req.file); else if (req.body.remove_image === '1') img = null;
  await pool.query('UPDATE projects SET title=$1,description=$2,category=$3,technologies=$4,link=$5,image_id=$6,position=$7 WHERE id=$8',
    [p.title, p.description, p.category, p.technologies, p.link, img, await posOf(req.body.position), id]);
  if (img !== cur.image_id) await dropImage(cur.image_id);
  res.json({ ok: true });
}));
app.delete('/api/admin/projects/:id', auth, wrap(async (req, res) => {
  const r = await pool.query('DELETE FROM projects WHERE id=$1 RETURNING image_id', [parseInt(req.params.id) || 0]);
  if (r.rowCount) await dropImage(r.rows[0].image_id);
  res.json({ ok: true });
}));

app.post('/api/admin/skills', auth, wrap(async (req, res) => {
  const category = String(req.body.category || '').trim().slice(0, 60), name = String(req.body.name || '').trim().slice(0, 60);
  if (!category || !name) return res.status(400).json({ error: 'Category and skill name are required' });
  await pool.query('INSERT INTO skills(category,name,position) VALUES($1,$2,(SELECT COALESCE(MAX(position),0)+1 FROM skills))', [category, name]);
  res.json({ ok: true });
}));
app.delete('/api/admin/skills/:id', auth, wrap(async (req, res) => { await pool.query('DELETE FROM skills WHERE id=$1', [parseInt(req.params.id) || 0]); res.json({ ok: true }); }));

app.get('/api/admin/messages', auth, wrap(async (req, res) => res.json((await pool.query('SELECT * FROM messages ORDER BY id DESC LIMIT 200')).rows)));
app.delete('/api/admin/messages/:id', auth, wrap(async (req, res) => { await pool.query('DELETE FROM messages WHERE id=$1', [parseInt(req.params.id) || 0]); res.json({ ok: true }); }));

app.get('/healthz', (req, res) => res.type('text').send('ok')); // lightweight ping, does not touch the database

/* ---------- pages ---------- */
app.get('/resume.pdf', wrap(async (req, res) => {
  const r = await pool.query('SELECT i.mime, i.data FROM profile p JOIN images i ON i.id=p.resume_id WHERE p.id=1');
  res.set('Content-Disposition', 'inline; filename="Md_Shoaib_CV.pdf"').set('Cache-Control', 'no-cache');
  if (r.rowCount) return res.type(r.rows[0].mime).send(r.rows[0].data);
  res.sendFile(path.join(__dirname, 'defaults', 'Md_Shoaib_CV.pdf')); // built-in fallback until a CV is uploaded
}));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  const bad = err.code === 'LIMIT_FILE_SIZE' || err.code === 'BAD_TYPE';
  if (!bad) console.error(err);
  res.status(bad ? (err.code === 'LIMIT_FILE_SIZE' ? 413 : 400) : 500).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large (images max 3 MB, PDF max 5 MB)' : bad ? err.message : 'Server error' });
});

init().then(() => app.listen(process.env.PORT || 3000, () => console.log('Running on port ' + (process.env.PORT || 3000))))
  .catch(e => { console.error('Database setup failed:', e.message); process.exit(1); });
