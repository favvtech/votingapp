import os
import json
import sqlite3
import secrets
import string
from datetime import datetime
from typing import List, Set, Optional
from flask import Flask, jsonify, request, session
from flask_cors import CORS
import requests

# Load allowed birthdates from JSON file
ALLOWED_BIRTHDATES: Set[str] = set()

def load_birthdates():
    """Load allowed birthdates from JSON file"""
    global ALLOWED_BIRTHDATES
    try:
        json_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'Birth_Dates_Final_Array.json')
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            for item in data:
                birthdate = item.get('Birth Date', '').strip()
                if birthdate:
                    ALLOWED_BIRTHDATES.add(birthdate)
        print(f"Loaded {len(ALLOWED_BIRTHDATES)} allowed birthdates")
    except Exception as e:
        print(f"Error loading birthdates: {e}")
        ALLOWED_BIRTHDATES = set()

def init_db():
    """Initialize SQLite database"""
    db_path = os.path.join(os.path.dirname(__file__), 'database.db')
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fullname TEXT NOT NULL,
            phone TEXT NOT NULL,
            country_code TEXT NOT NULL,
            email TEXT,
            birthdate TEXT NOT NULL,
            birthdate_suffix INTEGER DEFAULT 1,
            access_code TEXT NOT NULL UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create index for faster lookups
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_birthdate_fullname 
        ON users(birthdate, fullname)
    ''')
    
    conn.commit()
    conn.close()
    print("Database initialized")

def format_birthdate(day: int, month: int, year: int) -> str:
    """Convert day, month, year to 'DD MMM YYYY' format"""
    month_names = {
        1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
        7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec"
    }
    month_name = month_names.get(month, "Jan")
    return f"{day} {month_name} {year}"

def verify_birthdate(day: int, month: int, year: int) -> bool:
    """Check if birthdate is in allowed list"""
    formatted = format_birthdate(day, month, year)
    return formatted in ALLOWED_BIRTHDATES

def get_db():
    """Get database connection"""
    db_path = os.path.join(os.path.dirname(__file__), 'database.db')
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn

def generate_access_code() -> str:
    """Generate a unique 6-character access code: 4 letters + 2 numbers"""
    letters = string.ascii_uppercase
    digits = string.digits
    while True:
        # Generate 4 random letters
        letter_part = ''.join(secrets.choice(letters) for _ in range(4))
        # Generate 2 random numbers
        number_part = ''.join(secrets.choice(digits) for _ in range(2))
        # Combine: 4 letters + 2 numbers
        code = letter_part + number_part
        # Check if code already exists
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM users WHERE access_code = ?", (code,))
        if not cursor.fetchone():
            conn.close()
            return code
        conn.close()

def create_app() -> Flask:
    app = Flask(__name__)
    app.secret_key = os.getenv('FLASK_SECRET', 'dev-secret-key-change-in-production')
    CORS(app, supports_credentials=True)
    
    # Load birthdates and initialize database on startup
    load_birthdates()
    init_db()

    @app.get("/api/hero-images")
    def hero_images():
        access_key = os.getenv("UNSPLASH_ACCESS_KEY")
        if not access_key:
            return jsonify([])

        try:
            params = {
                "query": "award ceremony",
                "per_page": 20,
                "orientation": "landscape",
            }
            headers = {"Accept-Version": "v1"}
            resp = requests.get(
                "https://api.unsplash.com/search/photos",
                params=params,
                headers=headers,
                timeout=10,
                auth=(access_key, ""),
            )
            resp.raise_for_status()
            data = resp.json()
            results = data.get("results", [])
            urls: List[str] = []
            for it in results:
                urls.append(it.get("urls", {}).get("regular"))
                if len(urls) == 4:
                    break
            urls = [u for u in urls if u]
            return jsonify(urls)
        except Exception:
            return jsonify([])

    @app.post("/api/verify-birthdate")
    def verify_birthdate_endpoint():
        """Verify if birthdate is allowed"""
        data = request.get_json()
        day = data.get('day')
        month = data.get('month')
        year = data.get('year')
        
        if not all([day, month, year]):
            return jsonify({"allowed": False, "message": "Please provide day, month, and year"}), 400
        
        try:
            day = int(day)
            month = int(month)
            year = int(year)
            
            if not (1 <= day <= 31) or not (1 <= month <= 12) or not (1900 <= year <= 2100):
                return jsonify({"allowed": False, "message": "Invalid date values"}), 400
                
            allowed = verify_birthdate(day, month, year)
            if not allowed:
                return jsonify({
                    "allowed": False,
                    "message": "Sorry You Can't Sign Up On This Platform"
                }), 403
            
            return jsonify({"allowed": True})
        except (ValueError, TypeError):
            return jsonify({"allowed": False, "message": "Invalid date format"}), 400

    @app.post("/api/signup")
    def signup():
        """Register new user"""
        data = request.get_json()
        firstname = data.get('firstname', '').strip()
        lastname = data.get('lastname', '').strip()
        phone = data.get('phone', '').strip()
        country_code = data.get('country_code', '+1').strip()
        email = data.get('email') or ''
        email = email.strip() if email else None
        day = data.get('day')
        month = data.get('month')
        year = data.get('year')
        
        # Combine name fields
        fullname = f"{firstname} {lastname}".strip()
        
        # Validate required fields
        if not firstname or not lastname or not phone or not all([day, month, year]):
            return jsonify({"success": False, "message": "Please fill all required fields"}), 400
        
        # Verify birthdate
        try:
            day = int(day)
            month = int(month)
            year = int(year)
            
            if not verify_birthdate(day, month, year):
                return jsonify({
                    "success": False,
                    "message": "Sorry You Can't Sign Up On This Platform"
                }), 403
                
            formatted_birthdate = format_birthdate(day, month, year)
        except (ValueError, TypeError):
            return jsonify({"success": False, "message": "Invalid date format"}), 400
        
        # Validate email if provided
        if email and '@' not in email:
            return jsonify({"success": False, "message": "Please enter a valid email address"}), 400
        
        # Check if same birthdate + fullname combination already exists
        conn = get_db()
        cursor = conn.cursor()
        
        # Normalize fullname for comparison (lowercase, trimmed)
        fullname_normalized = fullname.lower().strip()
        
        # Check if user with same birthdate and fullname exists
        cursor.execute(
            "SELECT birthdate_suffix FROM users WHERE birthdate = ? AND LOWER(TRIM(fullname)) = ?",
            (formatted_birthdate, fullname_normalized)
        )
        existing_user = cursor.fetchone()
        
        # Determine birthdate_suffix
        if existing_user:
            # User with same birthdate + fullname exists, check if it's same person
            # Or assign new suffix if different person
            cursor.execute(
                "SELECT MAX(birthdate_suffix) FROM users WHERE birthdate = ?",
                (formatted_birthdate,)
            )
            max_suffix = cursor.fetchone()[0]
            birthdate_suffix = (max_suffix or 0) + 1
        else:
            # Check if birthdate exists (for assigning suffix)
            cursor.execute(
                "SELECT MAX(birthdate_suffix) FROM users WHERE birthdate = ?",
                (formatted_birthdate,)
            )
            max_suffix = cursor.fetchone()[0]
            birthdate_suffix = (max_suffix or 0) + 1
        
        # Full phone number with country code
        full_phone = f"{country_code}{phone}"
        
        # Check if phone already exists (optional check)
        cursor.execute("SELECT id FROM users WHERE phone = ?", (full_phone,))
        if cursor.fetchone():
            conn.close()
            return jsonify({"success": False, "message": "Phone number already registered"}), 409
        
        # Generate unique access code
        access_code = generate_access_code()
        
        # Create user
        try:
            cursor.execute(
                "INSERT INTO users (fullname, phone, country_code, email, birthdate, birthdate_suffix, access_code) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (fullname, full_phone, country_code, email, formatted_birthdate, birthdate_suffix, access_code)
            )
            user_id = cursor.lastrowid
            conn.commit()
            conn.close()
            
            # Create session
            session['user_id'] = user_id
            session['phone'] = full_phone
            session['fullname'] = fullname
            session['birthdate'] = formatted_birthdate
            session['access_code'] = access_code
            
            return jsonify({
                "success": True,
                "message": "Account created successfully",
                "user": {
                    "id": user_id,
                    "fullname": fullname,
                    "phone": full_phone,
                    "email": email,
                    "access_code": access_code
                }
            })
        except Exception as e:
            conn.close()
            print(f"Error creating account: {e}")
            return jsonify({"success": False, "message": "Error creating account"}), 500

    @app.post("/api/login")
    def login():
        """Login existing user"""
        data = request.get_json()
        firstname = data.get('firstname', '').strip()
        lastname = data.get('lastname', '').strip()
        phone = data.get('phone', '').strip()
        country_code = data.get('country_code', '+1').strip()
        access_code = data.get('access_code', '').strip()
        day = data.get('day')
        month = data.get('month')
        year = data.get('year')
        
        # Combine name fields
        fullname = f"{firstname} {lastname}".strip()
        
        # Validate required fields
        if not firstname or not lastname or not phone or not access_code or not all([day, month, year]):
            return jsonify({"success": False, "message": "Please fill all required fields"}), 400
        
        # Format birthdate
        try:
            day = int(day)
            month = int(month)
            year = int(year)
            formatted_birthdate = format_birthdate(day, month, year)
        except (ValueError, TypeError):
            return jsonify({"success": False, "message": "Invalid date format"}), 400
        
        # Normalize fullname for comparison
        fullname_normalized = fullname.lower().strip()
        
        # Full phone number with country code
        full_phone = f"{country_code}{phone}"
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Find user by birthdate + fullname (case-insensitive)
        cursor.execute(
            "SELECT * FROM users WHERE birthdate = ? AND LOWER(TRIM(fullname)) = ?",
            (formatted_birthdate, fullname_normalized)
        )
        user = cursor.fetchone()
        
        if not user:
            # Check if birthdate exists but name doesn't match
            cursor.execute(
                "SELECT id FROM users WHERE birthdate = ?",
                (formatted_birthdate,)
            )
            if cursor.fetchone():
                conn.close()
                return jsonify({
                    "success": False,
                    "message": "Name doesn't match our records for this birthdate"
                }), 404
            else:
                conn.close()
                return jsonify({
                    "success": False,
                    "message": "Sign up for an account"
                }), 404
        
        # Verify access code
        if user['access_code'] != access_code:
            conn.close()
            return jsonify({
                "success": False,
                "message": "Invalid access code. Please check your access code."
            }), 403
        
        conn.close()
        
        # Create session
        session['user_id'] = user['id']
        session['phone'] = user['phone']
        session['fullname'] = user['fullname']
        session['birthdate'] = user['birthdate']
        session['access_code'] = user['access_code']
        
        return jsonify({
            "success": True,
            "message": "Login successful",
            "user": {
                "id": user['id'],
                "fullname": user['fullname'],
                "phone": user['phone'],
                "email": user['email'],
                "access_code": user['access_code']
            }
        })

    @app.get("/api/check-session")
    def check_session():
        """Check if user is logged in"""
        if 'user_id' in session:
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM users WHERE id = ?", (session['user_id'],))
            user = cursor.fetchone()
            conn.close()
            
            if user:
                return jsonify({
                    "logged_in": True,
                    "user": {
                        "id": user['id'],
                        "fullname": user['fullname'],
                        "phone": user['phone'],
                        "email": user['email']
                    }
                })
        
        return jsonify({"logged_in": False})

    @app.post("/api/logout")
    def logout():
        """Logout user"""
        session.clear()
        return jsonify({"success": True, "message": "Logged out successfully"})

    return app


app = create_app()

if __name__ == "__main__":
    app.run(debug=True)


