"""认证服务：JWT + 用户管理"""
import os
import hashlib
from datetime import datetime, timedelta
from jose import jwt

from sqlalchemy.orm import Session
from backend.models import User

SECRET_KEY = os.environ.get("SECRET_KEY", "video-spider-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 120


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return get_password_hash(plain_password) == hashed_password


def get_password_hash(password: str) -> str:
    salt = SECRET_KEY[:16]
    return hashlib.sha256((salt + password).encode()).hexdigest()


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def get_user(db: Session, username: str) -> User | None:
    return db.query(User).filter(User.username == username).first()


def authenticate_user(db: Session, username: str, password: str) -> User | None:
    user = get_user(db, username)
    if not user:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def create_user(db: Session, username: str, password: str) -> User:
    hashed_password = get_password_hash(password)
    user = User(username=username, password_hash=hashed_password)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def init_admin_user(db: Session):
    """初始化管理员用户（默认 admin/admin123）"""
    user = get_user(db, "admin")
    if not user:
        create_user(db, "admin", "admin123")
        print("[Auth] 已创建默认管理员: admin/admin123")
    else:
        user.password_hash = get_password_hash("admin123")
        db.commit()
        print("[Auth] 已重置管理员密码: admin/admin123")


def change_password(db: Session, username: str, old_password: str, new_password: str) -> bool:
    """修改用户密码"""
    user = get_user(db, username)
    if not user:
        return False
    if not verify_password(old_password, user.password_hash):
        return False
    user.password_hash = get_password_hash(new_password)
    db.commit()
    return True
