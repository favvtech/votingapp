# Local Development Guide

## Starting the Backend

### Option 1: Using PowerShell (Recommended)
```powershell
.\start_backend.ps1
```

### Option 2: Using Command Prompt
```cmd
start_backend.bat
```

### Option 3: Manual Start
```powershell
cd server
$env:FLASK_ENV="development"
python app.py
```

The backend will start on `http://127.0.0.1:5000`

## Starting the Frontend

### Option 1: Using VS Code Live Server
1. Install the "Live Server" extension in VS Code
2. Right-click on `frontend/index.html`
3. Select "Open with Live Server"
4. It will open on `http://127.0.0.1:5500` (or similar port)

### Option 2: Using Python HTTP Server
```powershell
cd frontend
python -m http.server 8000
```
Then open `http://localhost:8000` in your browser

### Option 3: Direct File Open
- Simply open `frontend/index.html` in your browser
- Note: Some features may not work due to CORS when opening files directly

## Troubleshooting

### "Network error" when trying to login
1. **Check if backend is running**: Open `http://127.0.0.1:5000/api/check-session` in your browser
   - If you see `{"logged_in":false}`, the backend is running ✅
   - If you get an error, the backend is not running ❌

2. **Check the port**: Make sure the frontend is using a port that's allowed in CORS:
   - `http://localhost:5500` (Live Server default)
   - `http://localhost:8000` (Python server)
   - `http://localhost:8080`
   - `http://localhost:3000`

3. **Check browser console**: Open Developer Tools (F12) and check for CORS errors

### Backend won't start
- Make sure you're in the `server` directory
- Make sure Python and Flask are installed: `pip install -r server/requirements.txt`
- Check if port 5000 is already in use

### Still having issues?
- Make sure `FLASK_ENV=development` is set
- Check that the backend is actually running (you should see Flask output in the terminal)
- Try accessing `http://127.0.0.1:5000/api/check-session` directly in your browser

