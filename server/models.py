"""
Database models using SQLAlchemy for PostgreSQL support.
Falls back to SQLite if DATABASE_URL is not set.
"""
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timedelta

db = SQLAlchemy()


class User(db.Model):
    __tablename__ = 'users'
    
    id = db.Column(db.Integer, primary_key=True)
    fullname = db.Column(db.String(255), nullable=False)
    phone = db.Column(db.String(50), nullable=False)
    country_code = db.Column(db.String(10), nullable=False)
    email = db.Column(db.String(255), nullable=True)
    birthdate = db.Column(db.String(50), nullable=False)
    birthdate_suffix = db.Column(db.Integer, default=1)
    access_code = db.Column(db.String(6), unique=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'fullname': self.fullname,
            'phone': self.phone,
            'country_code': self.country_code,
            'email': self.email,
            'birthdate': self.birthdate,
            'birthdate_suffix': self.birthdate_suffix,
            'access_code': self.access_code,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class Vote(db.Model):
    __tablename__ = 'votes'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    category_id = db.Column(db.Integer, nullable=False)
    nominee_id = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    __table_args__ = (db.UniqueConstraint('user_id', 'category_id', name='unique_user_category'),)
    
    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'category_id': self.category_id,
            'nominee_id': self.nominee_id,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class Session(db.Model):
    """DB-backed session storage for persistence across container restarts"""
    __tablename__ = 'sessions'
    
    id = db.Column(db.String(255), primary_key=True)  # session_id
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    data = db.Column(db.Text, nullable=True)  # JSON string of session data
    last_active = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    
    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'last_active': self.last_active.isoformat() if self.last_active else None,
            'expires_at': self.expires_at.isoformat() if self.expires_at else None
        }


class VotingConfig(db.Model):
    """Persistent voting session configuration"""
    __tablename__ = 'voting_config'
    
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(50), unique=True, nullable=False, default='voting_active')
    value = db.Column(db.String(255), nullable=False)  # Store as string, parse as needed
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.String(50), nullable=True)  # admin_id or 'system'
    
    def to_dict(self):
        return {
            'key': self.key,
            'value': self.value,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'updated_by': self.updated_by
        }


class UserState(db.Model):
    """Client-side state persistence for optional restore after re-login"""
    __tablename__ = 'user_states'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, unique=True)
    state_json = db.Column(db.Text, nullable=True)  # JSON string of sanitized client state
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def to_dict(self):
        return {
            'user_id': self.user_id,
            'state_json': self.state_json,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }

