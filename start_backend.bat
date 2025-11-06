@echo off
echo Starting Voting App Backend...
cd server
set FLASK_ENV=development
set FLASK_APP=app.py
python app.py
pause

