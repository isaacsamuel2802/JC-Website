# Journal & Article Upload Website

A static club journal website for member-only article publishing and admin site editing.

## Features
- Member registration and login
- Members can publish PDF articles; uploads become live journal entries automatically
- Admin login with editable site title, subtitle, and about details
- Search published articles by title, author or category
- Download published PDF files
- Member management and save state in browser `localStorage`

## Run locally
1. Open a terminal in `c:\Users\WELCOME\Documents\JC website`.
2. Install dependencies if needed:
   - `npm install`
3. Start the server:
   - `node server.js`
4. Open your browser to:
   - `http://localhost:3000`
5. Use the top tabs to switch between Articles, Member, and Admin views.
6. Register a member, log in, and upload a PDF to publish an article.
7. Use the Admin tab with default credentials `admin` / `***REMOVED***` to update site content.

## Files
- `index.html` - main page and interface
- `styles.css` - style definitions and journal-inspired layout
- `script.js` - member, admin, and upload logic
