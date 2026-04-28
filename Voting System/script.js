class AuthService {
  static KEYS = {
    token: "ovs_token",
    currentUser: "ovs_current_user",
  };

  static getToken() {
    return localStorage.getItem(this.KEYS.token);
  }

  static setSession({ token, username }) {
    localStorage.setItem(this.KEYS.token, token);
    localStorage.setItem(this.KEYS.currentUser, username);
  }

  static logout() {
    localStorage.removeItem(this.KEYS.token);
    localStorage.removeItem(this.KEYS.currentUser);
  }

  static getCurrentUser() {
    return localStorage.getItem(this.KEYS.currentUser);
  }
}

class Api {
  static async request(path, { method = "GET", body } = {}) {
    const headers = { "Content-Type": "application/json" };
    const token = AuthService.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || "Request failed.");
    }
    return data;
  }
}

class PollService {
  static async createPoll({ title, candidates }) {
    const data = await Api.request("/api/polls", { method: "POST", body: { title, candidates } });
    return data.poll;
  }

  static async getPollById(pollId) {
    const data = await Api.request(`/api/polls/${encodeURIComponent(pollId)}`);
    return data.poll;
  }

  static async getMyPolls() {
    const data = await Api.request("/api/polls/mine");
    return data.polls;
  }

  static async vote({ pollId, candidateId }) {
    await Api.request(`/api/polls/${encodeURIComponent(pollId)}/vote`, { method: "POST", body: { candidateId } });
  }

  static async getResultCounts(pollId) {
    const data = await Api.request(`/api/polls/${encodeURIComponent(pollId)}/results`);
    return data.results;
  }
}

class UIController {
  constructor() {
    this.chart = null;
    this.activePollId = this.getPollIdFromUrl();
    this.bindElements();
    this.bindEvents();
    this.render();
  }

  bindElements() {
    this.messageBox = document.getElementById("appMessage");
    this.authSection = document.getElementById("authSection");
    this.dashboardSection = document.getElementById("dashboardSection");
    this.pollSection = document.getElementById("pollSection");

    this.identityModal = document.getElementById("identityModal");
    this.identityForm = document.getElementById("identityForm");
    this.verifyIdentityBtn = document.getElementById("verifyIdentityBtn");
    this.cancelVerificationBtn = document.getElementById("cancelVerificationBtn");

    this.showLoginBtn = document.getElementById("showLoginBtn");
    this.showRegisterBtn = document.getElementById("showRegisterBtn");
    this.loginForm = document.getElementById("loginForm");
    this.registerForm = document.getElementById("registerForm");

    this.currentUserLabel = document.getElementById("currentUserLabel");
    this.logoutBtn = document.getElementById("logoutBtn");
    this.createPollForm = document.getElementById("createPollForm");
    this.openPollForm = document.getElementById("openPollForm");
    this.myPolls = document.getElementById("myPolls");
    this.pollLinkInput = document.getElementById("pollLinkInput");

    this.pollTitleLabel = document.getElementById("pollTitleLabel");
    this.pollIdLabel = document.getElementById("pollIdLabel");
    this.pollShareLink = document.getElementById("pollShareLink");
    this.copyPollLinkBtn = document.getElementById("copyPollLinkBtn");
    this.backDashboardBtn = document.getElementById("backDashboardBtn");
    this.candidateList = document.getElementById("candidateList");
    this.resultCounts = document.getElementById("resultCounts");
    this.chartCanvas = document.getElementById("resultsChart");
  }
    this.pollShareLink = document.getElementById("pollShareLink");
    this.copyPollLinkBtn = document.getElementById("copyPollLinkBtn");
    this.backDashboardBtn = document.getElementById("backDashboardBtn");
    this.candidateList = document.getElementById("candidateList");
    this.resultCounts = document.getElementById("resultCounts");
    this.chartCanvas = document.getElementById("resultsChart");
  }

  bindEvents() {
    this.showLoginBtn.addEventListener("click", () => this.toggleAuth("login"));
    this.showRegisterBtn.addEventListener("click", () => this.toggleAuth("register"));

    this.verifyIdentityBtn.addEventListener("click", () => this.handleIdentityVerification());
    this.cancelVerificationBtn.addEventListener("click", () => this.closeIdentityModal());

    this.registerForm.addEventListener("submit", (event) => {
      event.preventDefault();
      this.handleRegister();
    });

    this.loginForm.addEventListener("submit", (event) => {
      event.preventDefault();
      this.handleLogin();
    });

    this.logoutBtn.addEventListener("click", () => {
      AuthService.logout();
      this.activePollId = this.getPollIdFromUrl();
      this.render();
      this.showMessage("Logged out.", "success");
    });

    this.createPollForm.addEventListener("submit", (event) => {
      event.preventDefault();
      this.handleCreatePoll();
    });

    this.openPollForm.addEventListener("submit", (event) => {
      event.preventDefault();
      this.handleOpenPollFromInput();
    });

    this.copyPollLinkBtn.addEventListener("click", async () => {
      const link = this.getPollLink(this.activePollId);
      try {
        await navigator.clipboard.writeText(link);
        this.showMessage("Poll link copied.", "success");
      } catch {
        this.showMessage("Copy failed. You can copy manually from the link box.", "error");
      }
    });

    this.backDashboardBtn.addEventListener("click", () => {
      this.activePollId = null;
      this.replaceUrlPoll(null);
      this.render();
    });
  }

  getPollIdFromUrl() {
    const url = new URL(window.location.href);
    return url.searchParams.get("poll");
  }

  replaceUrlPoll(pollId) {
    const url = new URL(window.location.href);
    if (pollId) {
      url.searchParams.set("poll", pollId);
    } else {
      url.searchParams.delete("poll");
    }
    window.history.replaceState({}, "", url.toString());
  }

  getPollLink(pollId) {
    const url = new URL(window.location.href);
    url.searchParams.set("poll", pollId);
    return url.toString();
  }

  extractPollIdFromText(value) {
    const text = value.trim();
    if (!text) return "";
    if (text.includes("http://") || text.includes("https://")) {
      try {
        const url = new URL(text);
        return url.searchParams.get("poll") || "";
      } catch {
        return "";
      }
    }
    return text;
  }

  toggleAuth(type) {
    const loginActive = type === "login";
    this.loginForm.classList.toggle("hidden", !loginActive);
    this.registerForm.classList.toggle("hidden", loginActive);
    this.showLoginBtn.classList.toggle("bg-blue-600", loginActive);
    this.showLoginBtn.classList.toggle("text-white", loginActive);
    this.showLoginBtn.classList.toggle("bg-gray-100", !loginActive);
    this.showLoginBtn.classList.toggle("text-gray-700", !loginActive);
    this.showRegisterBtn.classList.toggle("bg-green-600", !loginActive);
    this.showRegisterBtn.classList.toggle("text-white", !loginActive);
    this.showRegisterBtn.classList.toggle("bg-gray-100", loginActive);
    this.showRegisterBtn.classList.toggle("text-gray-700", loginActive);
  }

  handleRegister() {
    const username = document.getElementById("registerUsername").value.trim();
    const password = document.getElementById("registerPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (username.length < 3) return this.showMessage("Username must be at least 3 characters.", "error");
    if (password.length < 4) return this.showMessage("Password must be at least 4 characters.", "error");
    if (password !== confirmPassword) return this.showMessage("Passwords do not match.", "error");

    Api.request("/api/register", { method: "POST", body: { username, password } })
      .then((data) => {
        AuthService.setSession({ token: data.token, username: data.user.username });
        this.registerForm.reset();
        this.render();
        this.showMessage("Registration successful.", "success");
      })
      .catch((error) => {
        this.showMessage(error.message, "error");
      });
  }

  handleLogin() {
    const username = document.getElementById("loginUsername").value.trim();
    const password = document.getElementById("loginPassword").value;
    if (!username || !password) return this.showMessage("Enter username and password.", "error");
    Api.request("/api/login", { method: "POST", body: { username, password } })
      .then((data) => {
        AuthService.setSession({ token: data.token, username: data.user.username });
        this.loginForm.reset();
        this.render();
        this.showMessage("Login successful.", "success");
      })
      .catch((error) => {
        this.showMessage(error.message, "error");
      });
  }

  handleCreatePoll() {
    const currentUser = AuthService.getCurrentUser();
    if (!currentUser) return this.showMessage("Login first.", "error");

    const title = document.getElementById("pollTitle").value.trim();
    const candidatesText = document.getElementById("pollCandidates").value.trim();
    const candidates = candidatesText
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);

    if (title.length < 4) return this.showMessage("Poll title must be at least 4 characters.", "error");
    if (candidates.length < 2) return this.showMessage("Enter at least 2 candidates.", "error");

    const uniqueCheck = new Set(candidates.map((c) => c.toLowerCase()));
    if (uniqueCheck.size !== candidates.length) return this.showMessage("Candidate names must be unique.", "error");

    PollService.createPoll({ title, candidates })
      .then((poll) => {
        this.createPollForm.reset();
        this.activePollId = poll.id;
        this.replaceUrlPoll(poll.id);
        this.render();
        this.showMessage("Poll created. Share the generated link.", "success");
      })
      .catch((error) => this.showMessage(error.message, "error"));
  }

  handleOpenPollFromInput() {
    const pollId = this.extractPollIdFromText(this.pollLinkInput.value);
    if (!pollId) return this.showMessage("Enter a valid poll URL or ID.", "error");
    PollService.getPollById(pollId)
      .then(() => {
        this.activePollId = pollId;
        this.replaceUrlPoll(pollId);
        this.render();
      })
      .catch((error) => this.showMessage(error.message, "error"));
  }

  handleVote(candidateId) {
    const currentUser = AuthService.getCurrentUser();
    if (!currentUser) return this.showMessage("Login first.", "error");

    // Show identity verification modal before voting
    this.showIdentityModal(() => {
      PollService.vote({ pollId: this.activePollId, candidateId: Number(candidateId) })
        .then(() => {
          this.renderPoll();
          this.showMessage("Vote submitted successfully.", "success");
        })
        .catch((error) => this.showMessage(error.message, "error"));
    });
  }

  showIdentityModal(onVerified) {
    this.identityModal.classList.remove("hidden");
    this.onVerifiedCallback = onVerified;
  }

  closeIdentityModal() {
    this.identityModal.classList.add("hidden");
    this.identityForm.reset();
  }

  handleIdentityVerification() {
    const idType = document.getElementById("idType").value;
    const idNumber = document.getElementById("idNumber").value.trim();
    const otp = document.getElementById("otp").value.trim();

    // Basic client-side validation
    if (!idNumber) return this.showMessage("Please enter your ID number.", "error");
    if (!otp) return this.showMessage("Please enter the OTP.", "error");

    // Aadhaar validation (12 digits)
    if (idType === "aadhaar" && !/^\d{12}$/.test(idNumber)) {
      return this.showMessage("Aadhaar number must be 12 digits.", "error");
    }

    // PAN validation (format: AAAAA9999A)
    if (idType === "pan" && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(idNumber.toUpperCase())) {
      return this.showMessage("Invalid PAN format.", "error");
    }

    // OTP validation (6 digits)
    if (!/^\d{6}$/.test(otp)) {
      return this.showMessage("OTP must be 6 digits.", "error");
    }

    // Simulate verification (in real app, this would call backend API)
    this.showMessage("Identity verified successfully.", "success");
    this.closeIdentityModal();
    if (this.onVerifiedCallback) {
      this.onVerifiedCallback();
    }
  }

  renderHostedPolls() {
    const currentUser = AuthService.getCurrentUser();
    this.myPolls.innerHTML = "";
    if (!currentUser) return;

    PollService.getMyPolls()
      .then((hosted) => {
        if (hosted.length === 0) {
          this.myPolls.innerHTML = `<p class="muted">No polls yet. Create your first poll.</p>`;
          return;
        }

        hosted.forEach((poll) => {
          const div = document.createElement("div");
          div.className = "bg-gray-50 border border-gray-200 rounded-lg p-4 flex justify-between items-center";
          div.innerHTML = `
            <div>
              <strong class="text-gray-800">${poll.title}</strong><br />
              <small class="text-gray-600">${poll.totalVotes} vote(s)</small>
            </div>
            <button class="bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition duration-200 open-poll-btn" data-poll-id="${poll.id}">Open</button>
          `;
          this.myPolls.appendChild(div);
        });

        this.myPolls.querySelectorAll(".open-poll-btn").forEach((btn) => {
          btn.addEventListener("click", () => {
            const pollId = btn.getAttribute("data-poll-id");
            this.activePollId = pollId;
            this.replaceUrlPoll(pollId);
            this.render();
          });
        });
      })
      .catch(() => {
        this.myPolls.innerHTML = `<p class="muted">Unable to load your polls.</p>`;
      });
  }

  renderPoll() {
    PollService.getPollById(this.activePollId)
      .then((poll) => Promise.all([Promise.resolve(poll), PollService.getResultCounts(poll.id)]))
      .then(([poll, results]) => {
        const shareLink = this.getPollLink(poll.id);
        this.pollTitleLabel.textContent = poll.title;
        this.pollIdLabel.textContent = poll.id;
        this.pollShareLink.textContent = shareLink;

        const currentUser = AuthService.getCurrentUser();
        const hasVoted = Boolean(currentUser && poll.hasVoted);

        this.candidateList.innerHTML = "";
        poll.candidates.forEach((candidate) => {
          const row = document.createElement("div");
          row.className = "bg-gray-50 border border-gray-200 rounded-lg p-4 flex justify-between items-center";
          row.innerHTML = `
            <strong class="text-gray-800">${candidate.name}</strong>
            <button class="bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition duration-200 vote-btn" data-candidate-id="${candidate.id}" ${
              hasVoted ? "disabled" : ""
            }>
              ${hasVoted ? "Already Voted" : "Vote"}
            </button>
          `;
          this.candidateList.appendChild(row);
        });

        this.candidateList.querySelectorAll(".vote-btn").forEach((btn) => {
          btn.addEventListener("click", () => {
            const candidateId = btn.getAttribute("data-candidate-id");
            this.handleVote(candidateId);
          });
        });

        this.resultCounts.innerHTML = "";
        results.forEach((item) => {
          const row = document.createElement("div");
          row.className = "bg-gray-50 border border-gray-200 rounded-md p-3 flex justify-between";
          row.innerHTML = `<span class="text-gray-700">${item.name}</span><strong class="text-blue-600">${item.votes} vote(s)</strong>`;
          this.resultCounts.appendChild(row);
        });

        const labels = results.map((x) => x.name);
        const data = results.map((x) => x.votes);
        if (!this.chart) {
          this.chart = new Chart(this.chartCanvas, {
            type: "bar",
            data: {
              labels,
              datasets: [
                {
                  label: "Votes",
                  data,
                  borderRadius: 6,
                  backgroundColor: ["#3458f5", "#0ca678", "#f59f00", "#8f46e8", "#f03e3e", "#228be6"],
                },
              ],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                y: {
                  beginAtZero: true,
                  ticks: { precision: 0 },
                },
              },
            },
          });
        } else {
          this.chart.data.labels = labels;
          this.chart.data.datasets[0].data = data;
          this.chart.update();
        }
      })
      .catch(() => {
        this.showMessage("This poll link is invalid or expired.", "error");
        this.activePollId = null;
        this.replaceUrlPoll(null);
        this.pollSection.classList.add("hidden");
      });
  }

  render() {
    const currentUser = AuthService.getCurrentUser();
    const loggedIn = Boolean(currentUser);

    this.authSection.classList.toggle("hidden", loggedIn);
    this.dashboardSection.classList.toggle("hidden", !loggedIn);
    this.pollSection.classList.toggle("hidden", !loggedIn || !this.activePollId);

    if (!loggedIn) return;

    this.currentUserLabel.textContent = currentUser;
    this.renderHostedPolls();

    if (this.activePollId) {
      this.renderPoll();
    } else if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }

  showMessage(text, type = "success") {
    this.messageBox.textContent = text;
    this.messageBox.className = `rounded-md p-4 mb-4 text-center font-medium animate-slide-up`;
    if (type === "success") {
      this.messageBox.classList.add("bg-green-100", "border", "border-green-400", "text-green-800");
    } else {
      this.messageBox.classList.add("bg-red-100", "border", "border-red-400", "text-red-800");
    }
    setTimeout(() => {
      this.messageBox.className = "message hidden";
      this.messageBox.textContent = "";
    }, 2500);
  }
}
new UIController();
