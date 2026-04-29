import os
import re
import secrets
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt
from flask import Flask, jsonify, make_response, request, send_from_directory
from flask_cors import CORS
from flask_mail import Mail, Message
from passlib.hash import pbkdf2_sha256


BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "data.sqlite"
STATIC_DIR = (BASE_DIR / ".." / "Voting System").resolve()

PORT = int(os.getenv("PORT", "3000"))
JWT_SECRET = os.getenv("JWT_SECRET", "dev_secret_change_me")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def make_poll_id() -> str:
    return f"p_{int(time.time() * 1000):x}{os.urandom(2).hex()}"


def is_valid_email(email: str) -> bool:
    return bool(re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email))


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db() -> None:
    conn = get_db()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              username TEXT NOT NULL UNIQUE,
              password_hash TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS polls (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              created_by_user_id INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              FOREIGN KEY(created_by_user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS candidates (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              poll_id TEXT NOT NULL,
              name TEXT NOT NULL,
              FOREIGN KEY(poll_id) REFERENCES polls(id)
            );

            CREATE TABLE IF NOT EXISTS votes (
              poll_id TEXT NOT NULL,
              user_id INTEGER NOT NULL,
              candidate_id INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              PRIMARY KEY (poll_id, user_id),
              FOREIGN KEY(poll_id) REFERENCES polls(id),
              FOREIGN KEY(user_id) REFERENCES users(id),
              FOREIGN KEY(candidate_id) REFERENCES candidates(id)
            );

            CREATE TABLE IF NOT EXISTS otps (
              email TEXT PRIMARY KEY,
              otp TEXT NOT NULL,
              expires_at TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            """
        )
        conn.commit()
    finally:
        conn.close()


def sign_token(user_id: int, username: str) -> str:
    payload = {
        "sub": str(user_id),
        "username": username,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def get_bearer_token() -> str | None:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None


def auth_required():
    token = get_bearer_token()
    if not token:
        return None, (jsonify({"error": "Missing auth token."}), 401)
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return payload, None
    except Exception:
        return None, (jsonify({"error": "Invalid or expired token."}), 401)


def auth_optional():
    token = get_bearer_token()
    if not token:
        return None
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except Exception:
        return None


def require_user(conn: sqlite3.Connection, payload: dict):
    """
    Ensure the authenticated user referenced by the JWT exists in the DB.
    Returns (user_row, error_response_or_none)
    """
    try:
        user_id = int(payload.get("sub"))
    except Exception:
        return None, (jsonify({"error": "Invalid or expired token."}), 401)

    user = conn.execute("SELECT id, username FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        return None, (jsonify({"error": "Session is no longer valid. Please login again."}), 401)
    return user, None


app = Flask(__name__, static_folder=None)
CORS(app, resources={r"/api/*": {"origins": ["https://voting-system-ftib.onrender.com", "http://127.0.0.1:3000", "http://localhost:3000"]}}, supports_credentials=True)

app.config.update(
    MAIL_SERVER=os.getenv("MAIL_SERVER", "smtp.gmail.com"),
    MAIL_PORT=int(os.getenv("MAIL_PORT", "587")),
    MAIL_USE_TLS=os.getenv("MAIL_USE_TLS", "true").lower() in ("1", "true", "yes"),
    MAIL_USE_SSL=os.getenv("MAIL_USE_SSL", "false").lower() in ("1", "true", "yes"),
    MAIL_USERNAME=os.getenv("MAIL_USERNAME"),
    MAIL_PASSWORD=os.getenv("MAIL_PASSWORD"),
    MAIL_DEFAULT_SENDER=os.getenv("MAIL_DEFAULT_SENDER") or os.getenv("MAIL_USERNAME"),
)
mail = Mail(app)
OTP_EXPIRY_MINUTES = int(os.getenv("OTP_EXPIRY_MINUTES", "10"))


def send_email_otp(email: str, otp: str) -> None:
    if not app.config["MAIL_USERNAME"] or not app.config["MAIL_PASSWORD"]:
        raise RuntimeError("Mail credentials are not configured.")

    message = Message(
        subject="Your Voting System OTP",
        recipients=[email],
        body=(
            f"Your one-time password for the voting system is {otp}. "
            f"This code expires in {OTP_EXPIRY_MINUTES} minutes."
        ),
    )
    mail.send(message)


@app.route("/api/register", methods=["OPTIONS"])
def register_options():
    return make_response("", 204)


@app.get("/api/health")
def health():
    return jsonify({"ok": True})


@app.post("/api/send-otp")
def send_otp():
    body = request.get_json(silent=True) or {}
    email = str(body.get("email", "")).strip()
    if not is_valid_email(email):
        return jsonify({"error": "Enter a valid email address."}), 400

    otp = f"{secrets.randbelow(900000) + 100000:06d}"
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=OTP_EXPIRY_MINUTES)).isoformat()

    conn = get_db()
    try:
        conn.execute("DELETE FROM otps WHERE expires_at < ?", (now_iso(),))
        conn.execute(
            "INSERT OR REPLACE INTO otps (email, otp, expires_at, created_at) VALUES (?, ?, ?, ?)",
            (email, otp, expires_at, now_iso()),
        )
        conn.commit()
        send_email_otp(email, otp)
        return jsonify({"ok": True, "message": "OTP sent to your email."})
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 500
    except Exception:
        return jsonify({"error": "Unable to send OTP email. Please check mail configuration."}), 500
    finally:
        conn.close()


@app.post("/api/verify-otp")
def verify_otp():
    body = request.get_json(silent=True) or {}
    email = str(body.get("email", "")).strip()
    otp = str(body.get("otp", "")).strip()

    if not is_valid_email(email):
        return jsonify({"error": "Enter a valid email address."}), 400
    if not re.fullmatch(r"\d{6}", otp):
        return jsonify({"error": "Enter a valid 6-digit OTP."}), 400

    conn = get_db()
    try:
        row = conn.execute("SELECT otp, expires_at FROM otps WHERE email = ?", (email,)).fetchone()
        if not row:
            return jsonify({"error": "OTP not found. Request a new code."}), 404

        expires_at = datetime.fromisoformat(row["expires_at"])
        if datetime.now(timezone.utc) > expires_at:
            conn.execute("DELETE FROM otps WHERE email = ?", (email,))
            conn.commit()
            return jsonify({"error": "OTP has expired. Request a new code."}), 400

        if row["otp"] != otp:
            return jsonify({"error": "Invalid OTP. Please try again."}), 400

        conn.execute("DELETE FROM otps WHERE email = ?", (email,))
        conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


@app.post("/api/register")
def register():
    body = request.get_json(silent=True) or {}
    username = str(body.get("username", "")).strip()
    password = str(body.get("password", ""))

    if len(username) < 3:
        return jsonify({"error": "Username must be at least 3 characters."}), 400
    if len(password) < 4:
        return jsonify({"error": "Password must be at least 4 characters."}), 400

    conn = get_db()
    try:
        existing = conn.execute("SELECT id FROM users WHERE lower(username)=lower(?)", (username,)).fetchone()
        if existing:
            return jsonify({"error": "Username already exists."}), 409

        pw_hash = pbkdf2_sha256.hash(password)
        cur = conn.execute(
            "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
            (username, pw_hash, now_iso()),
        )
        conn.commit()
        user_id = int(cur.lastrowid)
        token = sign_token(user_id, username)
        return jsonify({"user": {"username": username}, "token": token})
    finally:
        conn.close()


@app.post("/api/login")
def login():
    body = request.get_json(silent=True) or {}
    username = str(body.get("username", "")).strip()
    password = str(body.get("password", ""))

    if not username or not password:
        return jsonify({"error": "Enter username and password."}), 400

    conn = get_db()
    try:
        user = conn.execute(
            "SELECT id, username, password_hash FROM users WHERE lower(username)=lower(?)", (username,)
        ).fetchone()
        if not user or not pbkdf2_sha256.verify(password, user["password_hash"]):
            return jsonify({"error": "Invalid username or password."}), 401

        token = sign_token(int(user["id"]), str(user["username"]))
        return jsonify({"user": {"username": user["username"]}, "token": token})
    finally:
        conn.close()


@app.get("/api/polls/mine")
def my_polls():
    payload, err = auth_required()
    if err:
        return err

    conn = get_db()
    try:
        user, user_err = require_user(conn, payload)
        if user_err:
            return user_err
        user_id = int(user["id"])
        rows = conn.execute(
            """
            SELECT p.id, p.title,
              (SELECT COUNT(*) FROM votes v WHERE v.poll_id = p.id) AS totalVotes
            FROM polls p
            WHERE p.created_by_user_id = ?
            ORDER BY p.created_at DESC
            """,
            (user_id,),
        ).fetchall()
        return jsonify({"polls": [{"id": r["id"], "title": r["title"], "totalVotes": r["totalVotes"]} for r in rows]})
    finally:
        conn.close()


@app.post("/api/polls")
def create_poll():
    payload, err = auth_required()
    if err:
        return err

    body = request.get_json(silent=True) or {}
    title = str(body.get("title", "")).strip()
    candidates = body.get("candidates", [])
    if not isinstance(candidates, list):
        candidates = []

    normalized = [str(c or "").strip() for c in candidates]
    normalized = [c for c in normalized if c]

    if len(title) < 4:
        return jsonify({"error": "Poll title must be at least 4 characters."}), 400
    if len(normalized) < 2:
        return jsonify({"error": "Enter at least 2 candidates."}), 400

    lower = [c.lower() for c in normalized]
    if len(set(lower)) != len(lower):
        return jsonify({"error": "Candidate names must be unique."}), 400

    poll_id = make_poll_id()

    conn = get_db()
    try:
        user, user_err = require_user(conn, payload)
        if user_err:
            return user_err
        user_id = int(user["id"])
        conn.execute(
            "INSERT INTO polls (id, title, created_by_user_id, created_at) VALUES (?, ?, ?, ?)",
            (poll_id, title, user_id, now_iso()),
        )
        for name in normalized:
            conn.execute("INSERT INTO candidates (poll_id, name) VALUES (?, ?)", (poll_id, name))
        conn.commit()

        poll = conn.execute(
            """
            SELECT p.id, p.title, p.created_at, u.username AS createdBy
            FROM polls p
            JOIN users u ON u.id = p.created_by_user_id
            WHERE p.id = ?
            """,
            (poll_id,),
        ).fetchone()
        cand = conn.execute("SELECT id, name FROM candidates WHERE poll_id = ? ORDER BY id ASC", (poll_id,)).fetchall()

        return jsonify(
            {
                "poll": {
                    "id": poll["id"],
                    "title": poll["title"],
                    "createdBy": poll["createdBy"],
                    "createdAt": poll["created_at"],
                    "candidates": [{"id": c["id"], "name": c["name"]} for c in cand],
                    "totalVotes": 0,
                }
            }
        )
    except sqlite3.IntegrityError:
        # Most commonly: token user doesn't exist anymore, or DB got reset.
        return jsonify({"error": "Session is no longer valid. Please login again."}), 401
    finally:
        conn.close()


@app.get("/api/polls/<poll_id>")
def get_poll(poll_id: str):
    payload = auth_optional()

    conn = get_db()
    try:
        poll = conn.execute(
            """
            SELECT p.id, p.title, p.created_at, u.username AS createdBy
            FROM polls p
            JOIN users u ON u.id = p.created_by_user_id
            WHERE p.id = ?
            """,
            (poll_id,),
        ).fetchone()
        if not poll:
            return jsonify({"error": "Poll not found."}), 404

        candidates = conn.execute("SELECT id, name FROM candidates WHERE poll_id = ? ORDER BY id ASC", (poll_id,)).fetchall()
        total_votes = conn.execute("SELECT COUNT(*) AS c FROM votes WHERE poll_id = ?", (poll_id,)).fetchone()["c"]

        has_voted = False
        if payload and payload.get("sub"):
            user_id = int(payload["sub"])
            row = conn.execute(
                "SELECT 1 FROM votes WHERE poll_id = ? AND user_id = ?",
                (poll_id, user_id),
            ).fetchone()
            has_voted = bool(row)

        return jsonify(
            {
                "poll": {
                    "id": poll["id"],
                    "title": poll["title"],
                    "createdBy": poll["createdBy"],
                    "createdAt": poll["created_at"],
                    "candidates": [{"id": c["id"], "name": c["name"]} for c in candidates],
                    "totalVotes": total_votes,
                    "hasVoted": has_voted,
                }
            }
        )
    finally:
        conn.close()


@app.post("/api/polls/<poll_id>/vote")
def vote(poll_id: str):
    payload, err = auth_required()
    if err:
        return err

    body = request.get_json(silent=True) or {}
    try:
        candidate_id = int(body.get("candidateId"))
    except Exception:
        return jsonify({"error": "Invalid candidate."}), 400

    conn = get_db()
    try:
        user, user_err = require_user(conn, payload)
        if user_err:
            return user_err
        user_id = int(user["id"])
        poll = conn.execute("SELECT id FROM polls WHERE id = ?", (poll_id,)).fetchone()
        if not poll:
            return jsonify({"error": "Poll not found."}), 404

        candidate = conn.execute(
            "SELECT id FROM candidates WHERE id = ? AND poll_id = ?",
            (candidate_id, poll_id),
        ).fetchone()
        if not candidate:
            return jsonify({"error": "Invalid candidate."}), 400

        existing = conn.execute(
            "SELECT 1 FROM votes WHERE poll_id = ? AND user_id = ?",
            (poll_id, user_id),
        ).fetchone()
        if existing:
            return jsonify({"error": "You have already voted in this poll."}), 409

        conn.execute(
            "INSERT INTO votes (poll_id, user_id, candidate_id, created_at) VALUES (?, ?, ?, ?)",
            (poll_id, user_id, candidate_id, now_iso()),
        )
        conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


@app.get("/api/polls/<poll_id>/results")
def results(poll_id: str):
    conn = get_db()
    try:
        poll = conn.execute("SELECT id FROM polls WHERE id = ?", (poll_id,)).fetchone()
        if not poll:
            return jsonify({"error": "Poll not found."}), 404

        rows = conn.execute(
            """
            SELECT c.id, c.name, COUNT(v.candidate_id) AS votes
            FROM candidates c
            LEFT JOIN votes v ON v.candidate_id = c.id AND v.poll_id = c.poll_id
            WHERE c.poll_id = ?
            GROUP BY c.id, c.name
            ORDER BY c.id ASC
            """,
            (poll_id,),
        ).fetchall()
        return jsonify({"results": [{"id": r["id"], "name": r["name"], "votes": r["votes"]} for r in rows]})
    finally:
        conn.close()


@app.get("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/<path:filename>")
def static_files(filename: str):
    return send_from_directory(STATIC_DIR, filename)


if __name__ == "__main__":
    init_db()
    host = os.getenv("HOST", "127.0.0.1")
    debug = os.getenv("FLASK_DEBUG", "0").lower() in ("1", "true", "yes")
    app.run(host=host, port=PORT, debug=debug)

