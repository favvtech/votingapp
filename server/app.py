import os
import csv
import json
import sqlite3
import secrets
import string
import logging
import time
import tempfile
from datetime import datetime, timedelta
from typing import List, Set, Optional, Callable, Any
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
    
    # Sessions table: DB-backed session storage
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            data TEXT,
            last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)')
    
    # Voting config table: persistent voting session toggle
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS voting_config (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL DEFAULT 'voting_active',
            value TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_by TEXT
        )
    ''')
    # Initialize voting_active to True if not exists
    cursor.execute('''
        INSERT OR IGNORE INTO voting_config (key, value, updated_by) 
        VALUES ('voting_active', 'true', 'system')
    ''')
    
    # User states table: client-side state persistence
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_states (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE NOT NULL,
            state_json TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_user_states_user_id ON user_states(user_id)')
    
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

def load_registration_json_records(json_path: str) -> List[dict]:
    """Read raw registration records from JSON file."""
    if not os.path.exists(json_path) or os.path.getsize(json_path) == 0:
        return []
    try:
        with open(json_path, 'r', encoding='utf-8') as jf:
            data = json.load(jf)
            if isinstance(data, list):
                return data
            logger.warning("Registration JSON is not a list. Resetting to empty list.")
            return []
    except json.JSONDecodeError as exc:
        logger.error(f"Unable to parse registration JSON: {exc}", exc_info=True)
        return []
    except Exception as exc:
        logger.error(f"Error reading registration JSON: {exc}", exc_info=True)
        return []

def sanitize_registration_records(records: List[dict]) -> List[dict]:
    """Ensure registration records have trimmed names and normalized phone numbers."""
    sanitized: List[dict] = []
    seen_keys = set()
    for entry in records:
        if not isinstance(entry, dict):
            continue
        first = (entry.get('first_name') or '').strip()
        last = (entry.get('last_name') or '').strip()
        phone_value = entry.get('phone') or entry.get('phone_norm') or ''
        if not (first and last and phone_value):
            continue
        normalized_phone = normalize_phone(phone_value)
        if not normalized_phone:
            normalized_phone = str(phone_value).strip()
        uniq_key = (normalize_name(first), normalize_name(last), normalized_phone)
        if uniq_key in seen_keys:
            continue
        seen_keys.add(uniq_key)
        sanitized.append({
            "first_name": first,
            "last_name": last,
            "phone": normalized_phone
        })
    return sanitized

def atomic_write_json(path: str, payload: List[dict]) -> None:
    """Write JSON payload atomically to avoid partial writes."""
    dir_path = os.path.dirname(path) or '.'
    os.makedirs(dir_path, exist_ok=True)
    tmp_name = None
    try:
        with tempfile.NamedTemporaryFile('w', delete=False, dir=dir_path, encoding='utf-8') as tmp_file:
            json.dump(payload, tmp_file, ensure_ascii=False, indent=2)
            tmp_file.flush()
            os.fsync(tmp_file.fileno())
            tmp_name = tmp_file.name
        os.replace(tmp_name, path)
    finally:
        if tmp_name and os.path.exists(tmp_name):
            try:
                os.remove(tmp_name)
            except OSError:
                pass

def atomic_write_registration_csv(path: str, records: List[dict]) -> None:
    """Rewrite the CSV file using the provided registration records."""
    dir_path = os.path.dirname(path) or '.'
    os.makedirs(dir_path, exist_ok=True)
    tmp_name = None
    try:
        with tempfile.NamedTemporaryFile('w', delete=False, dir=dir_path, encoding='utf-8', newline='') as tmp_file:
            writer = csv.writer(tmp_file)
            writer.writerow(["first_name", "last_name", "phone"])
            for entry in records:
                writer.writerow([
                    (entry.get('first_name') or '').strip(),
                    (entry.get('last_name') or '').strip(),
                    (entry.get('phone') or '').strip()
                ])
            tmp_file.flush()
            os.fsync(tmp_file.fileno())
            tmp_name = tmp_file.name
        os.replace(tmp_name, path)
    finally:
        if tmp_name and os.path.exists(tmp_name):
            try:
                os.remove(tmp_name)
            except OSError:
                pass

def persist_registration_records(records: List[dict], json_path: str, csv_path: str) -> List[dict]:
    """Save registration records to both JSON and CSV atomically."""
    sanitized = sanitize_registration_records(records)
    atomic_write_json(json_path, sanitized)
    atomic_write_registration_csv(csv_path, sanitized)
    return sanitized
def get_event_registration_records() -> List[dict]:
    """Always load event registration users from JSON file (avoids stale caches)."""
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

def retry_db_operation(operation: Callable, max_retries: int = 3, delay: float = 0.5) -> Any:
    """
    Retry a database operation with exponential backoff.
    Handles PostgreSQL SSL connection errors and other transient database errors.
    """
    last_exception = None
    for attempt in range(max_retries):
        try:
            return operation()
        except Exception as e:
            last_exception = e
            error_str = str(e).lower()
            
            # Check if it's a retryable error (SSL errors, connection errors)
            is_retryable = (
                'ssl' in error_str or
                'connection' in error_str or
                'eof' in error_str or
                'operationalerror' in error_str or
                'timeout' in error_str
            )
            
            if not is_retryable or attempt == max_retries - 1:
                # Not retryable or last attempt, raise the exception
                raise
            
            # Wait before retrying (exponential backoff)
            wait_time = delay * (2 ** attempt)
            logger.warning(f"⚠️ Database operation failed (attempt {attempt + 1}/{max_retries}): {e}. Retrying in {wait_time}s...")
            time.sleep(wait_time)
    
    # Should never reach here, but just in case
    if last_exception:
        raise last_exception

# Helper functions for DB-backed sessions and voting config
def get_voting_active_from_db(use_postgresql: bool) -> bool:
    """Get voting_active status from database (persistent across restarts)"""
    try:
        if use_postgresql:
            from models import db, VotingConfig
            config = VotingConfig.query.filter_by(key='voting_active').first()
            if config:
                return config.value.lower() == 'true'
            # Initialize if not exists
            config = VotingConfig(key='voting_active', value='true', updated_by='system')
            db.session.add(config)
            db.session.commit()
            return True
        else:
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT value FROM voting_config WHERE key = 'voting_active'")
            row = cursor.fetchone()
            conn.close()
            if row:
                return row[0].lower() == 'true'
            # Initialize if not exists
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute(
                "INSERT OR IGNORE INTO voting_config (key, value, updated_by) VALUES ('voting_active', 'true', 'system')"
            )
            conn.commit()
            conn.close()
            return True
    except Exception as e:
        logger.error(f"Error getting voting_active from DB: {e}", exc_info=True)
        return True  # Default to active on error

def set_voting_active_in_db(use_postgresql: bool, active: bool, updated_by: str = 'admin') -> bool:
    """Set voting_active status in database atomically"""
    try:
        value = 'true' if active else 'false'
        if use_postgresql:
            from models import db, VotingConfig
            config = VotingConfig.query.filter_by(key='voting_active').first()
            if config:
                config.value = value
                config.updated_by = updated_by
            else:
                config = VotingConfig(key='voting_active', value=value, updated_by=updated_by)
                db.session.add(config)
            db.session.commit()
            return True
        else:
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute(
                "INSERT OR REPLACE INTO voting_config (key, value, updated_by, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
                ('voting_active', value, updated_by)
            )
            conn.commit()
            conn.close()
            return True
    except Exception as e:
        logger.error(f"Error setting voting_active in DB: {e}", exc_info=True)
        return False

def save_session_to_db(use_postgresql: bool, session_id: str, user_id: int, session_data: dict, expires_at: datetime) -> bool:
    """Save session to database for persistence"""
    try:
        import json
        data_json = json.dumps(session_data) if session_data else None
        if use_postgresql:
            from models import db, Session
            
            def save_session():
                db.session.expire_all()
                db_session = Session.query.filter_by(id=session_id).first()
                if db_session:
                    db_session.user_id = user_id
                    db_session.data = data_json
                    db_session.last_active = datetime.utcnow()
                    db_session.expires_at = expires_at
                else:
                    db_session = Session(
                        id=session_id,
                        user_id=user_id,
                        data=data_json,
                        expires_at=expires_at
                    )
                    db.session.add(db_session)
                db.session.commit()
                return True
            
            # Use retry logic for PostgreSQL to handle SSL connection issues
            return retry_db_operation(save_session, max_retries=2, delay=0.3)
        else:
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute(
                """INSERT OR REPLACE INTO sessions (id, user_id, data, last_active, expires_at) 
                   VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)""",
                (session_id, user_id, data_json, expires_at.isoformat())
            )
            conn.commit()
            conn.close()
            return True
    except Exception as e:
        logger.error(f"Error saving session to DB: {e}", exc_info=True)
        # Don't fail signup/login if session save fails - it's not critical
        return False

def get_session_from_db(use_postgresql: bool, session_id: str) -> Optional[dict]:
    """Get session from database and check if valid"""
    try:
        if use_postgresql:
            from models import db, Session
            db_session = Session.query.filter_by(id=session_id).first()
            if not db_session:
                return None
            # Check if expired
            if datetime.utcnow() > db_session.expires_at:
                # Delete expired session
                db.session.delete(db_session)
                db.session.commit()
                return None
            # Update last_active
            db_session.last_active = datetime.utcnow()
            db.session.commit()
            import json
            data = json.loads(db_session.data) if db_session.data else {}
            return {
                'user_id': db_session.user_id,
                'data': data,
                'last_active': db_session.last_active
            }
        else:
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute(
                "SELECT user_id, data, last_active, expires_at FROM sessions WHERE id = ?",
                (session_id,)
            )
            row = cursor.fetchone()
            if not row:
                conn.close()
                return None
            # Check if expired
            expires_at = datetime.fromisoformat(row[3]) if isinstance(row[3], str) else row[3]
            if datetime.utcnow() > expires_at:
                cursor.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
                conn.commit()
                conn.close()
                return None
            # Update last_active
            cursor.execute(
                "UPDATE sessions SET last_active = CURRENT_TIMESTAMP WHERE id = ?",
                (session_id,)
            )
            conn.commit()
            conn.close()
            import json
            data = json.loads(row[1]) if row[1] else {}
            return {
                'user_id': row[0],
                'data': data,
                'last_active': row[2]
            }
    except Exception as e:
        logger.error(f"Error getting session from DB: {e}", exc_info=True)
        return None

def delete_session_from_db(use_postgresql: bool, session_id: str) -> bool:
    """Delete session from database"""
    try:
        if use_postgresql:
            from models import db, Session
            Session.query.filter_by(id=session_id).delete()
            db.session.commit()
            return True
        else:
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            conn.commit()
            conn.close()
            return True
    except Exception as e:
        logger.error(f"Error deleting session from DB: {e}", exc_info=True)
        return False

def cleanup_expired_sessions(use_postgresql: bool) -> int:
    """Clean up expired sessions (call periodically)"""
    try:
        if use_postgresql:
            from models import db, Session
            expired = Session.query.filter(Session.expires_at < datetime.utcnow()).all()
            count = len(expired)
            for s in expired:
                db.session.delete(s)
            db.session.commit()
            return count
        else:
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP")
            count = cursor.rowcount
            conn.commit()
            conn.close()
            return count
    except Exception as e:
        logger.error(f"Error cleaning up expired sessions: {e}", exc_info=True)
        return 0

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
    # Voting session state will be loaded from DB after init_db
    
    # Database configuration
    # If DATABASE_URL is set (PostgreSQL), configure SQLAlchemy
    # Otherwise, use existing SQLite implementation (get_db function)
    if DATABASE_URL:
        try:
            from models import db
            # Convert postgres:// to postgresql:// for SQLAlchemy
            db_url = DATABASE_URL.replace('postgres://', 'postgresql://', 1)
            
            # Add SSL mode and connection pool settings for Render PostgreSQL
            # This prevents SSL connection drops and handles connection timeouts
            if 'sslmode' not in db_url.lower():
                # Add sslmode=require if not already present
                separator = '&' if '?' in db_url else '?'
                db_url = f"{db_url}{separator}sslmode=require"
            
            app.config["SQLALCHEMY_DATABASE_URI"] = db_url
            app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
            
            # Connection pool settings to handle Render PostgreSQL SSL issues
            app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
                "pool_pre_ping": True,  # Test connections before using them
                "pool_recycle": 300,     # Recycle connections after 5 minutes
                "pool_size": 5,          # Maintain 5 connections in pool
                "max_overflow": 10,      # Allow up to 10 overflow connections
                "connect_args": {
                    "connect_timeout": 10,  # 10 second connection timeout
                    "sslmode": "require"    # Require SSL
                }
            }
            
            db.init_app(app)
            logger.info("✅ SQLAlchemy configured with PostgreSQL (with connection pool settings)")
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
    
    # CORS configuration - CRITICAL: Must allow all necessary origins
    # Accept comma-separated origins in ALLOWED_ORIGIN or use FRONTEND_URL
    allowed_origin_env = os.getenv('ALLOWED_ORIGIN', '').strip()
    
    # Build list of allowed origins
    if FRONTEND_URL:
        # Production: use FRONTEND_URL + common GitHub Pages patterns
        origins = [FRONTEND_URL]
        # Also allow common GitHub Pages patterns
        if 'github.io' in FRONTEND_URL:
            # Extract base GitHub Pages domain
            base_domain = FRONTEND_URL.split('/')[2] if '/' in FRONTEND_URL else FRONTEND_URL
            origins.append(f"https://{base_domain}")
        origins.append("https://favvtech.github.io")
        origins.append("https://votingapp.ibaraysas.com")
    elif allowed_origin_env:
        # Multiple origins from ALLOWED_ORIGIN
        origins = [o.strip() for o in allowed_origin_env.split(',') if o.strip()]
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
    else:
        # Production defaults: GitHub Pages and custom domain
        origins = [
            "https://favvtech.github.io",
            "https://votingapp.ibaraysas.com",
        ]
    
    # Configure CORS for ALL routes (not just /api/*) to ensure health check works
    CORS(app, 
         supports_credentials=True, 
         origins=origins,
         methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
         allow_headers=["Content-Type", "X-Access-Code", "X-Admin-Code", "Authorization", "Cache-Control", "Pragma"],
         expose_headers=["Content-Type"],
         max_age=3600)
    logger.info(f"✅ CORS configured for origins: {origins}")
    
    # Load birthdates and initialize database on startup
    load_birthdates()
    init_db()
    
    # Initialize voting_active from DB (persistent across restarts)
    # Must be done within app context for database access
    with app.app_context():
        use_postgresql = app.config.get('USE_POSTGRESQL', False)
        app.config['VOTING_ACTIVE'] = get_voting_active_from_db(use_postgresql)
        logger.info(f"✅ Voting session initialized from DB: {'active' if app.config['VOTING_ACTIVE'] else 'inactive'}")
        
        # Clean up expired sessions on startup (within app context)
        try:
            cleaned = cleanup_expired_sessions(use_postgresql)
            if cleaned > 0:
                logger.info(f"✅ Cleaned up {cleaned} expired sessions on startup")
        except Exception as e:
            logger.warning(f"⚠ Could not clean up expired sessions on startup: {e}")
            # Non-critical error, continue startup

    # Add request logging middleware
    @app.before_request
    def log_request_info():
        """Log incoming requests for debugging"""
        logger.info(f"📥 {request.method} {request.path} from {request.origin or request.remote_addr}")
        if request.method in ['POST', 'PUT']:
            try:
                data = request.get_json(silent=True)
                if data:
                    # Log request data but mask sensitive fields
                    safe_data = {k: ('***' if k in ['access_code', 'password', 'phone'] else v) 
                               for k, v in data.items()}
                    logger.debug(f"Request data: {safe_data}")
            except:
                pass

    # Add global error handlers
    @app.errorhandler(500)
    def internal_error(error):
        """Handle 500 errors"""
        logger.error(f"❌ Internal server error: {error}", exc_info=True)
        return jsonify({
            "success": False,
            "message": "Internal server error. Please try again later."
        }), 500

    @app.errorhandler(404)
    def not_found(error):
        """Handle 404 errors"""
        logger.warning(f"⚠ 404 Not Found: {request.path}")
        return jsonify({
            "success": False,
            "message": "Endpoint not found"
        }), 404

    @app.errorhandler(Exception)
    def handle_exception(e):
        """Handle all unhandled exceptions"""
        logger.error(f"❌ Unhandled exception: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "message": f"An error occurred: {str(e)}"
        }), 500

    @app.get("/api/health")
    def health_check():
        """Health check endpoint to verify backend is running"""
        try:
            # Quick database connectivity check if PostgreSQL is configured
            use_postgresql = app.config.get('USE_POSTGRESQL', False)
            db_status = "unknown"
            if use_postgresql:
                try:
                    from models import db
                    db.session.execute(db.text("SELECT 1"))
                    db_status = "connected"
                except Exception as e:
                    db_status = f"error: {str(e)[:50]}"
            
            return jsonify({
                "status": "ok",
                "message": "Backend is running",
                "database": db_status,
                "timestamp": datetime.utcnow().isoformat()
            }), 200
        except Exception as e:
            logger.error(f"Health check error: {e}")
            return jsonify({
                "status": "error",
                "message": str(e),
                "timestamp": datetime.utcnow().isoformat()
            }), 500

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
        try:
            data = request.get_json()
            if not data:
                return jsonify({"success": False, "message": "Invalid request data"}), 400
        except Exception as e:
            logger.error(f"Error parsing signup request: {e}")
            return jsonify({"success": False, "message": "Invalid request format"}), 400
        
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
                
                # Retry database operations with exponential backoff for SSL connection issues
                def get_max_suffix():
                    db.session.expire_all()
                    return db.session.query(func.max(User.birthdate_suffix)).filter(
                        User.birthdate == formatted_birthdate
                    ).scalar()
                
                max_suffix_result = retry_db_operation(get_max_suffix, max_retries=2, delay=0.3)
                birthdate_suffix = (max_suffix_result or 0) + 1
                
                def check_phone():
                    db.session.expire_all()
                    return User.query.filter_by(phone=normalized_phone).first()
                
                phone_exists = retry_db_operation(check_phone, max_retries=2, delay=0.3)
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
                
                # Retry commit operation
                def commit_user():
                    db.session.commit()
                    return new_user.id
                
                user_id = retry_db_operation(commit_user, max_retries=2, delay=0.3)
                
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
            
            # Create DB-backed session
            session_id = secrets.token_urlsafe(32)
            expires_at = datetime.utcnow() + timedelta(days=31)
            session_data = {
                'user_id': user_id,
                'access_code': access_code,
                'fullname': fullname,
                'phone': normalized_phone,
                'birthdate': formatted_birthdate
            }
            save_session_to_db(use_postgresql, session_id, user_id, session_data, expires_at)
            
            # Create Flask session
            session['_id'] = session_id
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
            
            # CRITICAL: Explicitly set session cookie headers to ensure it's sent
            # This is especially important for cross-domain cookies
            response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
            response.headers['Pragma'] = 'no-cache'
            
            # Ensure session cookie is set in response
            return response
        except Exception as e:
            logger.error(f"❌ Error creating account: {e}", exc_info=True)
            if use_postgresql:
                try:
                    from models import db
                    db.session.rollback()
                except:
                    pass
            
            # Provide user-friendly error message
            error_str = str(e).lower()
            if 'ssl' in error_str or 'connection' in error_str or 'eof' in error_str:
                return jsonify({
                    "success": False,
                    "message": "Database connection error. Your account may have been created. Please try logging in."
                }), 500
            else:
                return jsonify({"success": False, "message": f"Error creating account: {str(e)}"}), 500

    @app.post("/api/login")
    def login():
        """Login existing user"""
        try:
            data = request.get_json()
            if not data:
                return jsonify({"success": False, "message": "Invalid request data"}), 400
        except Exception as e:
            logger.error(f"Error parsing login request: {e}")
            return jsonify({"success": False, "message": "Invalid request format"}), 400
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
                
                # Retry database query with exponential backoff for SSL connection issues
                def query_user():
                    # Refresh session to ensure we have a fresh connection
                    db.session.expire_all()
                    return User.query.filter(
                        db.func.lower(db.func.trim(User.fullname)) == fullname_normalized
                    ).first()
                
                user = retry_db_operation(query_user, max_retries=2, delay=0.3)
                
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
            
            # Create DB-backed session
            session_id = secrets.token_urlsafe(32)
            expires_at = datetime.utcnow() + timedelta(days=31)
            session_data = {
                'user_id': user_dict['id'],
                'access_code': user_dict['access_code'],
                'fullname': user_dict['fullname'],
                'phone': user_dict['phone'],
                'birthdate': user_dict.get('birthdate')
            }
            save_session_to_db(use_postgresql, session_id, user_dict['id'], session_data, expires_at)
            
            # Create Flask session
            session['_id'] = session_id
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
            
            # CRITICAL: Explicitly set session cookie headers to ensure it's sent
            # This is especially important for cross-domain cookies
            response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
            response.headers['Pragma'] = 'no-cache'
            
            # Ensure session cookie is set in response
            return response
        except Exception as e:
            logger.error(f"❌ Error during login: {e}", exc_info=True)
            use_postgresql = app.config.get('USE_POSTGRESQL', False)
            if use_postgresql:
                try:
                    from models import db
                    db.session.rollback()
                except:
                    pass
            
            # Provide user-friendly error message
            error_str = str(e).lower()
            if 'ssl' in error_str or 'connection' in error_str or 'eof' in error_str:
                return jsonify({
                    "success": False,
                    "message": "Database connection error. Please try again in a moment."
                }), 500
            else:
                return jsonify({"success": False, "message": f"Login failed: {str(e)}"}), 500

    @app.get("/api/check-session")
    def check_session():
        """Check if user is logged in - uses DB-backed sessions"""
        try:
            user_id = authenticate_request_helper()
            if not user_id:
                response = jsonify({"logged_in": False})
                response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
                response.headers['Pragma'] = 'no-cache'
                return response
            
            # Get user details
            use_postgresql = app.config.get('USE_POSTGRESQL', False)
            if use_postgresql:
                from models import db, User
                user = User.query.filter_by(id=user_id).first()
                if not user:
                    response = jsonify({"logged_in": False})
                    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
                    response.headers['Pragma'] = 'no-cache'
                    return response
                user_dict = user.to_dict()
            else:
                conn = get_db()
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
                user = cursor.fetchone()
                conn.close()
                if not user:
                    response = jsonify({"logged_in": False})
                    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
                    response.headers['Pragma'] = 'no-cache'
                    return response
                user_dict = dict(user)
            
            response = jsonify({
                "logged_in": True,
                "user": {
                    "id": user_dict['id'],
                    "fullname": user_dict['fullname'],
                    "phone": user_dict.get('phone'),
                    "email": user_dict.get('email'),
                    "access_code": user_dict.get('access_code')
                }
            })
            response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
            response.headers['Pragma'] = 'no-cache'
            return response
        except Exception as e:
            logger.error(f"Error checking session: {e}", exc_info=True)
            # On error, return not authenticated (never return 500 for auth checks)
            response = jsonify({"logged_in": False, "error": "Server error"})
            response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
            response.headers['Pragma'] = 'no-cache'
            return response

    @app.post("/api/logout")
    def logout():
        """Logout user - invalidate DB session"""
        session_id = session.get('_id') or session.get('session_id')
        if session_id:
            use_postgresql = app.config.get('USE_POSTGRESQL', False)
            delete_session_from_db(use_postgresql, session_id)
        session.clear()
        response = jsonify({"success": True, "message": "Logged out successfully"})
        # Prevent caching of logout response and protect against back-button
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response

    @app.get("/auth/session")
    def check_auth_session():
        """Check if user is authenticated - returns { authenticated: true/false, user: {...} }"""
        try:
            user_id = authenticate_request_helper()
            if not user_id:
                response = jsonify({"authenticated": False})
                response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
                response.headers['Pragma'] = 'no-cache'
                return response
            
            # Get user details
            use_postgresql = app.config.get('USE_POSTGRESQL', False)
            if use_postgresql:
                from models import db, User
                user = User.query.filter_by(id=user_id).first()
                if not user:
                    response = jsonify({"authenticated": False})
                    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
                    response.headers['Pragma'] = 'no-cache'
                    return response
                user_dict = user.to_dict()
            else:
                conn = get_db()
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
                user = cursor.fetchone()
                conn.close()
                if not user:
                    response = jsonify({"authenticated": False})
                    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
                    response.headers['Pragma'] = 'no-cache'
                    return response
                user_dict = dict(user)
            
            response = jsonify({
                "authenticated": True,
                "user": {
                    "id": user_dict['id'],
                    "fullname": user_dict['fullname'],
                    "phone": user_dict.get('phone'),
                    "email": user_dict.get('email')
                }
            })
            response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
            response.headers['Pragma'] = 'no-cache'
            return response
        except Exception as e:
            logger.error(f"Error checking auth session: {e}", exc_info=True)
            response = jsonify({"authenticated": False, "error": "Server error"})
            response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
            response.headers['Pragma'] = 'no-cache'
            return response
    
    @app.get("/user/access-code")
    def get_user_access_code():
        """Get logged-in user's access code (only if authenticated)"""
        user_id = authenticate_request_helper()
        if not user_id:
            return jsonify({"success": False, "message": "Not authenticated"}), 401
        
        use_postgresql = app.config.get('USE_POSTGRESQL', False)
        try:
            if use_postgresql:
                from models import db, User
                user = User.query.filter_by(id=user_id).first()
                if not user:
                    return jsonify({"success": False, "message": "User not found"}), 404
                return jsonify({"success": True, "access_code": user.access_code})
            else:
                conn = get_db()
                cursor = conn.cursor()
                cursor.execute("SELECT access_code FROM users WHERE id = ?", (user_id,))
                row = cursor.fetchone()
                conn.close()
                if not row:
                    return jsonify({"success": False, "message": "User not found"}), 404
                return jsonify({"success": True, "access_code": row[0]})
        except Exception as e:
            logger.error(f"Error getting access code: {e}", exc_info=True)
            return jsonify({"success": False, "message": "Server error"}), 500
    
    @app.get("/get_access_code")
    def get_access_code():
        """Get access code endpoint - supports Bearer token or session/auth header"""
        # Support Bearer token from Authorization header
        auth_header = request.headers.get('Authorization', '')
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header.split(' ', 1)[1].strip()
            # If token is an access code, use it to authenticate
            user_id = authenticate_request_helper()
        else:
            # Use existing authentication system
            user_id = authenticate_request_helper()
        
        if not user_id:
            return jsonify({"success": False, "message": "Not authenticated"}), 401
        
        use_postgresql = app.config.get('USE_POSTGRESQL', False)
        try:
            if use_postgresql:
                from models import db, User
                user = User.query.filter_by(id=user_id).first()
                if not user:
                    return jsonify({"success": False, "message": "User not found"}), 404
                return jsonify({"access_code": user.access_code})
            else:
                conn = get_db()
                cursor = conn.cursor()
                cursor.execute("SELECT access_code FROM users WHERE id = ?", (user_id,))
                row = cursor.fetchone()
                conn.close()
                if not row:
                    return jsonify({"success": False, "message": "User not found"}), 404
                return jsonify({"access_code": row[0]})
        except Exception as e:
            logger.error(f"Error getting access code: {e}", exc_info=True)
            return jsonify({"success": False, "message": "Server error"}), 500
    
    @app.get("/validate_session")
    def validate_session():
        """Validate session endpoint - supports Bearer token or session/auth header"""
        # Support Bearer token from Authorization header
        auth_header = request.headers.get('Authorization', '')
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header.split(' ', 1)[1].strip()
            # If token is an access code, use it to authenticate
            user_id = authenticate_request_helper()
        else:
            # Use existing authentication system
            user_id = authenticate_request_helper()
        
        if user_id:
            return jsonify({"valid": True})
        else:
            return jsonify({"valid": False}), 401
    
    @app.post("/api/save-client-state")
    def save_client_state():
        """Save client-side state for optional restore after re-login"""
        user_id = authenticate_request_helper()
        if not user_id:
            return jsonify({"success": False, "message": "Not authenticated"}), 401
        
        data = request.get_json() or {}
        # Sanitize: only allow safe fields, no credentials
        safe_state = {
            'currentView': data.get('currentView'),
            'currentCategory': data.get('currentCategory'),
            'pendingFormData': {}  # Never store form data with credentials
        }
        
        # Remove any potentially sensitive fields
        if 'pendingFormData' in data:
            form_data = data.get('pendingFormData', {})
            for key in ['password', 'access_code', 'token', 'secret']:
                if key in form_data:
                    del form_data[key]
            safe_state['pendingFormData'] = {k: v for k, v in form_data.items() if not any(sensitive in k.lower() for sensitive in ['pass', 'code', 'token', 'secret'])}
        
        import json
        state_json = json.dumps(safe_state)
        
        use_postgresql = app.config.get('USE_POSTGRESQL', False)
        try:
            if use_postgresql:
                from models import db, UserState
                user_state = UserState.query.filter_by(user_id=user_id).first()
                if user_state:
                    user_state.state_json = state_json
                else:
                    user_state = UserState(user_id=user_id, state_json=state_json)
                    db.session.add(user_state)
                db.session.commit()
                return jsonify({"success": True, "message": "State saved"})
            else:
                conn = get_db()
                cursor = conn.cursor()
                cursor.execute(
                    "INSERT OR REPLACE INTO user_states (user_id, state_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
                    (user_id, state_json)
                )
                conn.commit()
                conn.close()
                return jsonify({"success": True, "message": "State saved"})
        except Exception as e:
            logger.error(f"Error saving client state: {e}", exc_info=True)
            return jsonify({"success": False, "message": "Failed to save state"}), 500
    
    @app.get("/api/get-client-state")
    def get_client_state():
        """Get saved client-side state for optional restore"""
        user_id = authenticate_request_helper()
        if not user_id:
            return jsonify({"success": False, "message": "Not authenticated"}), 401
        
        use_postgresql = app.config.get('USE_POSTGRESQL', False)
        try:
            if use_postgresql:
                from models import db, UserState
                user_state = UserState.query.filter_by(user_id=user_id).first()
                if not user_state or not user_state.state_json:
                    return jsonify({"success": True, "state": None})
                import json
                state = json.loads(user_state.state_json)
                return jsonify({"success": True, "state": state})
            else:
                conn = get_db()
                cursor = conn.cursor()
                cursor.execute("SELECT state_json FROM user_states WHERE user_id = ?", (user_id,))
                row = cursor.fetchone()
                conn.close()
                if not row or not row[0]:
                    return jsonify({"success": True, "state": None})
                import json
                state = json.loads(row[0])
                return jsonify({"success": True, "state": state})
        except Exception as e:
            logger.error(f"Error getting client state: {e}", exc_info=True)
            return jsonify({"success": False, "message": "Failed to get state"}), 500

    @app.post("/api/vote")
    def cast_vote():
        """Cast a vote for a nominee in a category; one vote per user per category"""
        # CRITICAL: Check voting status FIRST from DB before any other processing
        # This prevents any race conditions or rapid-click bypasses
        use_postgresql = app.config.get('USE_POSTGRESQL', False)
        voting_active = get_voting_active_from_db(use_postgresql)
        if not voting_active:
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
                # Use SQLAlchemy for PostgreSQL with transaction and row locks
                from models import db, Vote
                from sqlalchemy import select
                
                # Flask-SQLAlchemy auto-begins transactions, so we don't need to call begin() explicitly
                # However, previous operations (get_voting_active_from_db, authenticate_request_helper)
                # may have committed, leaving us in a clean state. We'll use the session normally.
                
                # Check if vote already exists with row lock
                # with_for_update() requires a transaction, which Flask-SQLAlchemy provides automatically
                # with_for_update() is a method on Select objects in SQLAlchemy 2.0+, not an import
                existing = db.session.execute(
                    select(Vote).where(
                        Vote.user_id == user_id,
                        Vote.category_id == category_id
                    ).with_for_update()
                ).scalar_one_or_none()
                
                if existing:
                    db.session.rollback()
                    return jsonify({"success": False, "message": "You have already voted in this category"}), 409
                
                # Create new vote atomically
                new_vote = Vote(user_id=user_id, category_id=category_id, nominee_id=nominee_id)
                db.session.add(new_vote)
                db.session.commit()
                
                logger.info(f"✅ Vote recorded: user {user_id}, category {category_id}, nominee {nominee_id}")
                return jsonify({"success": True, "message": "Vote recorded"}), 201
            else:
                # Use SQLite with transaction
                # Note: We already checked voting_active before starting the transaction (line 1447)
                conn = get_db()
                try:
                    # Begin transaction
                    conn.execute("BEGIN IMMEDIATE")
                    cur = conn.cursor()
                    
                    # No need to check voting_active again - already checked before transaction
                    
                    # Check if vote already exists (SQLite doesn't support SELECT FOR UPDATE, but transaction provides isolation)
                    cur.execute(
                        "SELECT id FROM votes WHERE user_id = ? AND category_id = ?",
                        (user_id, category_id)
                    )
                    if cur.fetchone():
                        conn.rollback()
                        conn.close()
                        return jsonify({"success": False, "message": "You have already voted in this category"}), 409
                    
                    # Create new vote atomically
                    cur.execute(
                        "INSERT INTO votes (user_id, category_id, nominee_id) VALUES (?, ?, ?)",
                        (user_id, category_id, nominee_id)
                    )
                    conn.commit()
                    logger.info(f"✅ Vote recorded: user {user_id}, category {category_id}, nominee {nominee_id}")
                    return jsonify({"success": True, "message": "Vote recorded"}), 201
                except Exception as e:
                    conn.rollback()
                    raise e
                finally:
                    conn.close()
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
        """Return user_id if request is authenticated via DB-backed session or access code header."""
        use_postgresql = app.config.get('USE_POSTGRESQL', False)
        
        # Check Flask session first (for backward compatibility)
        if 'user_id' in session:
            session_id = session.get('_id') or session.get('session_id')
            if session_id:
                # Verify session in DB and update last_active
                db_session = get_session_from_db(use_postgresql, session_id)
                if db_session:
                    # Check 30-minute inactivity timeout
                    last_active = db_session.get('last_active')
                    if last_active:
                        # Handle both datetime objects and strings
                        if isinstance(last_active, str):
                            try:
                                # Try isoformat first
                                last_active = datetime.fromisoformat(last_active.replace('Z', '+00:00'))
                            except:
                                try:
                                    # Fallback: parse common formats
                                    last_active = datetime.strptime(last_active, '%Y-%m-%d %H:%M:%S.%f')
                                except:
                                    try:
                                        last_active = datetime.strptime(last_active, '%Y-%m-%d %H:%M:%S')
                                    except:
                                        logger.warning(f"Could not parse last_active: {last_active}")
                                        last_active = None
                        
                        if last_active:
                            # Remove timezone info if present for comparison
                            if hasattr(last_active, 'tzinfo') and last_active.tzinfo:
                                last_active_naive = last_active.replace(tzinfo=None)
                            elif hasattr(last_active, 'replace'):
                                last_active_naive = last_active
                            else:
                                last_active_naive = last_active
                            
                            # Calculate time since last activity
                            try:
                                time_since_active = (datetime.utcnow() - last_active_naive).total_seconds()
                                
                                # If inactive for more than 30 minutes (1800 seconds), delete session
                                if time_since_active > 1800:
                                    logger.info(f"Session expired due to 30-minute inactivity: {session_id}")
                                    delete_session_from_db(use_postgresql, session_id)
                                    session.clear()
                                    return None
                            except Exception as e:
                                logger.warning(f"Error calculating inactivity time: {e}")
                                # If we can't calculate, assume session is still valid
                                pass
                    
                    # Session is valid - return user_id
                    return int(session['user_id'])
            else:
                # Legacy session without DB backup - still valid but should be migrated
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
                # Create DB-backed session
                session_id = secrets.token_urlsafe(32)
                expires_at = datetime.utcnow() + timedelta(days=31)
                session_data = {
                    'user_id': user['id'],
                    'access_code': user['access_code'],
                    'fullname': user['fullname'],
                    'phone': user['phone'],
                    'birthdate': user.get('birthdate')
                }
                save_session_to_db(use_postgresql, session_id, user['id'], session_data, expires_at)
                
                # Set Flask session
                session['_id'] = session_id
                session['user_id'] = user['id']
                session['access_code'] = user['access_code']
                session['fullname'] = user['fullname']
                session['phone'] = user['phone']
                session['birthdate'] = user.get('birthdate')
                session.permanent = True
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
        use_postgresql = app.config.get('USE_POSTGRESQL', False)
        voting_active = get_voting_active_from_db(use_postgresql)
        # Update app.config cache
        app.config['VOTING_ACTIVE'] = voting_active
        return jsonify({
            "success": True,
            "voting_active": voting_active
        })
    
    @app.post("/api/admin/voting-status")
    def set_voting_status():
        """Set voting session status (admin only) - atomically updates DB"""
        if not require_admin():
            return jsonify({"success": False, "message": "Admin access required"}), 403
        data = request.get_json() or {}
        voting_active = data.get('voting_active', True)
        use_postgresql = app.config.get('USE_POSTGRESQL', False)
        
        # Get admin ID for logging
        admin_id = 'admin'  # Could be enhanced to get actual admin ID
        if 'admin_authenticated' in session:
            admin_id = f"admin_{session.get('admin_role', 'admin')}"
        
        # Atomically update DB
        success = set_voting_active_in_db(use_postgresql, bool(voting_active), updated_by=admin_id)
        if not success:
            return jsonify({"success": False, "message": "Failed to update voting status"}), 500
        
        # Update app.config cache
        app.config['VOTING_ACTIVE'] = bool(voting_active)
        logger.info(f"✅ Voting session {'activated' if voting_active else 'deactivated'} by {admin_id}")
        return jsonify({
            "success": True,
            "voting_active": app.config['VOTING_ACTIVE'],
            "message": f"Voting session {'activated' if voting_active else 'deactivated'}"
        })
    
    @app.get("/api/voting-status")
    def public_voting_status():
        """Get current voting session status (public endpoint for user UI)"""
        use_postgresql = app.config.get('USE_POSTGRESQL', False)
        voting_active = get_voting_active_from_db(use_postgresql)
        # Update app.config cache
        app.config['VOTING_ACTIVE'] = voting_active
        return jsonify({
            "success": True,
            "voting_active": voting_active
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
        """Delete a user and all their votes, sessions, and states (admin only)"""
        if not require_admin():
            return jsonify({"success": False, "message": "Admin access required"}), 403
        
        use_postgresql = app.config.get('USE_POSTGRESQL', False)
        try:
            if use_postgresql:
                # Use SQLAlchemy for PostgreSQL
                from models import db, User, Vote, Session, UserState
                # Delete in correct order to avoid foreign key violations:
                # 1. Delete user's sessions first (references user_id)
                Session.query.filter_by(user_id=user_id).delete()
                # 2. Delete user's states (references user_id)
                UserState.query.filter_by(user_id=user_id).delete()
                # 3. Delete user's votes (references user_id)
                Vote.query.filter_by(user_id=user_id).delete()
                # 4. Finally delete the user
                User.query.filter_by(id=user_id).delete()
                db.session.commit()
                logger.info(f"✅ Deleted user {user_id} and all related data from PostgreSQL")
                return jsonify({"success": True, "message": "User deleted successfully"})
            else:
                # Use SQLite
                conn = get_db()
                cursor = conn.cursor()
                try:
                    # Delete in correct order to avoid foreign key violations:
                    # 1. Delete user's sessions first (references user_id)
                    cursor.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
                    # 2. Delete user's states (references user_id)
                    cursor.execute("DELETE FROM user_states WHERE user_id = ?", (user_id,))
                    # 3. Delete user's votes (references user_id)
                    cursor.execute("DELETE FROM votes WHERE user_id = ?", (user_id,))
                    # 4. Finally delete the user
                    cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
                    conn.commit()
                    logger.info(f"✅ Deleted user {user_id} and all related data from SQLite")
                    return jsonify({"success": True, "message": "User deleted successfully"})
                finally:
                    conn.close()
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
            json_records = load_registration_json_records(json_path)
            json_records.append(payload_entry)
            persist_registration_records(json_records, json_path, csv_path)

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
            json_records = load_registration_json_records(json_path)
            if not json_records:
                return jsonify({"success": False, "message": "Sorry, account doesn't exist"}), 404

            updated_records = []
            match_found = False

            for rec in json_records:
                rec_first = (rec.get('first_name') or '').strip()
                rec_last = (rec.get('last_name') or '').strip()
                rec_phone = (rec.get('phone') or '').strip()

                rec_first_norm = normalize_name(rec_first)
                rec_last_norm = normalize_name(rec_last)
                rec_phone_norm = normalize_phone(rec_phone)

                if rec_first_norm == first_norm and rec_last_norm == last_norm and rec_phone_norm == phone_norm:
                    match_found = True
                    continue

                updated_records.append({
                    "first_name": rec_first,
                    "last_name": rec_last,
                    "phone": rec_phone
                })

            if not match_found:
                return jsonify({"success": False, "message": "Sorry, account doesn't exist"}), 404

            persist_registration_records(updated_records, json_path, csv_path)
            logger.info("✅ Removed registration entry for %s %s (%s)", first_name, last_name, phone_norm)

            # Delete user account from database if it exists
            account_deleted = False
            use_postgresql = app.config.get('USE_POSTGRESQL', False)
            
            # Build full name for matching (User model uses fullname field)
            full_name = f"{first_name} {last_name}".strip()
            full_name_norm = normalize_name(full_name)
            
            try:
                if use_postgresql:
                    from models import db, User, Vote, Session, UserState
                    # Try to find user by phone first
                    user = User.query.filter_by(phone=phone_norm).first()
                    if not user:
                        # Try by fullname match (normalized)
                        users = User.query.all()
                        for u in users:
                            if normalize_name(u.fullname) == full_name_norm:
                                user = u
                                break
                    
                    if user:
                        # Delete in correct order to avoid foreign key violations
                        # 1. Delete user's sessions
                        Session.query.filter_by(user_id=user.id).delete()
                        # 2. Delete user's states
                        UserState.query.filter_by(user_id=user.id).delete()
                        # 3. Delete user's votes
                        Vote.query.filter_by(user_id=user.id).delete()
                        # 4. Finally delete the user
                        db.session.delete(user)
                        db.session.commit()
                        account_deleted = True
                        logger.info(f"✅ Deleted user account from PostgreSQL: {user.fullname} ({phone_norm})")
                else:
                    # SQLite
                    conn = get_db()
                    cur = conn.cursor()
                    try:
                        # Find user by phone first
                        cur.execute("SELECT id, fullname FROM users WHERE phone = ?", (phone_norm,))
                        user_row = cur.fetchone()
                        
                        if not user_row:
                            # Try by fullname match (normalized)
                            cur.execute("SELECT id, fullname FROM users")
                            all_users = cur.fetchall()
                            for u in all_users:
                                if normalize_name(u[1]) == full_name_norm:
                                    user_row = u
                                    break
                        
                        if user_row:
                            user_id = user_row[0]
                            # Delete in correct order
                            cur.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
                            cur.execute("DELETE FROM user_states WHERE user_id = ?", (user_id,))
                            cur.execute("DELETE FROM votes WHERE user_id = ?", (user_id,))
                            cur.execute("DELETE FROM users WHERE id = ?", (user_id,))
                            conn.commit()
                            account_deleted = True
                            logger.info(f"✅ Deleted user account from SQLite: ID {user_id} ({phone_norm})")
                    finally:
                        conn.close()
            except Exception as e:
                logger.error(f"Error deleting user account: {e}", exc_info=True)
                # Don't fail the whole operation if account deletion fails

            message = "Registration record deleted permanently"
            if account_deleted:
                message += " and linked user account removed"
            
            logger.info(f"✅ Deleted event registration user: {first_name} {last_name} ({phone_norm})")
            return jsonify({"success": True, "message": message})
        except Exception as exc:
            logger.error(f"❌ Failed to delete event registration user: {exc}", exc_info=True)
            return jsonify({"success": False, "message": "Failed to delete registration record"}), 500

    @app.get("/api/admin/registered-users")
    def admin_get_registered_users():
        """Get all registered users with their account status (admin only)"""
        if not require_admin():
            return jsonify({"success": False, "message": "Admin access required"}), 403
        
        try:
            # Get all registered users from JSON file
            registered_records = get_event_registration_records()
            
            # Get all users who have created accounts
            use_postgresql = app.config.get('USE_POSTGRESQL', False)
            account_phones = set()
            
            if use_postgresql:
                from models import db, User
                users = User.query.all()
                for user in users:
                    account_phones.add(normalize_phone(user.phone))
            else:
                conn = get_db()
                cursor = conn.cursor()
                cursor.execute("SELECT phone FROM users")
                for row in cursor.fetchall():
                    account_phones.add(normalize_phone(row[0]))
                conn.close()
            
            # Build response with account status
            result = []
            for record in registered_records:
                phone_norm = record.get('phone_norm') or normalize_phone(record.get('phone', ''))
                has_account = phone_norm in account_phones
                
                result.append({
                    "first_name": record.get('first_name', ''),
                    "last_name": record.get('last_name', ''),
                    "phone": record.get('phone', ''),
                    "has_account": has_account,
                    "status": "User" if has_account else "Registered"
                })
            
            # Sort by last name, then first name for consistent ordering
            result.sort(key=lambda x: (x['last_name'].lower(), x['first_name'].lower()))
            
            logger.info(f"✅ Returning {len(result)} registered users (admin)")
            return jsonify({
                "success": True,
                "users": result,
                "total": len(result),
                "with_accounts": sum(1 for u in result if u['has_account']),
                "without_accounts": sum(1 for u in result if not u['has_account'])
            })
        except Exception as e:
            logger.error(f"❌ Error getting registered users: {e}", exc_info=True)
            return jsonify({"success": False, "message": f"Failed to get registered users: {str(e)}"}), 500

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


