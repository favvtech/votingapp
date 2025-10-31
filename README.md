# VotingApp – Real-time Voting Web App

Modern, mobile-first voting application with user authentication, persistent votes across 10 categories, and real-time results. Built with HTML, CSS, JavaScript, and Python (Flask). No inline CSS/JS. Uses Chart.js for charts, Leaflet for maps, and a polling strategy for real-time updates.

## Tech Stack
- Frontend: HTML, CSS, JavaScript (no inline code)
- Charts: Chart.js (CDN)
- Maps: Leaflet (CDN)
- Backend: Python + Flask
- Storage: SQLite (created at runtime) in `python/database.db`
- Images: Unsplash (proxied by backend)

## Project Structure

```
/html
  index.html
  album.html
  vote.html
  contact.html
  chart.html
  /partials
    header.html
    footer.html
/css
  style.css
/js
  script.js
/charts
  voting_chart.js
/python
  app.py
  requirements.txt
/data
  .gitkeep
/images
  README.md
.env.example
```

## Features
- User signup/login (session-based)
- Ten voting categories; one vote per user per category
- Votes persist across sessions; categories lock once voted
- Real-time chart updates via polling
- Mobile-first responsive UI with gold/black theme
- Album grid, hero carousel, contact page with live map

## Setup

1) Python environment
```
cd python
python -m venv .venv
. .venv/Scripts/activate  # Windows PowerShell: . .venv/Scripts/Activate.ps1
pip install -r requirements.txt
```

2) Configure environment
```
cp ..\.env.example ..\.env  # or create .env in project root
```
Edit `.env` and set:
```
FLASK_SECRET=change_this_secret
UNSPLASH_ACCESS_KEY=your_unsplash_key
```

3) Run the server
```
cd python
flask --app app run --debug
```
App will be available at http://127.0.0.1:5000

4) Open the app
- Home: http://127.0.0.1:5000/html/index.html

## Deployment (Render)
- Use a Python web service.
- Build command: `pip install -r python/requirements.txt`
- Start command: `gunicorn app:app` with `PYTHONPATH=python` and working dir set to `python`.
- Add environment variables `FLASK_SECRET`, `UNSPLASH_ACCESS_KEY`.

## Notes
- Database initializes automatically on first run.
- Images are fetched via backend proxy to avoid exposing keys.
- No inline CSS/JS; all assets are in their folders.
