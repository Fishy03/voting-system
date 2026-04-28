## Deploy online (Render)

This backend serves both the API and the static frontend.

### 1) Push to GitHub
- Create a GitHub repo and push this project.

### 2) Create Render service
- In Render, choose **New +** → **Blueprint**
- Select your GitHub repo
- Render will read `render.yaml` and create the service.

### 3) Add email credentials (optional)
If you want OTP email sending, set these env vars in Render:
- `MAIL_SERVER` (default: smtp.gmail.com)
- `MAIL_PORT` (default: 587)
- `MAIL_USE_TLS` (default: true)
- `MAIL_USERNAME`
- `MAIL_PASSWORD` (use an App Password for Gmail)
- `MAIL_DEFAULT_SENDER` (optional)

### 4) Open the app
Render will give you a public URL like:
- `https://voting-system-xxxx.onrender.com`

Open it and test:
- register/login
- create poll
- vote/results

