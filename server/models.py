"""
Database models using SQLAlchemy for PostgreSQL support.
Falls back to SQLite if DATABASE_URL is not set.
"""
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

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

