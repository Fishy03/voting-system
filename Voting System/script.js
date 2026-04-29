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
  static BASE_URL = window.location.protocol === "file:" ? "http://127.0.0.1:3000" : "https://voting-system-ftib.onrender.com";

  static async request(path, { method = "GET", body } = {}) {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    const token = AuthService.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const url = new URL(path, Api.BASE_URL).toString();
    const res = await fetch(url, {
      method,
      mode: "cors",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || `Request failed (${res.status}).`);
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
    this.storedOtp = null; // For email OTP verification
    this.bindElements();
    this.bindEvents();
    this.toggleAuth("login"); // Set initial tab to login
    this.render();
  }

  bindElements() {
    this.messageBox = document.getElementById("appMessage");
    this.authSection = document.getElementById("authSection");
    this.dashboardSection = document.getElementById("dashboardSection");
    this.pollSection = document.getElementById("pollSection");

    this.identityModal = document.getElementById("identityModal");
    this.identityForm = document.getElementById("identityForm");
    this.sendOtpBtn = document.getElementById("sendOtpBtn");
    this.verifyIdentityBtn = document.getElementById("verifyIdentityBtn");
    this.cancelVerificationBtn = document.getElementById("cancelVerificationBtn");
    this.captchaQuestion = document.getElementById("captchaQuestion");

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

  bindEvents() {
    this.showLoginBtn.addEventListener("click", () => this.toggleAuth("login"));
    this.showRegisterBtn.addEventListener("click", () => this.toggleAuth("register"));

    // Identity/OTP UI is optional; don't crash if the modal isn't present in HTML.
    if (this.sendOtpBtn) {
      this.sendOtpBtn.addEventListener("click", () => this.sendOtp());
    }
    if (this.verifyIdentityBtn) {
      this.verifyIdentityBtn.addEventListener("click", () => this.handleIdentityVerification());
    }
    if (this.cancelVerificationBtn) {
      this.cancelVerificationBtn.addEventListener("click", () => this.closeIdentityModal());
    }

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
    this.showLoginBtn.classList.toggle("bg-primary-600", loginActive);
    this.showLoginBtn.classList.toggle("text-white", loginActive);
    this.showLoginBtn.classList.toggle("bg-gray-100", !loginActive);
    this.showLoginBtn.classList.toggle("text-gray-700", !loginActive);
    this.showRegisterBtn.classList.toggle("bg-secondary-600", !loginActive);
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
    // If identity modal isn't present, continue without blocking.
    if (!this.identityModal) {
      onVerified();
      return;
    }
    this.generateCaptcha();
    this.identityModal.classList.remove("hidden");
    this.onVerifiedCallback = onVerified;
  }

  closeIdentityModal() {
    if (!this.identityModal) return;
    this.identityModal.classList.add("hidden");
    this.storedOtp = null; // Reset OTP
  }

  generateCaptcha() {
    if (!this.captchaQuestion) return;
    const num1 = Math.floor(Math.random() * 10) + 1;
    const num2 = Math.floor(Math.random() * 10) + 1;
    this.captchaAnswer = num1 + num2;
    this.captchaQuestion.textContent = `${num1} + ${num2}`;
  }

  async sendOtp() {
    // OTP is temporarily disabled to unblock voting/demo.
    this.showMessage("OTP sending is temporarily disabled.", "error");
    return;
    const email = document.getElementById("email").value.trim();
    if (!email) {
      this.showMessage("Please enter your email address.", "error");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      this.showMessage("Please enter a valid email address.", "error");
      return;
    }

    try {
      await Api.request("/api/send-otp", { method: "POST", body: { email } });
      this.showMessage("OTP sent to your email. Check your inbox.", "success");
    } catch (error) {
      this.showMessage(error.message, "error");
    }
  }

  async handleIdentityVerification() {
    const captcha = document.getElementById("captcha").value.trim();

    // OTP is temporarily disabled: only CAPTCHA is required.
    if (!captcha) return this.showMessage("Please solve the CAPTCHA.", "error");

    // CAPTCHA validation
    if (parseInt(captcha) !== this.captchaAnswer) {
      this.generateCaptcha();
      document.getElementById("captcha").value = "";
      return this.showMessage("Incorrect CAPTCHA answer. Try again.", "error");
    }

    this.showMessage("Identity verified (OTP disabled).", "success");
    this.closeIdentityModal();
    if (this.onVerifiedCallback) this.onVerifiedCallback();
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
          div.className = "bg-gradient-to-r from-gray-50 to-gray-100 border-2 border-gray-200 rounded-xl p-6 flex justify-between items-center shadow-soft hover:shadow-medium transition-all duration-200 animate-fade-in";
          div.innerHTML = `
            <div class="flex-1">
              <strong class="text-gray-800 text-lg block mb-1">${poll.title}</strong>
              <small class="text-gray-600">${poll.totalVotes} vote(s)</small>
            </div>
            <button class="bg-primary-600 text-white py-2 px-4 rounded-lg hover:bg-primary-700 focus:outline-none focus:ring-4 focus:ring-primary-300 transition-all duration-200 font-medium shadow-soft hover:shadow-medium transform hover:-translate-y-0.5 open-poll-btn" data-poll-id="${poll.id}">Open</button>
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
          row.className = "bg-gradient-to-r from-gray-50 to-gray-100 border-2 border-gray-200 rounded-xl p-6 flex justify-between items-center shadow-soft hover:shadow-medium transition-all duration-200 animate-fade-in";
          row.innerHTML = `
            <strong class="text-gray-800 text-lg">${candidate.name}</strong>
            <button class="bg-primary-600 text-white py-3 px-6 rounded-xl hover:bg-primary-700 focus:outline-none focus:ring-4 focus:ring-primary-300 transition-all duration-200 font-semibold shadow-soft hover:shadow-medium transform hover:-translate-y-0.5 vote-btn" data-candidate-id="${candidate.id}" ${
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
          row.className = "bg-gradient-to-r from-gray-50 to-gray-100 border-2 border-gray-200 rounded-lg p-4 flex justify-between items-center shadow-soft animate-fade-in";
          row.innerHTML = `<span class="text-gray-700 font-medium">${item.name}</span><strong class="text-primary-600 text-lg">${item.votes} vote(s)</strong>`;
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
    this.messageBox.className = `rounded-xl p-4 mb-6 text-center font-semibold animate-bounce-in shadow-soft`; 
    if (type === "success") {
      this.messageBox.classList.add("bg-secondary-100", "border-2", "border-secondary-400", "text-secondary-800");
    } else {
      this.messageBox.classList.add("bg-danger-100", "border-2", "border-danger-400", "text-danger-800");
    }
    setTimeout(() => {
      this.messageBox.className = "message hidden";
      this.messageBox.textContent = "";
    }, 3000);
  }
}
new UIController();
