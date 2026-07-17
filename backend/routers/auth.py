"""认证 API 路由"""
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.schemas import GenericResp
from backend.services.auth_service import (
    authenticate_user, create_access_token, ACCESS_TOKEN_EXPIRE_MINUTES, create_user, get_user,
    change_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")


@router.post("/token")
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    """登录获取 JWT Token"""
    user = authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/register", response_model=GenericResp)
async def register(
    username: str,
    password: str,
    db: Session = Depends(get_db),
):
    """注册新用户"""
    if get_user(db, username):
        raise HTTPException(status_code=400, detail="用户名已存在")
    create_user(db, username, password)
    return GenericResp(success=True, message="注册成功")


@router.get("/me", response_model=dict)
async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    """获取当前用户信息"""
    from backend.services.auth_service import SECRET_KEY, ALGORITHM
    from jose import jwt, JWTError
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=401, detail="无效的 token")
    except JWTError:
        raise HTTPException(status_code=401, detail="无效的 token")
    
    user = get_user(db, username)
    if user is None:
        raise HTTPException(status_code=401, detail="用户不存在")
    
    return {"username": user.username, "created_at": user.created_at.isoformat()}


@router.post("/change-password", response_model=GenericResp)
async def change_user_password(
    old_password: str,
    new_password: str,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    """修改当前用户密码"""
    from backend.services.auth_service import SECRET_KEY, ALGORITHM
    from jose import jwt, JWTError
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=401, detail="无效的 token")
    except JWTError:
        raise HTTPException(status_code=401, detail="无效的 token")
    
    user = get_user(db, username)
    if user is None:
        raise HTTPException(status_code=401, detail="用户不存在")
    
    if not change_password(db, username, old_password, new_password):
        raise HTTPException(status_code=400, detail="原密码错误")
    
    return GenericResp(success=True, message="密码修改成功")
