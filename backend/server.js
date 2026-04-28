require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const { db } = require("./db");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

app.use(morgan("dev"));
app.use(express.json());
app.use(cors());

function nowIso() {
  return new Date().toISOString();
}

function makePollId() {
  return `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
}

function authOptional(req, _res, next) {
  const header = req.header("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    req.user = null;
  }
  return next();
}

function authRequired(req, res, next) {
  const header = req.header("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing auth token." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/register", (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");

  if (username.length < 3) return res.status(400).json({ error: "Username must be at least 3 characters." });
  if (password.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters." });

  const existing = db.prepare("SELECT id FROM users WHERE lower(username)=lower(?)").get(username);
  if (existing) return res.status(409).json({ error: "Username already exists." });

  const password_hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)")
    .run(username, password_hash, nowIso());

  const user = { id: Number(info.lastInsertRowid), username };
  const token = signToken(user);
  return res.json({ user: { username }, token });
});

app.post("/api/login", (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");

  if (!username || !password) return res.status(400).json({ error: "Enter username and password." });

  const user = db.prepare("SELECT id, username, password_hash FROM users WHERE lower(username)=lower(?)").get(username);
  if (!user) return res.status(401).json({ error: "Invalid username or password." });

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid username or password." });

  const token = signToken({ id: user.id, username: user.username });
  return res.json({ user: { username: user.username }, token });
});

app.get("/api/me", authRequired, (req, res) => {
  res.json({ user: { username: req.user.username } });
});

app.post("/api/polls", authRequired, (req, res) => {
  const title = String(req.body?.title || "").trim();
  const candidates = Array.isArray(req.body?.candidates) ? req.body.candidates : [];

  const normalized = candidates.map((c) => String(c || "").trim()).filter(Boolean);

  if (title.length < 4) return res.status(400).json({ error: "Poll title must be at least 4 characters." });
  if (normalized.length < 2) return res.status(400).json({ error: "Enter at least 2 candidates." });

  const uniqueCheck = new Set(normalized.map((c) => c.toLowerCase()));
  if (uniqueCheck.size !== normalized.length) return res.status(400).json({ error: "Candidate names must be unique." });

  const pollId = makePollId();

  const tx = db.transaction(() => {
    db.prepare("INSERT INTO polls (id, title, created_by_user_id, created_at) VALUES (?, ?, ?, ?)").run(
      pollId,
      title,
      req.user.sub,
      nowIso()
    );
    const stmt = db.prepare("INSERT INTO candidates (poll_id, name) VALUES (?, ?)");
    normalized.forEach((name) => stmt.run(pollId, name));
  });

  tx();

  const poll = db
    .prepare(
      `
      SELECT p.id, p.title, p.created_at, u.username AS createdBy
      FROM polls p
      JOIN users u ON u.id = p.created_by_user_id
      WHERE p.id = ?
    `
    )
    .get(pollId);

  const cand = db.prepare("SELECT id, name FROM candidates WHERE poll_id = ? ORDER BY id ASC").all(pollId);

  return res.json({
    poll: {
      id: poll.id,
      title: poll.title,
      createdBy: poll.createdBy,
      createdAt: poll.created_at,
      candidates: cand.map((c) => ({ id: c.id, name: c.name })),
      totalVotes: 0
    }
  });
});

app.get("/api/polls/mine", authRequired, (req, res) => {
  const rows = db
    .prepare(
      `
      SELECT p.id, p.title,
        (SELECT COUNT(*) FROM votes v WHERE v.poll_id = p.id) AS totalVotes
      FROM polls p
      WHERE p.created_by_user_id = ?
      ORDER BY p.created_at DESC
    `
    )
    .all(req.user.sub);

  res.json({ polls: rows.map((r) => ({ id: r.id, title: r.title, totalVotes: r.totalVotes })) });
});

app.get("/api/polls/:pollId", authOptional, (req, res) => {
  const pollId = String(req.params.pollId || "");
  const poll = db
    .prepare(
      `
      SELECT p.id, p.title, p.created_at, u.username AS createdBy
      FROM polls p
      JOIN users u ON u.id = p.created_by_user_id
      WHERE p.id = ?
    `
    )
    .get(pollId);

  if (!poll) return res.status(404).json({ error: "Poll not found." });

  const candidates = db.prepare("SELECT id, name FROM candidates WHERE poll_id = ? ORDER BY id ASC").all(pollId);
  const totalVotes = db.prepare("SELECT COUNT(*) AS c FROM votes WHERE poll_id = ?").get(pollId)?.c ?? 0;

  let hasVoted = false;
  if (req.user?.sub) {
    const row = db.prepare("SELECT 1 FROM votes WHERE poll_id = ? AND user_id = ?").get(pollId, req.user.sub);
    hasVoted = Boolean(row);
  }

  return res.json({
    poll: {
      id: poll.id,
      title: poll.title,
      createdBy: poll.createdBy,
      createdAt: poll.created_at,
      candidates: candidates.map((c) => ({ id: c.id, name: c.name })),
      totalVotes,
      hasVoted
    }
  });
});

app.post("/api/polls/:pollId/vote", authRequired, (req, res) => {
  const pollId = String(req.params.pollId || "");
  const candidateId = Number(req.body?.candidateId);
  if (!Number.isFinite(candidateId)) return res.status(400).json({ error: "Invalid candidate." });

  const poll = db.prepare("SELECT id FROM polls WHERE id = ?").get(pollId);
  if (!poll) return res.status(404).json({ error: "Poll not found." });

  const candidate = db.prepare("SELECT id FROM candidates WHERE id = ? AND poll_id = ?").get(candidateId, pollId);
  if (!candidate) return res.status(400).json({ error: "Invalid candidate." });

  const existing = db.prepare("SELECT 1 FROM votes WHERE poll_id = ? AND user_id = ?").get(pollId, req.user.sub);
  if (existing) return res.status(409).json({ error: "You have already voted in this poll." });

  db.prepare("INSERT INTO votes (poll_id, user_id, candidate_id, created_at) VALUES (?, ?, ?, ?)").run(
    pollId,
    req.user.sub,
    candidateId,
    nowIso()
  );

  return res.json({ ok: true });
});

app.get("/api/polls/:pollId/results", (req, res) => {
  const pollId = String(req.params.pollId || "");
  const poll = db.prepare("SELECT id FROM polls WHERE id = ?").get(pollId);
  if (!poll) return res.status(404).json({ error: "Poll not found." });

  const rows = db
    .prepare(
      `
      SELECT c.id, c.name, COUNT(v.candidate_id) AS votes
      FROM candidates c
      LEFT JOIN votes v ON v.candidate_id = c.id AND v.poll_id = c.poll_id
      WHERE c.poll_id = ?
      GROUP BY c.id, c.name
      ORDER BY c.id ASC
    `
    )
    .all(pollId);

  res.json({ results: rows.map((r) => ({ id: r.id, name: r.name, votes: r.votes })) });
});

// Serve your existing frontend
const staticDir = path.join(__dirname, "..", "Voting System");
app.use(express.static(staticDir));
app.get("/", (_req, res) => {
  res.sendFile(path.join(staticDir, "index.html"));
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on http://localhost:${PORT}`);
});

