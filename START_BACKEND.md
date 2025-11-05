# 🚀 How to Start the Backend Server in VS Code

## **Method 1: Using VS Code Terminal (Easiest)**

### Step 1: Open Terminal in VS Code
- Press `Ctrl + ~` (backtick) or go to `Terminal` → `New Terminal`
- Make sure you're in the project root: `votingapp`

### Step 2: Navigate to Server Folder
```bash
cd server
```

### Step 3: Install Dependencies (First Time Only)
```bash
pip install -r requirements.txt
```

### Step 4: Start the Server
```bash
python app.py
```

**That's it!** You should see:
```
* Running on http://127.0.0.1:5000
```

---

## **Method 2: Using VS Code Run Configuration (Even Easier)**

### Step 1: Create `.vscode/launch.json`
1. Create a folder called `.vscode` in your project root
2. Create a file called `launch.json` inside `.vscode`
3. Copy this content:

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Python: Flask App",
            "type": "python",
            "request": "launch",
            "program": "${workspaceFolder}/server/app.py",
            "console": "integratedTerminal",
            "justMyCode": true,
            "env": {
                "FLASK_ENV": "development",
                "FLASK_APP": "app.py"
            },
            "cwd": "${workspaceFolder}/server"
        }
    ]
}
```

### Step 2: Run the Server
- Press `F5` or click the "Run and Debug" icon (play button) in the sidebar
- Select "Python: Flask App" from the dropdown
- Click the green play button

**Done!** The server starts automatically.

---

## **Method 3: Using VS Code Task (One-Click Start)**

### Step 1: Create `.vscode/tasks.json`
1. Create a folder called `.vscode` in your project root (if it doesn't exist)
2. Create a file called `tasks.json` inside `.vscode`
3. Copy this content:

```json
{
    "version": "2.0.0",
    "tasks": [
        {
            "label": "Start Backend Server",
            "type": "shell",
            "command": "python app.py",
            "options": {
                "cwd": "${workspaceFolder}/server"
            },
            "problemMatcher": [],
            "presentation": {
                "reveal": "always",
                "panel": "new",
                "focus": false
            },
            "isBackground": true,
            "runOptions": {
                "runOn": "default"
            }
        }
    ]
}
```

### Step 2: Run the Task
- Press `Ctrl + Shift + P` (or `Cmd + Shift + P` on Mac)
- Type: `Tasks: Run Task`
- Select: `Start Backend Server`

**That's it!** The server starts in a new terminal.

---

## ✅ **Quick Verification**

Once the server is running, open your browser and go to:
```
http://127.0.0.1:5000/api/categories
```

You should see JSON data (the categories list).

---

## 🛑 **To Stop the Server**

- In the terminal where it's running, press `Ctrl + C`

---

## 📝 **Important Notes**

1. **First Time Setup**: Make sure you have Python installed (Python 3.7+)
2. **Dependencies**: Run `pip install -r requirements.txt` in the `server` folder (only needed once)
3. **Port**: The server runs on `http://127.0.0.1:5000` by default
4. **Database**: The database file (`database.db`) will be created automatically in the `server` folder

---

## 🎯 **Recommended: Method 2 (Run Configuration)**

This is the easiest because:
- ✅ Just press `F5` to start
- ✅ Debugging works automatically
- ✅ Breakpoints work
- ✅ No need to type commands

---

## 🔧 **Troubleshooting**

**Problem**: `python` command not found
- **Solution**: Try `python3` instead of `python`

**Problem**: Module not found errors
- **Solution**: Make sure you're in the `server` folder and run: `pip install -r requirements.txt`

**Problem**: Port 5000 already in use
- **Solution**: Kill the process using port 5000 or change the port in `app.py`


