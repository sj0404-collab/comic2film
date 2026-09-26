#!/usr/bin/env python3
"""
VoiceComic Backend — FastAPI + PTY terminal + GitHub token auth.
- Auth: Bearer token validated against GitHub API /user
- Workspace: global dir (shared between runner & APK, except tmp)
- Files: list / upload / download / delete
- Exec: run shell commands
- PTY: WebSocket terminal (xterm.js compatible)
"""

import os
import asyncio
import json
import re
import secrets
import shutil
import signal
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Optional

import httpx
import psutil
from fastapi import (
    FastAPI, WebSocket, WebSocketDisconnect, HTTPException,
    Depends, UploadFile, File, Form, Request, Header
)
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ─── Config ───
WORKSPACE_ROOT = Path(os.getenv("VOICECOMIC_WORKSPACE", Path.home() / "voicecomic-workspace")).resolve()
WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)
TMP_DIR = WORKSPACE_ROOT / "tmp"
TMP_DIR.mkdir(exist_ok=True)

GITHUB_API = "https://api.github.com"
TOKEN_TTL = 300  # 5 минут, как и обещает докстринг validate_token
TOKEN_CACHE: dict[str, tuple[float, dict]] = {}  # token -> (expires_at, user)

app = FastAPI(title="VoiceComic Backend", version="0.5.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Auth ───
async def validate_token(token: str) -> dict:
    """Валидирует GitHub PAT через /user, кэширует на TOKEN_TTL секунд.

    Раньше запись в кэш была без срока: отозванный токен оставался рабочим
    до перезапуска процесса, а словарь рос без границ.
    """
    now = time.time()
    hit = TOKEN_CACHE.get(token)
    if hit and hit[0] > now:
        return hit[1]
    if hit:  # протухшая запись — не копим мусор
        TOKEN_CACHE.pop(token, None)
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{GITHUB_API}/user",
                             headers={"Authorization": f"Bearer {token}",
                                      "Accept": "application/vnd.github+json"})
        if r.status_code != 200:
            raise HTTPException(401, f"GitHub auth failed: {r.status_code}")
        user = r.json()
    TOKEN_CACHE[token] = (now + TOKEN_TTL, user)
    return user

async def get_user(authorization: Optional[str] = Header(default=None)) -> dict:
    # Именно Header: без него FastAPI трактует параметр как query-строку
    # (?authorization=...) и любой запрос с заголовком Authorization получал 401.
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing Bearer token")
    return await validate_token(authorization[7:])

# ─── Models ───
class ExecRequest(BaseModel):
    cmd: str
    cwd: Optional[str] = None
    timeout: int = 60

class FileItem(BaseModel):
    name: str
    path: str
    size: int
    is_dir: bool
    modified: float

# ─── Helpers ───
def resolve_path(user_path: str) -> Path:
    """Ресолвит путь внутри WORKSPACE_ROOT, запрещает вылезать наружу.

    Проверка через str.startswith() была дырой: соседний каталог с тем же
    префиксом (~/voicecomic-workspace-evil) проходил как «внутри».
    """
    raw = str(user_path or "").replace("\\", "/")
    p = (WORKSPACE_ROOT / raw.lstrip("/")).resolve()
    if p != WORKSPACE_ROOT and not p.is_relative_to(WORKSPACE_ROOT):
        raise HTTPException(400, "Path traversal blocked")
    return p


def safe_filename(name: str) -> str:
    """Имя файла от клиента нельзя подставлять в путь как есть:
    filename="../../evil" уводил запись за пределы рабочего каталога."""
    base = os.path.basename(str(name or "").replace("\\", "/")).strip()
    base = re.sub(r"[\x00-\x1f\x7f]", "", base)
    if base in ("", ".", ".."):
        raise HTTPException(400, "Недопустимое имя файла")
    if base.startswith("."):
        base = "_" + base
    return base[:255]

async def stream_pty(ws: WebSocket, cols: int = 80, rows: int = 24, cwd: str = "/"):
    """Запускает pty-процесс (bash) и проксирует stdin/stdout через WS."""
    import pty
    import termios
    import fcntl
    import struct

    pid, fd = pty.fork()
    if pid == 0:  # child
        # Ребёнок — копия сервера с его сокетами и event loop. Любое
        # исключение здесь (например, resolve_path поднял HTTPException)
        # всплыло бы в копии ASGI-приложения, и она продолжила бы крутиться
        # вместо bash. Поэтому любая ошибка — это немедленный _exit.
        try:
            os.chdir(resolve_path(cwd))
            os.environ["TERM"] = "xterm-256color"
            os.environ["COLUMNS"] = str(cols)
            os.environ["LINES"] = str(rows)
            os.execvp("bash", ["bash"])
        except BaseException:
            pass
        os._exit(1)  # exec не вернулся — до этого места дойдём только при ошибке
    else:  # parent
        # set non-blocking
        fl = fcntl.fcntl(fd, fcntl.F_GETFL)
        fcntl.fcntl(fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)

        async def read_pty():
            try:
                while True:
                    try:
                        data = os.read(fd, 1024)
                        if not data:
                            break
                        await ws.send_text(data.decode(errors="ignore"))
                    except BlockingIOError:
                        await asyncio.sleep(0.01)
                    except OSError:
                        break
            finally:
                try:
                    os.close(fd)
                except OSError:
                    pass

        async def write_pty():
            try:
                while True:
                    msg = await ws.receive_text()
                    try:
                        data = json.loads(msg)
                        if data.get("type") == "input":
                            os.write(fd, data["data"].encode())
                        elif data.get("type") == "resize":
                            c, r = int(data.get("cols", cols)), int(data.get("rows", rows))
                            cols, rows = c, r
                            winsize = struct.pack("HHHH", rows, cols, 0, 0)
                            fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
                    except json.JSONDecodeError:
                        os.write(fd, msg.encode())
            except (WebSocketDisconnect, OSError):
                pass

        read_task = asyncio.create_task(read_pty())
        write_task = asyncio.create_task(write_pty())
        done, pending = await asyncio.wait(
            [read_task, write_task],
            return_when=asyncio.FIRST_COMPLETED
        )
        for t in pending:
            t.cancel()
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        # reap: без waitpid каждая сессия терминала оставляла зомби
        try:
            os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            pass
        await asyncio.gather(*done, return_exceptions=True)

# ─── Routes ───
@app.get("/health")
async def health():
    return {"status": "ok", "workspace": str(WORKSPACE_ROOT)}

@app.get("/auth/me")
async def auth_me(user: dict = Depends(get_user)):
    return {"login": user.get("login"), "id": user.get("id"), "avatar": user.get("avatar_url")}

# ─── Files ───
@app.get("/files")
async def list_files(path: str = "", user: dict = Depends(get_user)):
    base = resolve_path(path)
    if not base.exists():
        raise HTTPException(404, "Not found")
    items = []
    for entry in sorted(base.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())):
        st = entry.stat()
        items.append(FileItem(
            name=entry.name,
            path=str(entry.relative_to(WORKSPACE_ROOT)),
            size=st.st_size,
            is_dir=entry.is_dir(),
            modified=st.st_mtime,
        ).model_dump())
    return items

@app.post("/files/upload")
async def upload_file(path: str = Form(""), file: UploadFile = File(...), user: dict = Depends(get_user)):
    dest = resolve_path(path) / safe_filename(file.filename)
    dest.parent.mkdir(parents=True, exist_ok=True)
    content = await file.read()
    dest.write_bytes(content)
    return {"ok": True, "path": str(dest.relative_to(WORKSPACE_ROOT)), "size": len(content)}

@app.get("/files/download")
async def download_file(path: str, user: dict = Depends(get_user)):
    f = resolve_path(path)
    if not f.exists() or f.is_dir():
        raise HTTPException(404, "Not found")
    return FileResponse(f, filename=f.name)

@app.delete("/files")
async def delete_file(path: str, user: dict = Depends(get_user)):
    f = resolve_path(path)
    if not f.exists():
        raise HTTPException(404, "Not found")
    if f.is_dir():
        shutil.rmtree(f)
    else:
        f.unlink()
    return {"ok": True}

# ─── Exec ───
@app.post("/exec")
async def exec_cmd(req: ExecRequest, user: dict = Depends(get_user)):
    cwd = resolve_path(req.cwd or ".")
    try:
        proc = await asyncio.create_subprocess_shell(
            req.cmd,
            cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=req.timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return {"exit_code": -1, "stdout": "", "stderr": "timeout", "timed_out": True}
        return {
            "exit_code": proc.returncode,
            "stdout": stdout.decode(errors="ignore"),
            "stderr": stderr.decode(errors="ignore"),
        }
    except Exception as e:
        raise HTTPException(500, str(e))

# ─── PTY WebSocket ───
@app.websocket("/pty")
async def pty_ws(ws: WebSocket, token: str = "", cols: int = 80, rows: int = 24, cwd: str = "/"):
    await ws.accept()
    try:
        user = await validate_token(token)
    except HTTPException:
        await ws.close(code=4001, reason="auth failed")
        return
    await stream_pty(ws, cols, rows, cwd)

# ─── Static workspace info ───
@app.get("/workspace/info")
async def workspace_info(user: dict = Depends(get_user)):
    total, used, free = shutil.disk_usage(WORKSPACE_ROOT)
    return {
        "root": str(WORKSPACE_ROOT),
        "total_gb": round(total / 1e9, 1),
        "used_gb": round(used / 1e9, 1),
        "free_gb": round(free / 1e9, 1),
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)