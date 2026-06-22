# Lian website

Standalone marketing site and local Console prototype for [Lian](https://github.com/ebeirne/Lian). This repository contains only the website; it does not modify or include Lian's application code.

## Run locally

```bash
node server.js
```

Open `http://localhost:8000`. The Console, including API-key creation and its local JSON-backed API, is available from `http://localhost:8000/app.html`.

## OAuth

Copy `.env.example` to `.env` and provide Google and GitHub OAuth credentials. Configure these callback URLs in the respective OAuth applications:

```text
http://localhost:8000/auth/google/callback
http://localhost:8000/auth/github/callback
```

For a deployed service, set `BASE_URL` to the public HTTPS URL and update both callbacks. The local API-key store is deliberately ignored by Git.
