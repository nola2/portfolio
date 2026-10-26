# Deploy guide (A to Z)

## 1. Install (one time)
- Node.js LTS: https://nodejs.org  (check: `node -v`)
- Git: https://git-scm.com
- VS Code (optional): https://code.visualstudio.com

## 2. Free database (Neon)
1. https://neon.tech -> sign up -> Create project.
2. Copy the **connection string** (starts with `postgresql://`).

## 3. Run on your own PC first
```
cd shoaib-portfolio
copy .env.example .env        (Mac/Linux: cp .env.example .env)
```
Open `.env` and fill:
- DATABASE_URL = the Neon string
- JWT_SECRET = run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and paste
- ADMIN_USER / ADMIN_PASSWORD = your login (use a strong password)

```
npm install
npm start
```
Open http://localhost:3000 (site) and http://localhost:3000/admin (admin).
Tables and your current projects/skills are created automatically on first start.

## 4. Put code on GitHub
```
git init
git add .
git commit -m "portfolio with admin"
```
Create an empty repo on github.com, then run the 2-3 commands GitHub shows
(`git remote add origin ...`, `git branch -M main`, `git push -u origin main`).
`.env` is ignored by git, so your secrets stay private.

## 5. Deploy on Render (free)
1. https://render.com -> sign up with GitHub -> New -> **Web Service** -> pick your repo.
2. Runtime: Node. Build command: `npm install`. Start command: `npm start`. Plan: Free.
3. Environment variables: add DATABASE_URL, JWT_SECRET, ADMIN_USER, ADMIN_PASSWORD, NODE_ENV=production
4. Create. After a few minutes you get a link like https://your-name.onrender.com
   Site: that link. Admin: that link + `/admin`.

Note: Render free sleeps after ~15 min without visitors; first load after that takes ~30-60 s.

## 6. Daily use
Go to `/admin` -> log in -> change photo, edit text, add/edit/delete projects and skills, read contact messages.
No HTML editing, no redeploy needed. Images are stored in the database.
To change the site design itself (public/index.html): edit, `git add . && git commit -m "update" && git push` and Render redeploys.
