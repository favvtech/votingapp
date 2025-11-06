Write-Host "Starting Voting App Backend..." -ForegroundColor Green
Set-Location server
$env:FLASK_ENV = "development"
$env:FLASK_APP = "app.py"
python app.py

