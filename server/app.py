import os
import json
import sqlite3
import secrets
import string
import logging
from datetime import datetime
from typing import List, Set, Optional
from flask import Flask, jsonify, request, session
from flask_cors import CORS
from dotenv import load_dotenv
import requests

# Load environment variables from .env file if present
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

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
    
    # Votes table: one vote per user per category
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            category_id INTEGER NOT NULL,
            nominee_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, category_id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_votes_category ON votes(category_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_votes_nominee ON votes(nominee_id)')
    
    conn.commit()
    conn.close()
    print("Database initialized")

def load_categories_data() -> Optional[list]:
    """Load categories array from JS file (supports both frontend/data and data paths)."""
    try:
        # Prefer the frontend path used by the live site
        repo_root = os.path.dirname(os.path.dirname(__file__))
        frontend_path = os.path.join(repo_root, 'frontend', 'data', 'categories.js')
        legacy_path = os.path.join(repo_root, 'data', 'categories.js')
        path = frontend_path if os.path.exists(frontend_path) else legacy_path
        if not os.path.exists(path):
            return None
        with open(path, 'r', encoding='utf-8') as f:
            text = f.read()
        # Extract JSON array
        start = text.find('[')
        end = text.rfind(']')
        if start == -1 or end == -1 or end <= start:
            return None
        payload = text[start:end+1]
        return json.loads(payload)
    except Exception:
        return None

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

def get_user_by_access_code(code: str) -> Optional[sqlite3.Row]:
    if not code:
        return None
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE access_code = ?", (code.strip().upper(),))
    user = cur.fetchone()
    conn.close()
    return user

def authenticate_request() -> Optional[int]:
    """Return user_id if request is authenticated via session or access code header."""
    if 'user_id' in session:
        return int(session['user_id'])
    # Header-based fallback: X-Access-Code or Bearer <code>
    code = request.headers.get('X-Access-Code', '').strip()
    if not code:
        auth = request.headers.get('Authorization', '')
        if auth.lower().startswith('bearer '):
            code = auth.split(' ', 1)[1].strip()
    if code:
        user = get_user_by_access_code(code)
        if user:
            # optionally attach a lightweight session
            session['user_id'] = user['id']
            session['access_code'] = user['access_code']
            session['fullname'] = user['fullname']
            session['phone'] = user['phone']
            session['birthdate'] = user['birthdate']
            return int(user['id'])
    return None

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
    # Read environment variables
    DATABASE_URL = os.getenv("DATABASE_URL")
    
    # Diagnostic check for DATABASE_URL
    if not DATABASE_URL:
        print("⚠ DATABASE_URL not found in environment.")
    else:
        print(f"✅ DATABASE_URL detected: {DATABASE_URL[:40]}...")
    
    SECRET_KEY = os.getenv("SECRET_KEY") or os.getenv("FLASK_SECRET", "dev-secret-key-change-in-production")
    FRONTEND_URL = os.getenv("FRONTEND_URL")
    FORCE_HTTPS = os.getenv("FORCE_HTTPS", "0")
    flask_env = os.getenv('FLASK_ENV', '').lower()
    is_production = flask_env == 'production' or bool(DATABASE_URL)
    
    app = Flask(__name__)
    app.secret_key = SECRET_KEY
    
    # Database configuration
    # TODO: Full migration to SQLAlchemy - currently using SQLite fallback
    # If DATABASE_URL is set (PostgreSQL), configure SQLAlchemy
    # Otherwise, use existing SQLite implementation (get_db function)
    if DATABASE_URL:
        try:
            from models import db
            # Convert postgres:// to postgresql:// for SQLAlchemy
            db_url = DATABASE_URL.replace('postgres://', 'postgresql://', 1)
            app.config["SQLALCHEMY_DATABASE_URI"] = db_url
            app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
            db.init_app(app)
            logger.info("SQLAlchemy configured with PostgreSQL")
        except Exception as e:
            logger.error(f"Failed to configure SQLAlchemy: {e}")
            logger.warning("Falling back to SQLite")
    else:
        # Fallback to SQLite for local development
        logger.info("Using SQLite for local development")
    
    # Session cookie configuration
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax" if not is_production else "None"
    app.config["SESSION_COOKIE_SECURE"] = True if (FORCE_HTTPS == "1" or is_production) else False
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    
    # CORS configuration
    # Accept comma-separated origins in ALLOWED_ORIGIN or use FRONTEND_URL
    allowed_origin_env = os.getenv('ALLOWED_ORIGIN', '').strip()
    
    if FRONTEND_URL:
        # Production: use FRONTEND_URL
        CORS(app, supports_credentials=True, origins=[FRONTEND_URL])
        logger.info(f"CORS configured for frontend: {FRONTEND_URL}")
    elif allowed_origin_env:
        # Multiple origins from ALLOWED_ORIGIN
        origins = [o.strip() for o in allowed_origin_env.split(',') if o.strip()]
        CORS(app, supports_credentials=True, resources={r"/api/*": {"origins": origins}})
        logger.info(f"CORS configured for origins: {origins}")
    elif flask_env == 'development' or flask_env == '':
        # Local development: allow common localhost origins
        origins = [
            "http://localhost:3000",
            "http://localhost:5500",
            "http://localhost:8000",
            "http://localhost:8080",
            "http://localhost:5000",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:5500",
            "http://127.0.0.1:8000",
            "http://127.0.0.1:8080",
            "http://127.0.0.1:5000",
            "http://localhost",
            "http://127.0.0.1",
        ]
        CORS(app, supports_credentials=True, resources={
            r"/api/*": {
                "origins": origins,
                "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
                "allow_headers": ["Content-Type", "X-Access-Code", "X-Admin-Code", "Authorization"]
            }
        })
        logger.info("CORS configured for local development")
    else:
        # Production defaults: GitHub Pages and custom domain
        origins = [
            "https://favvtech.github.io",
            "https://votingapp.ibaraysas.com",
        ]
        CORS(app, supports_credentials=True, resources={r"/api/*": {"origins": origins}})
        logger.info(f"CORS configured for production origins: {origins}")
    
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
        # phone and country_code are no longer required for login
        phone = (data.get('phone') or '').strip()
        country_code = (data.get('country_code') or '').strip()
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
        if not firstname or not lastname or not access_code or not all([day, month, year]):
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
        
        # Phone not required; keep for backward compatibility if provided
        full_phone = f"{country_code}{phone}" if (country_code and phone) else None
        
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
        """Check if user is logged in - supports both session cookies and header-based auth"""
        # Try session first
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
                        "email": user['email'],
                        "access_code": user['access_code']
                    }
                })
        
        # Fallback: header-based authentication
        code = request.headers.get('X-Access-Code', '').strip()
        if not code:
            auth = request.headers.get('Authorization', '')
            if auth.lower().startswith('bearer '):
                code = auth.split(' ', 1)[1].strip()
        
        if code:
            user = get_user_by_access_code(code)
            if user:
                # Create session for future requests
                session['user_id'] = user['id']
                session['access_code'] = user['access_code']
                session['fullname'] = user['fullname']
                session['phone'] = user['phone']
                session['birthdate'] = user['birthdate']
                return jsonify({
                    "logged_in": True,
                    "user": {
                        "id": user['id'],
                        "fullname": user['fullname'],
                        "phone": user['phone'],
                        "email": user['email'],
                        "access_code": user['access_code']
                    }
                })
        
        return jsonify({"logged_in": False})

    @app.post("/api/logout")
    def logout():
        """Logout user"""
        session.clear()
        return jsonify({"success": True, "message": "Logged out successfully"})

    @app.post("/api/vote")
    def cast_vote():
        """Cast a vote for a nominee in a category; one vote per user per category"""
        user_id = authenticate_request()
        if not user_id:
            return jsonify({"success": False, "message": "Not authenticated"}), 401
        data = request.get_json() or {}
        try:
            category_id = int(data.get('category_id')) if data.get('category_id') is not None else None
            nominee_id = int(data.get('nominee_id')) if data.get('nominee_id') is not None else None
        except (TypeError, ValueError):
            category_id = None
            nominee_id = None

        nominee_name = (data.get('nominee') or data.get('nominee_name') or '').strip()

        if not category_id:
            return jsonify({"success": False, "message": "Invalid category"}), 400

        # Validate nominee against authoritative categories list to eliminate off-by-one errors
        categories = load_categories_data()
        selected = None
        if isinstance(categories, list):
            for c in categories:
                if int(c.get('number', 0)) == int(category_id):
                    selected = c
                    break
        if selected:
            nominees_list = selected.get('nominees') or []
            normalized_nominees = [str(n or '').strip().lower() for n in nominees_list]
            normalized_name = nominee_name.strip().lower() if nominee_name else ''

            # Determine the correct nominee id, prioritizing name-to-index mapping
            if normalized_name:
                try:
                    name_idx = normalized_nominees.index(normalized_name)
                    expected_id = name_idx + 1
                    nominee_id = expected_id
                except ValueError:
                    # Name not found; keep existing id but we'll validate below
                    pass

            if nominee_id:
                idx_from_id = nominee_id - 1
                if idx_from_id < 0 or idx_from_id >= len(nominees_list):
                    # Out of bounds -> attempt to recover via name
                    if normalized_name and normalized_name in normalized_nominees:
                        nominee_id = normalized_nominees.index(normalized_name) + 1
                    else:
                        nominee_id = None
                elif normalized_name and normalized_name and normalized_nominees[idx_from_id] != normalized_name:
                    # Mismatch between provided name and id -> favor the provided name to ensure accuracy
                    if normalized_name in normalized_nominees:
                        nominee_id = normalized_nominees.index(normalized_name) + 1

        if not nominee_id or nominee_id <= 0:
            return jsonify({"success": False, "message": "Invalid nominee"}), 400

        if category_id <= 0:
            return jsonify({"success": False, "message": "Invalid identifiers"}), 400

        conn = get_db()
        cur = conn.cursor()
        try:
            cur.execute(
                "INSERT OR IGNORE INTO votes (user_id, category_id, nominee_id) VALUES (?, ?, ?)",
                (user_id, category_id, nominee_id)
            )
            if cur.rowcount == 0:
                # User already voted in this category
                conn.close()
                return jsonify({"success": False, "message": "You have already voted in this category"}), 409
            conn.commit()
            conn.close()
            return jsonify({"success": True, "message": "Vote recorded"}), 201
        except Exception as e:
            conn.close()
            return jsonify({"success": False, "message": "Failed to record vote"}), 500

    @app.get("/api/categories/<int:category_id>/results")
    def category_results(category_id: int):
        """Return tallies per nominee for a category"""
        try:
            if DATABASE_URL:
                # Use SQLAlchemy for PostgreSQL
                from models import db, Vote
                from sqlalchemy import func
                with app.app_context():
                    results_data = db.session.query(
                        Vote.nominee_id, 
                        func.count(Vote.id).label('votes')
                    ).filter(
                        Vote.category_id == category_id
                    ).group_by(Vote.nominee_id).all()
                    results = [{"nominee_id": r[0], "votes": r[1]} for r in results_data]
                    return jsonify({"category_id": category_id, "results": results})
            else:
                # Use SQLite
                conn = get_db()
                cur = conn.cursor()
                cur.execute(
                    "SELECT nominee_id, COUNT(*) as votes FROM votes WHERE category_id = ? GROUP BY nominee_id",
                    (category_id,)
                )
                rows = cur.fetchall()
                conn.close()
                results = [{"nominee_id": r[0], "votes": r[1]} for r in rows]
                return jsonify({"category_id": category_id, "results": results})
        except Exception as e:
            logger.error(f"Error getting category results: {e}")
            return jsonify({"category_id": category_id, "results": []})

    @app.get("/api/my-votes")
    def my_votes():
        """Return categories the authenticated user has voted in"""
        user_id = authenticate_request()
        if not user_id:
            return jsonify({"success": False, "message": "Not authenticated"}), 401
        conn = get_db()
        cur = conn.cursor()
        cur.execute(
            "SELECT category_id, nominee_id, created_at FROM votes WHERE user_id = ?",
            (user_id,)
        )
        rows = cur.fetchall()
        conn.close()
        votes = [
            {"category_id": r[0], "nominee_id": r[1], "created_at": r[2]}
            for r in rows
        ]
        return jsonify({"success": True, "votes": votes})

    # Admin/Analyst Access Codes
    ADMIN_CODE = "B1E5Z0"  # 3 letters + 3 numbers (mixed)
    ANALYST_CODE = "HANS13"  # 4 letters + 2 numbers
    
    # Database helper - use SQLAlchemy if DATABASE_URL is set, otherwise SQLite
    def get_users_with_votes():
        """Get all users with their votes - works with both PostgreSQL and SQLite"""
        if DATABASE_URL:
            # Use SQLAlchemy for PostgreSQL
            try:
                from models import db, User, Vote
                with app.app_context():
                    users = User.query.order_by(User.created_at.desc()).all()
                    users_with_votes = []
                    for user in users:
                        votes = Vote.query.filter_by(user_id=user.id).all()
                        users_with_votes.append({
                            "id": user.id,
                            "fullname": user.fullname,
                            "email": user.email,
                            "phone": user.phone,
                            "country_code": user.country_code,
                            "access_code": user.access_code,
                            "birthdate": user.birthdate,
                            "created_at": user.created_at.isoformat() if user.created_at else None,
                            "votes": [
                                {
                                    "category_id": vote.category_id,
                                    "nominee_id": vote.nominee_id,
                                    "created_at": vote.created_at.isoformat() if vote.created_at else None
                                }
                                for vote in votes
                            ]
                        })
                    return users_with_votes
            except Exception as e:
                logger.error(f"Error fetching users with SQLAlchemy: {e}")
                return []
        else:
            # Use SQLite
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM users ORDER BY created_at DESC")
            users = cursor.fetchall()
            users_with_votes = []
            for user in users:
                cursor.execute(
                    "SELECT category_id, nominee_id, created_at FROM votes WHERE user_id = ?",
                    (user['id'],)
                )
                votes = cursor.fetchall()
                users_with_votes.append({
                    "id": user['id'],
                    "fullname": user['fullname'],
                    "email": user['email'],
                    "phone": user['phone'],
                    "country_code": user['country_code'],
                    "access_code": user['access_code'],
                    "birthdate": user['birthdate'],
                    "created_at": user['created_at'],
                    "votes": [
                        {
                            "category_id": v[0],
                            "nominee_id": v[1],
                            "created_at": v[2]
                        }
                        for v in votes
                    ]
                })
            conn.close()
            return users_with_votes

    def require_admin():
        """Helper to require admin authentication - supports session and header fallback"""
        # Check session first
        if 'admin_authenticated' in session and session.get('admin_authenticated'):
            role = session.get('admin_role', 'admin')
            if role == 'admin':
                return True
        
        # Header fallback for cross-site cookie issues (production)
        code = (request.headers.get('X-Admin-Code') or '').strip().upper()
        if code == ADMIN_CODE:
            # Set session for future requests
            session['admin_role'] = 'admin'
            session['admin_authenticated'] = True
            return True
        
        return None

    @app.post("/api/admin/login")
    def admin_login():
        """Admin login with access code"""
        data = request.get_json()
        access_code = data.get('access_code', '').strip().upper()
        
        if access_code != ADMIN_CODE:
            return jsonify({"success": False, "message": "Invalid admin access code"}), 403
        
        session['admin_role'] = 'admin'
        session['admin_authenticated'] = True
        
        return jsonify({
            "success": True,
            "message": "Admin login successful",
            "role": "admin"
        })

    @app.post("/api/analyst/login")
    def analyst_login():
        """Analyst login with access code"""
        data = request.get_json()
        access_code = data.get('access_code', '').strip().upper()
        
        if access_code != ANALYST_CODE:
            return jsonify({"success": False, "message": "Invalid analyst access code"}), 403
        
        session['admin_role'] = 'analyst'
        session['admin_authenticated'] = True
        
        return jsonify({
            "success": True,
            "message": "Analyst login successful",
            "role": "analyst"
        })

    @app.get("/api/admin/check-session")
    def admin_check_session():
        """Check if admin/analyst is logged in"""
        if 'admin_authenticated' in session and session.get('admin_authenticated'):
            role = session.get('admin_role', 'admin')
            return jsonify({
                "logged_in": True,
                "role": role
            })
        # Header fallback for cross-site cookie issues: X-Admin-Code
        code = (request.headers.get('X-Admin-Code') or '').strip().upper()
        if code == ADMIN_CODE:
            session['admin_role'] = 'admin'
            session['admin_authenticated'] = True
            return jsonify({"logged_in": True, "role": 'admin'})
        if code == ANALYST_CODE:
            session['admin_role'] = 'analyst'
            session['admin_authenticated'] = True
            return jsonify({"logged_in": True, "role": 'analyst'})
        return jsonify({"logged_in": False})

    @app.post("/api/admin/logout")
    def admin_logout():
        """Logout admin/analyst"""
        session.pop('admin_role', None)
        session.pop('admin_authenticated', None)
        return jsonify({"success": True, "message": "Logged out successfully"})

    @app.post("/api/admin/reset-votes")
    def reset_votes():
        """Admin utility: reset all votes to zero by clearing the votes table"""
        if not require_admin():
            return jsonify({"success": False, "message": "Admin access required"}), 403
        try:
            if DATABASE_URL:
                # Use SQLAlchemy for PostgreSQL
                from models import db, Vote
                with app.app_context():
                    affected = Vote.query.delete()
                    db.session.commit()
                    return jsonify({"success": True, "deleted": affected})
            else:
                # Use SQLite
                conn = get_db()
                cur = conn.cursor()
                cur.execute("DELETE FROM votes")
                affected = cur.rowcount
                conn.commit()
                conn.close()
                return jsonify({"success": True, "deleted": affected})
        except Exception as e:
            logger.error(f"Error resetting votes: {e}")
            return jsonify({"success": False, "message": "Failed to reset votes"}), 500

    @app.get("/api/admin/users")
    def admin_get_users():
        """Get all users with their votes (admin only)"""
        if not require_admin():
            return jsonify({"success": False, "message": "Admin access required"}), 403
        
        try:
            users_with_votes = get_users_with_votes()
            return jsonify({"success": True, "users": users_with_votes})
        except Exception as e:
            logger.error(f"Error getting users: {e}")
            return jsonify({"success": False, "message": "Failed to get users"}), 500

    @app.delete("/api/admin/users/<int:user_id>")
    def admin_delete_user(user_id):
        """Delete a user and all their votes (admin only)"""
        if not require_admin():
            return jsonify({"success": False, "message": "Admin access required"}), 403
        
        conn = get_db()
        cursor = conn.cursor()
        
        try:
            # Delete user's votes first
            cursor.execute("DELETE FROM votes WHERE user_id = ?", (user_id,))
            # Delete user
            cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
            conn.commit()
            conn.close()
            return jsonify({"success": True, "message": "User deleted successfully"})
        except Exception as e:
            conn.close()
            print(f"Error deleting user: {e}")
            return jsonify({"success": False, "message": "Failed to delete user"}), 500

    @app.post("/api/admin/users/<int:user_id>/reset-votes")
    def admin_reset_user_votes(user_id):
        """Reset votes for a specific user (admin only)"""
        if not require_admin():
            return jsonify({"success": False, "message": "Admin access required"}), 403
        
        try:
            if DATABASE_URL:
                # Use SQLAlchemy for PostgreSQL
                from models import db, Vote
                with app.app_context():
                    affected = Vote.query.filter_by(user_id=user_id).delete()
                    db.session.commit()
                    return jsonify({"success": True, "deleted": affected, "message": "User votes reset successfully"})
            else:
                # Use SQLite
                conn = get_db()
                cursor = conn.cursor()
                cursor.execute("DELETE FROM votes WHERE user_id = ?", (user_id,))
                affected = cursor.rowcount
                conn.commit()
                conn.close()
                return jsonify({"success": True, "deleted": affected, "message": "User votes reset successfully"})
        except Exception as e:
            logger.error(f"Error resetting user votes: {e}")
            return jsonify({"success": False, "message": "Failed to reset user votes"}), 500

    @app.post("/api/admin/reset-user-votes-by-code")
    def admin_reset_user_votes_by_code():
        """Reset votes for a user by access code (admin only)"""
        if not require_admin():
            return jsonify({"success": False, "message": "Admin access required"}), 403
        
        data = request.get_json()
        access_code = data.get('access_code', '').strip().upper()
        
        if not access_code:
            return jsonify({"success": False, "message": "Access code is required"}), 400
        
        try:
            if DATABASE_URL:
                # Use SQLAlchemy for PostgreSQL
                from models import db, User, Vote
                with app.app_context():
                    user = User.query.filter_by(access_code=access_code).first()
                    if not user:
                        return jsonify({"success": False, "message": "User not found with this access code"}), 404
                    affected = Vote.query.filter_by(user_id=user.id).delete()
                    db.session.commit()
                    return jsonify({"success": True, "deleted": affected, "message": "User votes reset successfully"})
            else:
                # Use SQLite
                conn = get_db()
                cursor = conn.cursor()
                cursor.execute("SELECT id FROM users WHERE access_code = ?", (access_code,))
                user = cursor.fetchone()
                if not user:
                    conn.close()
                    return jsonify({"success": False, "message": "User not found with this access code"}), 404
                user_id = user['id']
                cursor.execute("DELETE FROM votes WHERE user_id = ?", (user_id,))
                affected = cursor.rowcount
                conn.commit()
                conn.close()
                return jsonify({"success": True, "deleted": affected, "message": "User votes reset successfully"})
        except Exception as e:
            logger.error(f"Error resetting user votes by code: {e}")
            return jsonify({"success": False, "message": "Failed to reset user votes"}), 500

    @app.post("/api/admin/reset-category-votes")
    def admin_reset_category_votes():
        """Reset votes for a specific category by name or number (admin only)"""
        if not require_admin():
            return jsonify({"success": False, "message": "Admin access required"}), 403
        
        data = request.get_json()
        category_input = data.get('category', '').strip()
        
        if not category_input:
            return jsonify({"success": False, "message": "Category name or number is required"}), 400
        
        # Load categories data
        categories_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'categories.js')
        category_id = None
        
        try:
            with open(categories_path, 'r', encoding='utf-8') as f:
                content = f.read()
                # Simple parsing - find category by title or number
                import re
                
                # Try to find by number first
                if category_input.isdigit():
                    pattern = rf'number:\s*{category_input}'
                    if re.search(pattern, content):
                        category_id = int(category_input)
                else:
                    # Find by title (case-insensitive)
                    pattern = rf'title:\s*["\']([^"\']*)["\']'
                    matches = re.findall(pattern, content, re.IGNORECASE)
                    for i, title in enumerate(matches, 1):
                        if title.upper() == category_input.upper():
                            # Find the category number for this title
                            lines = content.split('\n')
                            for j, line in enumerate(lines):
                                if f'title: "{title}"' in line or f"title: '{title}'" in line:
                                    # Look backwards for number
                                    for k in range(j, max(0, j-20), -1):
                                        if 'number:' in lines[k]:
                                            number_match = re.search(r'number:\s*(\d+)', lines[k])
                                            if number_match:
                                                category_id = int(number_match.group(1))
                                                break
                                    break
                            break
        except Exception as e:
            print(f"Error parsing categories: {e}")
            return jsonify({"success": False, "message": "Failed to parse categories"}), 500
        
        if not category_id:
            return jsonify({"success": False, "message": "Category not found"}), 404
        
        try:
            if DATABASE_URL:
                # Use SQLAlchemy for PostgreSQL
                from models import db, Vote
                with app.app_context():
                    affected = Vote.query.filter_by(category_id=category_id).delete()
                    db.session.commit()
                    return jsonify({"success": True, "deleted": affected, "message": f"Category {category_id} votes reset successfully"})
            else:
                # Use SQLite
                conn = get_db()
                cursor = conn.cursor()
                cursor.execute("DELETE FROM votes WHERE category_id = ?", (category_id,))
                affected = cursor.rowcount
                conn.commit()
                conn.close()
                return jsonify({"success": True, "deleted": affected, "message": f"Category {category_id} votes reset successfully"})
        except Exception as e:
            logger.error(f"Error resetting category votes: {e}")
            return jsonify({"success": False, "message": "Failed to reset category votes"}), 500

    @app.get("/api/admin/total-votes")
    def admin_total_votes():
        """Get total vote count (admin/analyst)"""
        # Check session or header fallback
        if 'admin_authenticated' not in session or not session.get('admin_authenticated'):
            code = (request.headers.get('X-Admin-Code') or '').strip().upper()
            if code != ADMIN_CODE and code != ANALYST_CODE:
                return jsonify({"success": False, "message": "Authentication required"}), 403
        
        try:
            if DATABASE_URL:
                # Use SQLAlchemy for PostgreSQL
                from models import db, Vote
                with app.app_context():
                    total = Vote.query.count()
                    return jsonify({"success": True, "total": total})
            else:
                # Use SQLite
                conn = get_db()
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*) FROM votes")
                total = cursor.fetchone()[0]
                conn.close()
                return jsonify({"success": True, "total": total})
        except Exception as e:
            logger.error(f"Error getting total votes: {e}")
            return jsonify({"success": False, "message": "Failed to get total votes"}), 500

    @app.post("/api/admin/birthdates")
    def admin_add_birthdate():
        """Add a new birth date to CSV and JSON files (admin only)"""
        if not require_admin():
            return jsonify({"success": False, "message": "Admin access required"}), 403
        
        data = request.get_json()
        day = data.get('day')
        month = data.get('month')
        year = data.get('year')
        
        if not all([day, month, year]):
            return jsonify({"success": False, "message": "Please provide day, month, and year"}), 400
        
        try:
            day = int(day)
            month = int(month)
            year = int(year)
            
            if not (1 <= day <= 31) or not (1 <= month <= 12) or not (1900 <= year <= 2100):
                return jsonify({"success": False, "message": "Invalid date values"}), 400
            
            formatted_birthdate = format_birthdate(day, month, year)
            
            # Add to JSON file
            json_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'Birth_Dates_Final_Array.json')
            with open(json_path, 'r', encoding='utf-8') as f:
                json_data = json.load(f)
            
            # Check if already exists
            if any(item.get('Birth Date', '').strip() == formatted_birthdate for item in json_data):
                return jsonify({"success": False, "message": "Birth date already exists"}), 409
            
            json_data.append({"Birth Date": formatted_birthdate})
            
            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump(json_data, f, indent=2, ensure_ascii=False)
            
            # Add to CSV file
            csv_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'Birth_Dates_Final.csv')
            with open(csv_path, 'a', encoding='utf-8', newline='') as f:
                f.write(f"\n{formatted_birthdate}")
            
            # Reload birthdates in memory
            load_birthdates()
            
            return jsonify({"success": True, "message": "Birth date added successfully"})
        except Exception as e:
            print(f"Error adding birth date: {e}")
            return jsonify({"success": False, "message": "Failed to add birth date"}), 500

    @app.post("/api/admin/nominees")
    def admin_add_nominee():
        """Add a nominee to a category (admin only)"""
        if not require_admin():
            return jsonify({"success": False, "message": "Admin access required"}), 403
        
        data = request.get_json()
        category_id = data.get('category_id')
        name = data.get('name', '').strip()
        
        if not category_id or not name:
            return jsonify({"success": False, "message": "Please provide category_id and name"}), 400
        
        try:
            # Load categories.js file
            categories_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'categories.js')
            with open(categories_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Find and update the category
            import re
            # This is a simple approach - find the category and add nominee
            # More robust parsing would be needed for production
            category_pattern = f'number: {category_id}'
            if category_pattern not in content:
                return jsonify({"success": False, "message": "Category not found"}), 404
            
            # Add nominee to the nominees array
            # Find the nominees array for this category
            pattern = rf'(number:\s*{category_id}[^}}]*nominees:\s*\[)([^\]]*)(\])'
            match = re.search(pattern, content, re.DOTALL)
            
            if match:
                nominees_content = match.group(2)
                # Add new nominee
                new_content = content[:match.start(2)] + nominees_content.rstrip() + f'\n      "{name}",' + content[match.end(2):]
                
                with open(categories_path, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                
                return jsonify({"success": True, "message": "Nominee added successfully"})
            else:
                return jsonify({"success": False, "message": "Could not update category"}), 500
        except Exception as e:
            print(f"Error adding nominee: {e}")
            return jsonify({"success": False, "message": "Failed to add nominee"}), 500

    @app.delete("/api/admin/nominees")
    def admin_remove_nominee():
        """Remove a nominee from a category (admin only)"""
        if not require_admin():
            return jsonify({"success": False, "message": "Admin access required"}), 403
        
        data = request.get_json()
        category_id = data.get('category_id')
        nominee_index = data.get('nominee_index')
        
        if category_id is None or nominee_index is None:
            return jsonify({"success": False, "message": "Please provide category_id and nominee_index"}), 400
        
        try:
            # Load categories.js file
            categories_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'categories.js')
            with open(categories_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Find the category and remove the nominee
            import re
            # This is a simplified approach - find nominees array and remove the index
            pattern = rf'(number:\s*{category_id}[^}}]*nominees:\s*\[)([^\]]*)(\])'
            match = re.search(pattern, content, re.DOTALL)
            
            if match:
                nominees_content = match.group(2)
                nominees_lines = [line.strip() for line in nominees_content.split('\n') if line.strip() and not line.strip().startswith('//')]
                # Filter out empty lines and extract nominee names
                nominees_list = []
                for line in nominees_lines:
                    line = line.strip().rstrip(',').strip('"').strip("'")
                    if line:
                        nominees_list.append(line)
                
                if 0 <= nominee_index < len(nominees_list):
                    nominees_list.pop(nominee_index)
                    # Rebuild nominees array
                    new_nominees = ',\n      '.join(f'"{n}"' for n in nominees_list)
                    new_content = content[:match.start(2)] + f'\n      {new_nominees}\n    ' + content[match.end(2):]
                    
                    with open(categories_path, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    
                    # Also delete votes for this nominee
                    conn = get_db()
                    cursor = conn.cursor()
                    cursor.execute(
                        "DELETE FROM votes WHERE category_id = ? AND nominee_id = ?",
                        (category_id, nominee_index + 1)  # nominee_id is 1-based
                    )
                    conn.commit()
                    conn.close()
                    
                    return jsonify({"success": True, "message": "Nominee removed successfully"})
                else:
                    return jsonify({"success": False, "message": "Invalid nominee index"}), 400
            else:
                return jsonify({"success": False, "message": "Category not found"}), 404
        except Exception as e:
            print(f"Error removing nominee: {e}")
            return jsonify({"success": False, "message": "Failed to remove nominee"}), 500

    return app


app = create_app()

if __name__ == "__main__":
    # Use PORT from environment (Render provides this) or default to 5000
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=True, host='0.0.0.0', port=port)


