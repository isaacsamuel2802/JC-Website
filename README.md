# Journal & Article Upload Website

A static club journal website for member-only article publishing and admin site editing.

## Features
- Member registration and login with scrypt-hashed passwords and server-verified sessions
- Members can publish PDF articles; uploads become live journal entries automatically
- Admin login with editable site title, subtitle, and about details
- Separate upcoming-events schedule and searchable, date-filterable past-events archive with images and a dedicated event details page
- Search published articles by title, author or category
- Download published PDF files
- Member management and save state in browser `localStorage`

## Run locally
1. Open a terminal in `c:\Users\WELCOME\Documents\JC website`.
2. Install dependencies if needed:
   - `npm install`
3. Create a local environment file and set a unique admin username and password (at least 16 characters). You can generate a password locally with:
   - `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`
   - `Copy-Item .env.example .env`
   - Edit `.env`; do not commit it.
4. Start the server:
   - `node server.js`
5. Open your browser to:
   - `http://localhost:3000`
6. Use the top navigation to switch between Home, About, Events, Member, and Admin views.
7. Register a member, log in, and upload a PDF to publish an article.
8. Use the Admin tab to update site content, upcoming events, and the past-events archive.

Member passwords must be at least 12 characters. Existing plaintext member passwords are migrated to scrypt hashes when the server starts. The SQLite database is stored outside the static website directory; if `DATA_DIR` is set, it must also point outside that directory.

For deployment, configure `ADMIN_USERNAME` and `ADMIN_PASSWORD` as private environment variables in the hosting provider rather than committing `.env`. Use HTTPS and set `NODE_ENV=production`; member and admin sessions are server-side, HttpOnly, same-site cookies and expire after eight hours. Admin writes require a valid session, and state-changing API requests must have a same-origin `Origin` header.

No application can be guaranteed completely vulnerability-free. Before public launch, review the hosting provider's HTTPS, environment-variable, database backup, and access settings, and regularly run `npm audit`.

## Files
- `index.html` - main page and interface
- `about.html` - club information and searchable previous-events archive
- `events.html` - previous-events listing and individual event details
- `stylesone.css` - style definitions and journal-inspired layout
- `script.js` - member, admin, and upload logic
- `.env.example` - names of local admin environment variables; actual credentials belong in the ignored `.env` file
