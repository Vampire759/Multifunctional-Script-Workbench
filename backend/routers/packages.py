from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.schemas import GenericResp
import os
import subprocess
import sys
import re
from importlib.metadata import distributions, PackageNotFoundError

router = APIRouter(prefix="/api/packages", tags=["packages"])

REQUIREMENTS_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "requirements.txt")

def read_requirements() -> list:
    packages = []
    if os.path.exists(REQUIREMENTS_FILE):
        with open(REQUIREMENTS_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    packages.append(line)
    return packages

def write_requirements(packages: list):
    with open(REQUIREMENTS_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(packages))
        f.write("\n")

def get_installed_packages() -> dict:
    installed = {}
    for dist in distributions():
        name = dist.metadata["Name"].lower()
        installed[name] = dist.version
    return installed

def parse_package_name(pkg_spec: str) -> str:
    name = re.split(r'[<>=!~]', pkg_spec)[0].strip()
    name = name.split("[")[0].strip()
    return name.lower()

@router.get("/", response_model=dict)
async def get_packages():
    packages = read_requirements()
    installed_pkgs = get_installed_packages()
    result = []
    for pkg in packages:
        pkg_name = parse_package_name(pkg)
        is_installed = pkg_name in installed_pkgs
        result.append({"name": pkg, "installed": is_installed})
    return {"packages": result}

@router.post("/", response_model=GenericResp)
async def update_packages(packages: list[str]):
    try:
        write_requirements(packages)
        return GenericResp(success=True, message="脚本库配置已更新")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/install", response_model=GenericResp)
async def install_package(package: str):
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", package],
            capture_output=True,
            text=True,
            timeout=120
        )
        if result.returncode == 0:
            packages = read_requirements()
            pkg_base = parse_package_name(package)
            exists = any(parse_package_name(pkg) == pkg_base for pkg in packages)
            if not exists:
                packages.append(package)
                write_requirements(packages)
            return GenericResp(success=True, message=f"包 '{package}' 安装成功")
        else:
            raise HTTPException(status_code=500, detail=result.stderr)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="安装超时")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/install-all", response_model=GenericResp)
async def install_all_packages():
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "-r", REQUIREMENTS_FILE],
            capture_output=True,
            text=True,
            timeout=300
        )
        if result.returncode == 0:
            return GenericResp(success=True, message="所有包安装成功")
        else:
            raise HTTPException(status_code=500, detail=result.stderr)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="安装超时")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{package_name}", response_model=GenericResp)
async def remove_package(package_name: str):
    try:
        packages = read_requirements()
        new_packages = []
        target = parse_package_name(package_name)
        for pkg in packages:
            if parse_package_name(pkg) != target:
                new_packages.append(pkg)
        if len(new_packages) == len(packages):
            raise HTTPException(status_code=404, detail="包不存在")
        write_requirements(new_packages)
        return GenericResp(success=True, message=f"包 '{package_name}' 已从配置中移除")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
