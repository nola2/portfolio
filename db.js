const { Pool } = require('pg');
const url = process.env.DATABASE_URL;
const local = !url || /localhost|127\.0\.0\.1/.test(url);
const pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });

const PROJECTS = [
  ['Full-Stack Personal Portfolio', 'software', 'Building this portfolio end-to-end: responsive frontend, Node.js and Express backend, PostgreSQL data storage, admin authentication, content management and deployment.', ['HTML','CSS','JavaScript','Node.js','Express','PostgreSQL'], null],
  ['Face Recognition Attendance System', 'vision', 'Captures faces from the webcam, trains a recognizer, identifies people live, and writes each person into an Excel attendance sheet with the time.', ['Python','OpenCV','Excel'], 'https://github.com/nola2/Face-Recognition-Attendance-System'],
  ['Employee Management System', 'software', 'Java desktop app with a splash screen, login and home dashboard. Add, update, remove and view employee records in a SQL database.', ['Java','Swing','SQL','NetBeans'], 'https://github.com/nola2/Employee-Management-System'],
      ['Ultimate Tic Tac Toe with AI', 'software', 'The nested nine-board game with the forced next-board rule, win detection on small and big boards, and a computer opponent.', ['Python','Game logic','AI'], 'https://github.com/nola2/Ultimate-Tic-Tac-Toe-AI'],
  ['Web Security Assessment', 'security', 'Practice assessments using Acunetix scanning, reconnaissance and SQL injection testing, written up as penetration-testing reports.', ['Acunetix','Reconnaissance','SQL injection','Reporting'], null]
];
const SKILLS = {
  'Languages': ['Python','Java','SQL','HTML'],
  'Machine learning': ['OpenCV','YOLOv8','TensorFlow','Keras','PyTorch'],
  'Security': ['Acunetix','Reconnaissance','SQL injection','Pentest reports'],
  'Core CS': ['Data structures','Algorithms'],
  'Tools': ['Git and GitHub','NetBeans','PyCharm','Firebase'],
  'Office and documentation': ['Microsoft Excel','PowerPoint','Technical reports']
};

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS images(id SERIAL PRIMARY KEY, mime TEXT NOT NULL, data BYTEA NOT NULL, created_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE IF NOT EXISTS profile(id INT PRIMARY KEY DEFAULT 1, lead TEXT, about TEXT, cgpa TEXT, solved TEXT, project_count TEXT, graduate_year TEXT, degree TEXT, institution TEXT, period TEXT, photo_id INT REFERENCES images(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS projects(id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'software', technologies TEXT[] NOT NULL DEFAULT '{}', link TEXT, image_id INT REFERENCES images(id) ON DELETE SET NULL, position INT NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS skills(id SERIAL PRIMARY KEY, category TEXT NOT NULL, name TEXT NOT NULL, position INT NOT NULL DEFAULT 0);
    ALTER TABLE profile ADD COLUMN IF NOT EXISTS resume_id INT REFERENCES images(id) ON DELETE SET NULL;
    CREATE TABLE IF NOT EXISTS messages(id SERIAL PRIMARY KEY, name TEXT, email TEXT, message TEXT, created_at TIMESTAMPTZ DEFAULT now());
  `);
  await pool.query(
    `INSERT INTO profile(id,lead,about,cgpa,solved,degree,institution,period) VALUES(1,$1,$2,'3.6','338','B.Sc. in Computer Science and Engineering','Sylhet Engineering College','Feb 2022 – Aug 2026') ON CONFLICT (id) DO NOTHING`,
    ['Computer Science and Engineering graduate from Sylhet Engineering College, building practical skills across full-stack web development, machine learning, computer vision, web security and algorithms.',
     'Over four years of study I built projects in desktop software, computer vision and web security testing. Competitive programming on Codeforces sharpened my data structures and algorithms, and every project taught me to turn an idea into something that runs.']);
  if ((await pool.query('SELECT 1 FROM projects LIMIT 1')).rowCount === 0)
    for (const [i, p] of PROJECTS.entries())
      await pool.query('INSERT INTO projects(title,category,description,technologies,link,position) VALUES($1,$2,$3,$4,$5,$6)', [p[0], p[1], p[2], p[3], p[4], i + 1]);
  if ((await pool.query('SELECT 1 FROM skills LIMIT 1')).rowCount === 0) {
    let i = 0;
    for (const [cat, names] of Object.entries(SKILLS))
      for (const n of names) await pool.query('INSERT INTO skills(category,name,position) VALUES($1,$2,$3)', [cat, n, ++i]);
  }
}
module.exports = { pool, init };
