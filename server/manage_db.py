"""
Database management script for initializing tables in production.
Run this after setting DATABASE_URL environment variable.

Usage:
    python manage_db.py

This script will:
- Initialize SQLAlchemy models if DATABASE_URL is set
- Create all tables defined in models.py
- Fall back to SQLite init_db() if DATABASE_URL is not set
"""
import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if DATABASE_URL:
    # Use SQLAlchemy for PostgreSQL
    try:
        from app import create_app
        from models import db
        
        app = create_app()
        with app.app_context():
            db.create_all()
            print("✓ PostgreSQL tables created successfully using SQLAlchemy")
    except Exception as e:
        print(f"✗ Error creating PostgreSQL tables: {e}")
        print("Falling back to SQLite initialization...")
        from app import init_db
        init_db()
        print("✓ SQLite database initialized (fallback)")
else:
    # Use SQLite for local development
    from app import init_db
    init_db()
    print("✓ SQLite database initialized (local development)")

