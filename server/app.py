import os
import csv
import json
import sqlite3
import secrets
import string
import logging
from functools import lru_cache
from datetime import datetime, timedelta
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

def normalize_name(value: str) -> str:
    """Normalize names for comparison (case-insensitive, trimmed)."""
    if value is None:
        return ''
    return ' '.join(str(value).strip().lower().split())

def normalize_phone(value: str) -> str:
    """Normalize Nigerian phone numbers to +234XXXXXXXXXX format."""
    if value is None:
        return ''
    digits = ''.join(ch for ch in str(value) if ch.isdigit())
    if not digits:
        return ''
    if digits.startswith('234') and len(digits) > 10:
        digits = digits[3:]
    if digits.startswith('0') and len(digits) > 10:
        digits = digits[1:]
    if len(digits) > 10:
        digits = digits[-10:]
    if len(digits) == 11 and digits.startswith('0'):
        digits = digits[1:]
    if len(digits) > 10:
        digits = digits[-10:]
    if len(digits) == 9:
        digits = digits.rjust(10, '0')
    if len(digits) != 10:
        logger.warning(f"Unexpected phone length after normalization: {value} -> {digits}")
        digits = digits[-10:].rjust(10, '0')
    return '+234' + digits

@lru_cache(maxsize=1)
def get_event_registration_records() -> List[dict]:
    """Load event registration users from JSON file and cache the result."""
    path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'event_registration_users.json'))
    try:
        with open(path, 'r', encoding='utf-8') as f:
            raw_records = json.load(f)
    except FileNotFoundError:
        logger.warning(f"Event registration file not found at {path}")
        return []
    except Exception as exc:
        logger.error(f"Failed to load event registration users: {exc}", exc_info=True)
        return []

    records: List[dict] = []
    for entry in raw_records:
        first = (entry.get('first_name') or '').strip()
        last = (entry.get('last_name') or '').strip()
        phone = entry.get('phone')
        phone_normalized = normalize_phone(phone)
        first_norm = normalize_name(first)
        last_norm = normalize_name(last)
        if not first_norm or not last_norm or not phone_normalized:
            continue
        records.append({
            "first_name": first,
            "last_name": last,
            "phone": phone_normalized,
            "first_norm": first_norm,
            "last_norm": last_norm,
            "phone_norm": phone_normalized
        })
    logger.info(f"Loaded {len(records)} event registration records from {path}")
    return records

def find_event_registration_entry(first_name: str, last_name: str, phone: str) -> Optional[dict]:
    """Find event registration entry matching first name, last name, and phone."""
    first_norm = normalize_name(first_name)
    last_norm = normalize_name(last_name)
    phone_norm = normalize_phone(phone)
    if not (first_norm and last_norm and phone_norm):
        return None
    for record in get_event_registration_records():
        if (
            record["first_norm"] == first_norm
            and record["last_norm"] == last_norm
            and record["phone_norm"] == phone_norm
        ):
            return record
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

# authenticate_request is now defined inside create_app() as authenticate_request_helper()

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
        logger.warning("⚠ DATABASE_URL not found in environment.")
    else:
        logger.info(f"✅ DATABASE_URL detected: {DATABASE_URL[:40]}...")
    
    SECRET_KEY = os.getenv("SECRET_KEY") or os.getenv("FLASK_SECRET", "dev-secret-key-change-in-production")
    FRONTEND_URL = os.getenv("FRONTEND_URL")
    FORCE_HTTPS = os.getenv("FORCE_HTTPS", "0")
    flask_env = os.getenv('FLASK_ENV', '').lower()
    is_production = flask_env == 'production' or bool(DATABASE_URL)
    
    app = Flask(__name__)
    app.secret_key = SECRET_KEY
    
    # Store DATABASE_URL in app config for access in routes
    app.config['DATABASE_URL'] = DATABASE_URL
    app.config['USE_POSTGRESQL'] = bool(DATABASE_URL)
    # Voting session state - defaults to True (active)
    app.config['VOTING_ACTIVE'] = True
    
    # Database configuration
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
            logger.info("✅ SQLAlchemy configured with PostgreSQL")
        except Exception as e:
            logger.error(f"❌ Failed to configure SQLAlchemy: {e}")
            logger.warning("⚠ Falling back to SQLite")
            app.config['USE_POSTGRESQL'] = False
    else:
        # Fallback to SQLite for local development
        logger.info("ℹ Using SQLite for local development")
        app.config['USE_POSTGRESQL'] = False
    
    # Session cookie configuration
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax" if not is_production else "None"
    app.config["SESSION_COOKIE_SECURE"] = True if (FORCE_HTTPS == "1" or is_production) else False
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_PATH"] = "/"
    # Set session lifetime (31 days for permanent sessions)
    app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=31)
    # Don't set SESSION_COOKIE_DOMAIN - let Flask use default (None) for cross-domain cookies
    # When domain is None, cookie is set for the exact domain that sent it (Render domain)
    # This allows cross-domain cookies to work with SameSite=None and Secure=True
    
    # CORS configuration
    # Accept comma-separated origins in ALLOWED_ORIGIN or use FRONTEND_URL
    allowed_origin_env = os.getenv('ALLOWED_ORIGIN', '').strip()
    
    if FRONTEND_URL:
        # Production: use FRONTEND_URL
        CORS(app, supports_credentials=True, resources={
            r"/api/*": {
                "origins": [FRONTEND_URL],
                "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
                "allow_headers": ["Content-Type", "X-Access-Code", "X-Admin-Code", "Authorization", "Cache-Control", "Pragma"]
            }
        })
        logger.info(f"CORS configured for frontend: {FRONTEND_URL}")
    elif allowed_origin_env:
        # Multiple origins from ALLOWED_ORIGIN
        origins = [o.strip() for o in allowed_origin_env.split(',') if o.strip()]
        CORS(app, supports_credentials=True, resources={
            r"/api/*": {
                "origins": origins,
                "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
                "allow_headers": ["Content-Type", "X-Access-Code", "X-Admin-Code", "Authorization", "Cache-Control", "Pragma"]
            }
        })
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
                "allow_headers": ["Content-Type", "X-Access-Code", "X-Admin-Code", "Authorization", "Cache-Control", "Pragma"]
            }
        })
        logger.info("CORS configured for local development")
    else:
        # Production defaults: GitHub Pages and custom domain
        origins = [
            "https://favvtech.github.io",
            "https://votingapp.ibaraysas.com",
        ]
        CORS(app, supports_credentials=True, resources={
            r"/api/*": {
                "origins": origins,
                "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
                "allow_headers": ["Content-Type", "X-Access-Code", "X-Admin-Code", "Authorization", "Cache-Control", "Pragma"]
            }
        })
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
        firstname = (data.get('firstname') or '').strip()
        lastname = (data.get('lastname') or '').strip()
        phone_raw = (data.get('phone') or '').strip()
        country_code_input = (data.get('country_code') or '+234').strip() or '+234'
        email = (data.get('email') or '').strip()
        email = email if email else None
        day = data.get('day')
        month = data.get('month')
        year = data.get('year')
        
        fullname = f"{firstname} {lastname}".strip()
        
        if not firstname or not lastname or not phone_raw or not all([day, month, year]):
            return jsonify({"success": False, "message": "Please fill all required fields"}), 400
        
        try:
            day = int(day)
            month = int(month)
            year = int(year)
            formatted_birthdate = format_birthdate(day, month, year)
        except (ValueError, TypeError):
            return jsonify({"success": False, "message": "Invalid date format"}), 400
        
        if email and '@' not in email:
            return jsonify({"success": False, "message": "Please enter a valid email address"}), 400
        
        normalized_phone = normalize_phone(f"{country_code_input}{phone_raw}")
        if not normalized_phone:
            return jsonify({"success": False, "message": "Invalid phone number"}), 400
        
        registration_entry = find_event_registration_entry(firstname, lastname, normalized_phone)
        if not registration_entry:
            return jsonify({
                "success": False,
                "message": "You cant create an account on this platform. Please Contact The Admin For Assistance."
            }), 403
        
        use_postgresql = app.config.get('USE_POSTGRESQL', False)
        try:
            if use_postgresql:
                from models import db, User
                from sqlalchemy import func
                
                max_suffix_result = db.session.query(func.max(User.birthdate_suffix)).filter(
                    User.birthdate == formatted_birthdate
                ).scalar()
                birthdate_suffix = (max_suffix_result or 0) + 1
                
                phone_exists = User.query.filter_by(phone=normalized_phone).first()
                if phone_exists:
                    return jsonify({"success": False, "message": "This phone number is already registered. Login To Continue."}), 409
                
                access_code = generate_access_code_helper()
                
                new_user = User(
                    fullname=fullname,
                    phone=normalized_phone,
                    country_code='+234',
                    email=email,
                    birthdate=formatted_birthdate,
                    birthdate_suffix=birthdate_suffix,
                    access_code=access_code
                )
                db.session.add(new_user)
                db.session.commit()
                user_id = new_user.id
                
                logger.info(f"✅ User created in PostgreSQL: ID={user_id}, Name={fullname}, Code={access_code}")
            else:
                conn = get_db()
                cursor = conn.cursor()
                
                cursor.execute(
                    "SELECT MAX(birthdate_suffix) FROM users WHERE birthdate = ?",
                    (formatted_birthdate,)
                )
                max_suffix = cursor.fetchone()[0]
                birthdate_suffix = (max_suffix or 0) + 1
                
                cursor.execute("SELECT id FROM users WHERE phone = ?", (normalized_phone,))
                if cursor.fetchone():
                    conn.close()
                    return jsonify({"success": False, "message": "This phone number is already registered. Login To Continue."}), 409
                
                access_code = generate_access_code_helper()
                
                cursor.execute(
                    "INSERT INTO users (fullname, phone, country_code, email, birthdate, birthdate_suffix, access_code) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (fullname, normalized_phone, '+234', email, formatted_birthdate, birthdate_suffix, access_code)
                )
                user_id = cursor.lastrowid
                conn.commit()
                conn.close()
                
                logger.info(f"✅ User created in SQLite: ID={user_id}, Name={fullname}, Code={access_code}")
            
            session['user_id'] = user_id
            session['phone'] = normalized_phone
            session['fullname'] = fullname
            session['birthdate'] = formatted_birthdate
            session['access_code'] = access_code
            
            # Explicitly save session to ensure cookie is set
            session.permanent = True
            
            response = jsonify({
                "success": True,
                "message": "Account created successfully",
                "user": {
                    "id": user_id,
                    "fullname": fullname,
                    "phone": normalized_phone,
                    "email": email,
                    "access_code": access_code
                }
            })
            
            # Ensure session cookie is set in response
            # Flask should handle this automatically, but we ensure it's explicit
            return response
        except Exception as e:
            logger.error(f"❌ Error creating account: {e}", exc_info=True)
            if use_postgresql:
                try:
                    from models import db
                    db.session.rollback()
                except:
                    pass
            return jsonify({"success": False, "message": f"Error creating account: {str(e)}"}), 500

    @app.post("/api/login")
    def login():
        """Login existing user"""
        data = request.get_json()
        firstname = (data.get('firstname') or '').strip()
        lastname = (data.get('lastname') or '').strip()
        access_code = (data.get('access_code') or '').strip().upper()
        
        fullname = f"{firstname} {lastname}".strip()
        
        if not firstname or not lastname or not access_code:
            return jsonify({"success": False, "message": "Please fill all required fields"}), 400
        
        fullname_normalized = normalize_name(fullname)
        use_postgresql = app.config.get('USE_POSTGRESQL', False)
        
        try:
            if use_postgresql:
                from models import db, User
                
                user = User.query.filter(
                    db.func.lower(db.func.trim(User.fullname)) == fullname_normalized
                ).first()
                
                if not user:
                    return jsonify({
                        "success": False,
                        "message": "Sign up for an account"
                    }), 404
                
                if user.access_code != access_code:
                    return jsonify({
                        "success": False,
                        "message": "Invalid access code. Please check your access code."
                    }), 403
                
                user_dict = {
                    'id': user.id,
                    'phone': user.phone,
                    'fullname': user.fullname,
                    'birthdate': user.birthdate,
                    'access_code': user.access_code,
                    'email': user.email
                }
                logger.info(f"✅ User logged in from PostgreSQL: ID={user.id}, Name={user.fullname}")
            else:
                conn = get_db()
                cursor = conn.cursor()
                
                cursor.execute(
                    "SELECT * FROM users WHERE LOWER(TRIM(fullname)) = ?",
                    (fullname_normalized,)
                )
                user = cursor.fetchone()
                
                if not user:
                    conn.close()
                    return jsonify({
                        "success": False,
                        "message": "Sign up for an account"
                    }), 404
                
                if user['access_code'] != access_code:
                    conn.close()
                    return jsonify({
                        "success": False,
                        "message": "Invalid access code. Please check your access code."
                    }), 403
                
                user_dict = dict(user)
                conn.close()
                logger.info(f"✅ User logged in from SQLite: ID={user_dict['id']}, Name={user_dict['fullname']}")
            
            # Create session
            session['user_id'] = user_dict['id']
            session['phone'] = user_dict['phone']
            session['fullname'] = user_dict['fullname']
            session['birthdate'] = user_dict.get('birthdate')
            session['access_code'] = user_dict['access_code']
            
            # Explicitly save session to ensure cookie is set
            session.permanent = True
            
            response = jsonify({
                "success": True,
                "message": "Login successful",
                "user": {
                    "id": user_dict['id'],
                    "fullname": user_dict['fullname'],
                    "phone": user_dict['phone'],
                    "email": user_dict.get('email'),
                    "access_code": user_dict['access_code']
                }
            })
            
            # Ensure session cookie is set in response
            return response
        except Exception as e:
            logger.error(f"❌ Error during login: {e}", exc_info=True)
            return jsonify({"success": False, "message": f"Login failed: {str(e)}"}), 500

    @app.get("/api/check-session")
    def check_session():
        """Check if user is logged in - supports both session cookies and header-based auth"""
        # Try session first
        if 'user_id' in session:
            use_postgresql = app.config.get('USE_POSTGRESQL', False)
            try:
                if use_postgresql:
                    # Use SQLAlchemy for PostgreSQL
                    from models import db, User
                    user = User.query.filter_by(id=session['user_id']).first()
                    if user:
                        return jsonify({
                            "logged_in": True,
                            "user": {
                                "id": user.id,
                                "fullname": user.fullname,
                                "phone": user.phone,
                                "email": user.email,
                                "access_code": user.access_code
                            }
                        })
                else:
                    # Use SQLite
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
            except Exception as e:
                logger.error(f"❌ Error checking session: {e}", exc_info=True)
        
        # Fallback: header-based authentication
        code = request.headers.get('X-Access-Code', '').strip()
        if not code:
            auth = request.headers.get('Authorization', '')
            if auth.lower().startswith('bearer '):
                code = auth.split(' ', 1)[1].strip()
        
        if code:
            user = get_user_by_access_code_helper(code)
            if user:
                # Create session for future requests
                session['user_id'] = user['id']
                session['access_code'] = user['access_code']
                session['fullname'] = user['fullname']
                session['phone'] = user['phone']
                session['birthdate'] = user['birthdate']
                session.permanent = True  # Ensure session cookie is set
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
        response = jsonify({"success": True, "message": "Logged out successfully"})
        # Prevent caching of logout response and protect against back-button
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response

    @app.post("/api/vote")
    def cast_vote():
        """Cast a vote for a nominee in a category; one vote per user per category"""
        # CRITICAL: Check voting status FIRST before any other processing
        # This prevents any race conditions or rapid-click bypasses
        if not app.config.get('VOTING_ACTIVE', True):
            return jsonify({"success": False, "message": "Voting session is closed."}), 403
        
        # Authenticate user
        user_id = authenticate_request_helper()
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

        use_postgresql = app.config.get('USE_POSTGRESQL', False)
        try:
            if use_postgresql:
                # Use SQLAlchemy for PostgreSQL
                from models import db, Vote
                # Check if vote already exists
                existing = Vote.query.filter_by(user_id=user_id, category_id=category_id).first()
                if existing:
                    return jsonify({"success": False, "message": "You have already voted in this category"}), 409
                # Create new vote
                new_vote = Vote(user_id=user_id, category_id=category_id, nominee_id=nominee_id)
                db.session.add(new_vote)
                db.session.commit()
                logger.info(f"✅ Vote recorded: user {user_id}, category {category_id}, nominee {nominee_id}")
                return jsonify({"success": True, "message": "Vote recorded"}), 201
            else:
                # Use SQLite
                conn = get_db()
                cur = conn.cursor()
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
                logger.info(f"✅ Vote recorded: user {user_id}, category {category_id}, nominee {nominee_id}")
                return jsonify({"success": True, "message": "Vote recorded"}), 201
        except Exception as e:
            logger.error(f"❌ Error recording vote: {e}", exc_info=True)
            if use_postgresql:
                try:
                    from models import db
                    db.session.rollback()
                except:
                    pass
            return jsonify({"success": False, "message": f"Failed to record vote: {str(e)}"}), 500

    @app.get("/api/categories/<int:category_id>/results")
    def category_results(category_id: int):
        """Return tallies per nominee for a category"""
        try:
            use_postgresql = app.config.get('USE_POSTGRESQL', False)
            if use_postgresql:
                # Use SQLAlchemy for PostgreSQL
                from models import db, Vote
                from sqlalchemy import func
                results_data = db.session.query(
                    Vote.nominee_id, 
                    func.count(Vote.id).label('votes')
                ).filter(
                    Vote.category_id == category_id
                ).group_by(Vote.nominee_id).all()
                results = [{"nominee_id": r[0], "votes": r[1]} for r in results_data]
                logger.debug(f"✅ Category {category_id} results from PostgreSQL: {len(results)} nominees")
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
                logger.debug(f"✅ Category {category_id} results from SQLite: {len(results)} nominees")
                return jsonify({"category_id": category_id, "results": results})
        except Exception as e:
            logger.error(f"❌ Error getting category results: {e}", exc_info=True)
            return jsonify({"category_id": category_id, "results": []})

    @app.get("/api/my-votes")
    def my_votes():
        """Return categories the authenticated user has voted in"""
        user_id = authenticate_request_helper()
        if not user_id:
            return jsonify({"success": False, "message": "Not authenticated"}), 401
        
        try:
            use_postgresql = app.config.get('USE_POSTGRESQL', False)
            if use_postgresql:
                # Use SQLAlchemy for PostgreSQL
                from models import db, Vote
                votes_query = Vote.query.filter_by(user_id=user_id).all()
                votes = [
                    {
                        "category_id": vote.category_id,
                        "nominee_id": vote.nominee_id,
                        "created_at": vote.created_at.isoformat() if vote.created_at else None
                    }
                    for vote in votes_query
                ]
                return jsonify({"success": True, "votes": votes})
            else:
                # Use SQLite
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
        except Exception as e:
            logger.error(f"❌ Error getting user votes: {e}", exc_info=True)
            return jsonify({"success": False, "message": "Failed to get votes"}), 500

    # Admin/Analyst Access Codes
    ADMIN_CODE = "B1E5Z0"  # 3 letters + 3 numbers (mixed)
    ANALYST_CODE = "HANS13"  # 4 letters + 2 numbers
    
    # Database helper functions - use SQLAlchemy if PostgreSQL is configured, otherwise SQLite
    def get_user_by_access_code_helper(code: str):
        """Get user by access code - works with both PostgreSQL and SQLite"""
        if not code:
            return None
        use_postgresql = app.config.get('USE_POSTGRESQL', False)
        if use_postgresql:
            from models import db, User
            user = User.query.filter_by(access_code=code.strip().upper()).first()
            if user:
                return {
                    'id': user.id,
                    'fullname': user.fullname,
                    'phone': user.phone,
                    'country_code': user.country_code,
                    'email': user.email,
                    'birthdate': user.birthdate,
                    'access_code': user.access_code,
                    'created_at': user.created_at.isoformat() if user.created_at else None
                }
            return None
        else:
            conn = get_db()
            cur = conn.cursor()
            cur.execute("SELECT * FROM users WHERE access_code = ?", (code.strip().upper(),))
            user = cur.fetchone()
            conn.close()
            return dict(user) if user else None
    
    def generate_access_code_helper() -> str:
        """Generate a unique 6-character access code: 4 letters + 2 numbers"""
        letters = string.ascii_uppercase
        digits = string.digits
        use_postgresql = app.config.get('USE_POSTGRESQL', False)
        while True:
            # Generate 4 random letters
            letter_part = ''.join(secrets.choice(letters) for _ in range(4))
            # Generate 2 random numbers
            number_part = ''.join(secrets.choice(digits) for _ in range(2))
            # Combine: 4 letters + 2 numbers
            code = letter_part + number_part
            # Check if code already exists
            if use_postgresql:
                from models import db, User
                existing = User.query.filter_by(access_code=code).first()
                if not existing:
                    return code
            else:
                conn = get_db()
                cursor = conn.cursor()
                cursor.execute("SELECT id FROM users WHERE access_code = ?", (code,))
                if not cursor.fetchone():
                    conn.close()
                    return code
                conn.close()
    
    def get_users_with_votes():
        """Get all users with their votes - works with both PostgreSQL and SQLite"""
        use_postgresql = app.config.get('USE_POSTGRESQL', False)
        
        if use_postgresql:
            # Use SQLAlchemy for PostgreSQL
            try:
                from models import db, User, Vote
                users = User.query.order_by(User.created_at.desc()).all()
                users_with_votes = []
                for user in users:
                    votes = Vote.query.filter_by(user_id=user.id).all()
                    users_with_votes.append({
                        "id": user.id,
                        "fullname": user.fullname,
                        "email": user.email or None,
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
                logger.info(f"✅ Retrieved {len(users_with_votes)} users with votes from PostgreSQL")
                return users_with_votes
            except Exception as e:
                logger.error(f"❌ Error fetching users with SQLAlchemy: {e}", exc_info=True)
                return []
        else:
            # Use SQLite
            try:
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
                logger.info(f"✅ Retrieved {len(users_with_votes)} users with votes from SQLite")
                return users_with_votes
            except Exception as e:
                logger.error(f"❌ Error fetching users with SQLite: {e}", exc_info=True)
                return []

    def authenticate_request_helper() -> Optional[int]:
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
            user = get_user_by_access_code_helper(code)
            if user:
                # optionally attach a lightweight session
                session['user_id'] = user['id']
                session['access_code'] = user['access_code']
                session['fullname'] = user['fullname']
                session['phone'] = user['phone']
                session['birthdate'] = user['birthdate']
                session.permanent = True  # Ensure session cookie is set
                return int(user['id'])
        return None

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

    def require_analyst():
        """Helper to require analyst authentication - supports session and header fallback"""
        # Check session first
        if 'admin_authenticated' in session and session.get('admin_authenticated'):
            role = session.get('admin_role', 'analyst')
            if role == 'analyst':
                return True
        
        # Header fallback for cross-site cookie issues (production)
        code = (request.headers.get('X-Admin-Code') or '').strip().upper()
        if code == ANALYST_CODE:
            # Set session for future requests
            session['admin_role'] = 'analyst'
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
        
        # Explicitly save session to ensure cookie is set
        session.permanent = True
        
        response = jsonify({
            "success": True,
            "message": "Admin login successful",
            "role": "admin"
        })
        
        return response

    @app.post("/api/analyst/login")
    def analyst_login():
        """Analyst login with access code"""
        data = request.get_json()
        access_code = data.get('access_code', '').strip().upper()
        
        if access_code != ANALYST_CODE:
            return jsonify({"success": False, "message": "Invalid analyst access code"}), 403
        
        session['admin_role'] = 'analyst'
        session['admin_authenticated'] = True
        
        # Explicitly save session to ensure cookie is set
        session.permanent = True
        
        response = jsonify({
            "success": True,
            "message": "Analyst login successful",
            "role": "analyst"
        })
        
        return response

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
        code_header = request.headers.get('X-Admin-Code', '').strip().upper()
        if code_header:
            logger.info(f"Header fallback check: received code '{code_header}'")
            if code_header == ADMIN_CODE:
                session['admin_role'] = 'admin'
                session['admin_authenticated'] = True
                session.permanent = True  # Ensure session cookie is set
                logger.info("Header fallback: Admin authenticated")
                return jsonify({"logged_in": True, "role": 'admin'})
            if code_header == ANALYST_CODE:
                session['admin_role'] = 'analyst'
                session['admin_authenticated'] = True
                session.permanent = True  # Ensure session cookie is set
                logger.info("Header fallback: Analyst authenticated")
                return jsonify({"logged_in": True, "role": 'analyst'})
            logger.warning(f"Header fallback: Invalid code '{code_header}'")
        
        logger.info("Session check: Not logged in")
        return jsonify({"logged_in": False})

    @app.post("/api/admin/logout")
    def admin_logout():
        """Logout admin/analyst"""
        session.pop('admin_role', None)
        session.pop('admin_authenticated', None)
        response = jsonify({"success": True, "message": "Logged out successfully"})
        # Prevent caching of logout response and protect against back-button
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response

    @app.get("/api/admin/voting-status")
    def get_voting_status():
        """Get current voting session status (admin only)"""
        if not require_admin():
            return jsonify({"success": False, "message": "Admin access required"}), 403
        return jsonify({
            "success": True,
            "voting_active": app.config.get('VOTING_ACTIVE', True)
        })
    
    @app.post("/api/admin/voting-status")
    def set_voting_status():
        """Set voting session status (admin only)"""
        if not require_admin():
            return jsonify({"success": False, "message": "Admin access required"}), 403
        data = request.get_json() or {}
        voting_active = data.get('voting_active', True)
        app.config['VOTING_ACTIVE'] = bool(voting_active)
        logger.info(f"✅ Voting session {'activated' if voting_active else 'deactivated'} by admin")
        return jsonify({
            "success": True,
            "voting_active": app.config['VOTING_ACTIVE'],
            "message": f"Voting session {'activated' if voting_active else 'deactivated'}"
        })
    
    @app.get("/api/voting-status")
    def public_voting_status():
        """Get current voting session status (public endpoint for user UI)"""
        return jsonify({
            "success": True,
            "voting_active": app.config.get('VOTING_ACTIVE', True)
        })

    @app.post("/api/admin/reset-votes")
    def reset_votes():
        """Admin utility: reset all votes to zero by clearing the votes table"""
        logger.info(f"📥 Reset votes request received from {request.remote_addr}")
        # Check admin authentication with logging
        admin_check = require_admin()
        if not admin_check:
            logger.warning(f"❌ Reset votes: Admin access denied. Session: {session.get('admin_authenticated')}, Role: {session.get('admin_role')}, Header: {request.headers.get('X-Admin-Code', 'not provided')}")
            return jsonify({"success": False, "message": "Admin access required"}), 403
        try:
            use_postgresql = app.config.get('USE_POSTGRESQL', False)
            if use_postgresql:
                # Use SQLAlchemy for PostgreSQL
                from models import db, Vote
                affected = Vote.query.delete()
                db.session.commit()
                logger.info(f"✅ Reset {affected} votes from PostgreSQL")
                return jsonify({"success": True, "deleted": affected})
            else:
                # Use SQLite
                conn = get_db()
                cur = conn.cursor()
                cur.execute("DELETE FROM votes")
                affected = cur.rowcount
                conn.commit()
                conn.close()
                logger.info(f"✅ Reset {affected} votes from SQLite")
                return jsonify({"success": True, "deleted": affected})
        except Exception as e:
            logger.error(f"❌ Error resetting votes: {e}", exc_info=True)
            return jsonify({"success": False, "message": f"Failed to reset votes: {str(e)}"}), 500

    @app.get("/api/admin/users")
    def admin_get_users():
        """Get all users with their votes (admin and analyst)"""
        if not require_admin() and not require_analyst():
            return jsonify({"success": False, "message": "Admin or analyst access required"}), 403
        
        try:
            use_postgresql = app.config.get('USE_POSTGRESQL', False)
            logger.info(f"🔍 Admin get_users: use_postgresql={use_postgresql}, DATABASE_URL={'set' if app.config.get('DATABASE_URL') else 'not set'}")
            
            users_with_votes = get_users_with_votes()
            logger.info(f"✅ Admin get_users: Returning {len(users_with_votes)} users")
            
            # Log first user details for debugging
            if users_with_votes and len(users_with_votes) > 0:
                first_user = users_with_votes[0]
                logger.info(f"📊 Sample user: ID={first_user.get('id')}, Name={first_user.get('fullname')}, Votes={len(first_user.get('votes', []))}")
            
            return jsonify({"success": True, "users": users_with_votes})
        except Exception as e:
            logger.error(f"❌ Error getting users: {e}", exc_info=True)
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return jsonify({"success": False, "message": f"Failed to get users: {str(e)}"}), 500

    @app.delete("/api/admin/users/<int:user_id>")
    def admin_delete_user(user_id):
        """Delete a user and all their votes (admin only)"""
        if not require_admin():
            return jsonify({"success": False, "message": "Admin access required"}), 403
        
        use_postgresql = app.config.get('USE_POSTGRESQL', False)
        try:
            if use_postgresql:
                # Use SQLAlchemy for PostgreSQL
                from models import db, User, Vote
                # Delete user's votes first
                Vote.query.filter_by(user_id=user_id).delete()
                # Delete user
                User.query.filter_by(id=user_id).delete()
                db.session.commit()
                logger.info(f"✅ Deleted user {user_id} and their votes from PostgreSQL")
                return jsonify({"success": True, "message": "User deleted successfully"})
            else:
                # Use SQLite
                conn = get_db()
                cursor = conn.cursor()
                # Delete user's votes first
                cursor.execute("DELETE FROM votes WHERE user_id = ?", (user_id,))
                # Delete user
                cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
                conn.commit()
                conn.close()
                logger.info(f"✅ Deleted user {user_id} and their votes from SQLite")
                return jsonify({"success": True, "message": "User deleted successfully"})
        except Exception as e:
            logger.error(f"❌ Error deleting user: {e}", exc_info=True)
            if use_postgresql:
                try:
                    from models import db
                    db.session.rollback()
                except:
                    pass
            return jsonify({"success": False, "message": f"Failed to delete user: {str(e)}"}), 500

    @app.post("/api/admin/users/<int:user_id>/reset-votes")
    def admin_reset_user_votes(user_id):
        """Reset votes for a specific user (admin only)"""
        if not require_admin():
            return jsonify({"success": False, "message": "Admin access required"}), 403
        
        try:
            use_postgresql = app.config.get('USE_POSTGRESQL', False)
            if use_postgresql:
                # Use SQLAlchemy for PostgreSQL
                from models import db, Vote
                affected = Vote.query.filter_by(user_id=user_id).delete()
                db.session.commit()
                logger.info(f"✅ Reset {affected} votes for user {user_id} from PostgreSQL")
                return jsonify({"success": True, "deleted": affected, "message": "User votes reset successfully"})
            else:
                # Use SQLite
                conn = get_db()
                cursor = conn.cursor()
                cursor.execute("DELETE FROM votes WHERE user_id = ?", (user_id,))
                affected = cursor.rowcount
                conn.commit()
                conn.close()
                logger.info(f"✅ Reset {affected} votes for user {user_id} from SQLite")
                return jsonify({"success": True, "deleted": affected, "message": "User votes reset successfully"})
        except Exception as e:
            logger.error(f"❌ Error resetting user votes: {e}", exc_info=True)
            return jsonify({"success": False, "message": f"Failed to reset user votes: {str(e)}"}), 500

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
            use_postgresql = app.config.get('USE_POSTGRESQL', False)
            if use_postgresql:
                # Use SQLAlchemy for PostgreSQL
                from models import db, User, Vote
                user = User.query.filter_by(access_code=access_code).first()
                if not user:
                    return jsonify({"success": False, "message": "User not found with this access code"}), 404
                affected = Vote.query.filter_by(user_id=user.id).delete()
                db.session.commit()
                logger.info(f"✅ Reset {affected} votes for user {user.id} (code: {access_code}) from PostgreSQL")
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
                logger.info(f"✅ Reset {affected} votes for user {user_id} (code: {access_code}) from SQLite")
                return jsonify({"success": True, "deleted": affected, "message": "User votes reset successfully"})
        except Exception as e:
            logger.error(f"❌ Error resetting user votes by code: {e}", exc_info=True)
            return jsonify({"success": False, "message": f"Failed to reset user votes: {str(e)}"}), 500

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
            use_postgresql = app.config.get('USE_POSTGRESQL', False)
            if use_postgresql:
                # Use SQLAlchemy for PostgreSQL
                from models import db, Vote
                affected = Vote.query.filter_by(category_id=category_id).delete()
                db.session.commit()
                logger.info(f"✅ Reset {affected} votes for category {category_id} from PostgreSQL")
                return jsonify({"success": True, "deleted": affected, "message": f"Category {category_id} votes reset successfully"})
            else:
                # Use SQLite
                conn = get_db()
                cursor = conn.cursor()
                cursor.execute("DELETE FROM votes WHERE category_id = ?", (category_id,))
                affected = cursor.rowcount
                conn.commit()
                conn.close()
                logger.info(f"✅ Reset {affected} votes for category {category_id} from SQLite")
                return jsonify({"success": True, "deleted": affected, "message": f"Category {category_id} votes reset successfully"})
        except Exception as e:
            logger.error(f"❌ Error resetting category votes: {e}", exc_info=True)
            return jsonify({"success": False, "message": f"Failed to reset category votes: {str(e)}"}), 500

    @app.get("/api/admin/total-votes")
    def admin_total_votes():
        """Get total vote count (admin/analyst)"""
        # Check session or header fallback
        if 'admin_authenticated' not in session or not session.get('admin_authenticated'):
            code = (request.headers.get('X-Admin-Code') or '').strip().upper()
            if code != ADMIN_CODE and code != ANALYST_CODE:
                return jsonify({"success": False, "message": "Authentication required"}), 403
        
        try:
            use_postgresql = app.config.get('USE_POSTGRESQL', False)
            logger.info(f"🔍 Admin total_votes: use_postgresql={use_postgresql}")
            
            if use_postgresql:
                # Use SQLAlchemy for PostgreSQL
                from models import db, Vote
                total = Vote.query.count()
                logger.info(f"✅ Total votes from PostgreSQL: {total}")
                return jsonify({"success": True, "total": total})
            else:
                # Use SQLite
                conn = get_db()
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*) FROM votes")
                total = cursor.fetchone()[0]
                conn.close()
                logger.info(f"✅ Total votes from SQLite: {total}")
                return jsonify({"success": True, "total": total})
        except Exception as e:
            logger.error(f"❌ Error getting total votes: {e}", exc_info=True)
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return jsonify({"success": False, "message": f"Failed to get total votes: {str(e)}"}), 500

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

    @app.post("/api/admin/event-registration-users")
    def admin_add_event_registration_user():
        """Add a new event registration user entry (admin only)"""
        if not require_admin():
            return jsonify({"success": False, "message": "Admin access required"}), 403

        data = request.get_json() or {}
        first_name = (data.get('first_name') or '').strip()
        last_name = (data.get('last_name') or '').strip()
        phone_input = (data.get('phone') or '').strip()

        if not first_name or not last_name or not phone_input:
            return jsonify({"success": False, "message": "Please provide first name, last name, and phone number"}), 400

        normalized_phone = normalize_phone(phone_input)
        if not normalized_phone:
            return jsonify({"success": False, "message": "Invalid phone number"}), 400

        first_norm = normalize_name(first_name)
        last_norm = normalize_name(last_name)
        phone_norm = normalized_phone

        existing_records = get_event_registration_records()
        if any(rec["phone_norm"] == phone_norm for rec in existing_records):
            return jsonify({"success": False, "message": "Phone number already exists in registration list"}), 409

        if any(rec["first_norm"] == first_norm and rec["last_norm"] == last_norm for rec in existing_records):
            return jsonify({"success": False, "message": "A registration entry for this name already exists"}), 409

        payload_entry = {
            "first_name": first_name,
            "last_name": last_name,
            "phone": normalized_phone
        }

        json_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'event_registration_users.json'))
        csv_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'event_registration_users.csv'))

        try:
            # Update JSON file
            json_records = []
            if os.path.exists(json_path) and os.path.getsize(json_path) > 0:
                with open(json_path, 'r', encoding='utf-8') as jf:
                    try:
                        json_records = json.load(jf)
                    except json.JSONDecodeError:
                        json_records = []

            json_records.append(payload_entry)
            with open(json_path, 'w', encoding='utf-8') as jf:
                json.dump(json_records, jf, ensure_ascii=False, indent=2)

            # Update CSV file
            write_header = not os.path.exists(csv_path) or os.path.getsize(csv_path) == 0
            with open(csv_path, 'a', newline='', encoding='utf-8') as cf:
                writer = csv.writer(cf)
                if write_header:
                    writer.writerow(["first_name", "last_name", "phone"])
                writer.writerow([first_name, last_name, normalized_phone])

            # Refresh cached records
            get_event_registration_records.cache_clear()

            logger.info("✅ Added event registration user via admin: %s %s (%s)", first_name, last_name, normalized_phone)
            return jsonify({"success": True, "message": "Registration record added successfully"})
        except Exception as exc:
            logger.error("❌ Failed to add event registration user: %s", exc, exc_info=True)
            return jsonify({"success": False, "message": "Failed to add registration record"}), 500

    @app.post("/api/admin/event-registration-users/delete")
    def admin_delete_event_registration_user():
        """Delete an event registration user entry and their account if it exists (admin only)"""
        if not require_admin():
            return jsonify({"success": False, "message": "Admin access required"}), 403

        data = request.get_json() or {}
        first_name = (data.get('first_name') or '').strip()
        last_name = (data.get('last_name') or '').strip()
        phone_input = (data.get('phone') or '').strip()

        if not first_name or not last_name or not phone_input:
            return jsonify({"success": False, "message": "Please provide first name, last name, and phone number"}), 400

        normalized_phone = normalize_phone(phone_input)
        if not normalized_phone:
            return jsonify({"success": False, "message": "Invalid phone number"}), 400

        first_norm = normalize_name(first_name)
        last_norm = normalize_name(last_name)
        phone_norm = normalized_phone

        json_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'event_registration_users.json'))
        csv_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'event_registration_users.csv'))

        try:
            # Remove from JSON file
            json_records = []
            found_in_json = False
            if os.path.exists(json_path) and os.path.getsize(json_path) > 0:
                with open(json_path, 'r', encoding='utf-8') as jf:
                    try:
                        json_records = json.load(jf)
                    except json.JSONDecodeError:
                        json_records = []
                
                # Filter out the matching record
                original_count = len(json_records)
                json_records = [
                    rec for rec in json_records
                    if not (
                        rec.get("phone", "").strip() == phone_norm or
                        (normalize_name(rec.get("first_name", "").strip()) == first_norm and
                         normalize_name(rec.get("last_name", "").strip()) == last_norm)
                    )
                ]
                found_in_json = len(json_records) < original_count
                
                with open(json_path, 'w', encoding='utf-8') as jf:
                    json.dump(json_records, jf, ensure_ascii=False, indent=2)

            # Remove from CSV file
            found_in_csv = False
            if os.path.exists(csv_path) and os.path.getsize(csv_path) > 0:
                rows = []
                with open(csv_path, 'r', encoding='utf-8', newline='') as cf:
                    reader = csv.reader(cf)
                    header = next(reader, None)
                    if header:
                        rows.append(header)
                    for row in reader:
                        if len(row) >= 3:
                            row_phone = normalize_phone(row[2].strip()) if row[2] else ""
                            row_first = normalize_name(row[0].strip()) if row[0] else ""
                            row_last = normalize_name(row[1].strip()) if row[1] else ""
                            if not (
                                row_phone == phone_norm or
                                (row_first == first_norm and row_last == last_norm)
                            ):
                                rows.append(row)
                            else:
                                found_in_csv = True
                        else:
                            rows.append(row)
                
                with open(csv_path, 'w', encoding='utf-8', newline='') as cf:
                    writer = csv.writer(cf)
                    writer.writerows(rows)

            # Delete user account from database if it exists
            account_deleted = False
            use_postgresql = app.config.get('USE_POSTGRESQL', False)
            if use_postgresql:
                from models import db, User
                user = User.query.filter_by(phone=phone_norm).first()
                if not user:
                    # Try by name match
                    user = User.query.filter(
                        db.func.lower(User.firstname) == first_norm.lower(),
                        db.func.lower(User.lastname) == last_norm.lower()
                    ).first()
                if user:
                    # Delete user's votes first
                    from models import Vote
                    Vote.query.filter_by(user_id=user.id).delete()
                    db.session.delete(user)
                    db.session.commit()
                    account_deleted = True
                    logger.info(f"✅ Deleted user account from PostgreSQL: {user.firstname} {user.lastname} ({phone_norm})")
            else:
                # SQLite
                conn = get_db()
                cur = conn.cursor()
                # Find user by phone or name
                cur.execute("SELECT id FROM users WHERE phone = ?", (phone_norm,))
                user_row = cur.fetchone()
                if not user_row:
                    cur.execute("SELECT id FROM users WHERE LOWER(firstname) = LOWER(?) AND LOWER(lastname) = LOWER(?)", 
                               (first_name, last_name))
                    user_row = cur.fetchone()
                if user_row:
                    user_id = user_row[0]
                    # Delete votes
                    cur.execute("DELETE FROM votes WHERE user_id = ?", (user_id,))
                    # Delete user
                    cur.execute("DELETE FROM users WHERE id = ?", (user_id,))
                    conn.commit()
                    account_deleted = True
                    logger.info(f"✅ Deleted user account from SQLite: ID {user_id} ({phone_norm})")
                conn.close()

            # Refresh cached records
            get_event_registration_records.cache_clear()

            if not found_in_json and not found_in_csv:
                return jsonify({"success": False, "message": "User does not exist"}), 404

            message = "Registration record deleted successfully"
            if account_deleted:
                message += " and user account removed"
            
            logger.info(f"✅ Deleted event registration user: {first_name} {last_name} ({phone_norm})")
            return jsonify({"success": True, "message": message})
        except Exception as exc:
            logger.error(f"❌ Failed to delete event registration user: {exc}", exc_info=True)
            return jsonify({"success": False, "message": "Failed to delete registration record"}), 500

    @app.get("/api/admin/event-registration-users/count")
    def admin_get_event_registration_users_count():
        """Get total count of event registration users (admin and analyst)"""
        if not require_admin() and not require_analyst():
            return jsonify({"success": False, "message": "Admin or analyst access required"}), 403
        
        try:
            records = get_event_registration_records()
            return jsonify({"success": True, "count": len(records)})
        except Exception as e:
            logger.error(f"❌ Error getting registration users count: {e}", exc_info=True)
            return jsonify({"success": False, "message": "Failed to get user count"}), 500

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


