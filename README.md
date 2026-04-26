# api-sentinel

## OAuth setup (GitHub + Google)

### 1. Create a GitHub OAuth app

In GitHub Developer Settings, create an OAuth App with:

- Homepage URL: `http://localhost:8080`
- Authorization callback URL: `http://localhost:3000/auth/github/callback`

### 2. Create a Google OAuth app

In Google Cloud Console:

- Create OAuth 2.0 Client ID (Web application)
- Authorized JavaScript origins: `http://localhost:8080`
- Authorized redirect URI: `http://localhost:3000/auth/google/callback`

### 3. Configure backend environment

Create `backend/.env` with:

```env
PORT=3000
DATABASE_URI=your_database_uri

GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_CALLBACK_URL=http://localhost:3000/auth/github/callback

GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

FRONTEND_BASE_URL=http://localhost:8080
SESSION_SECRET=replace_with_a_long_random_secret

# Optional: force deterministic snapshot fixtures for analysis
# true  -> uses local fixtures only (stable test outputs)
# false -> scans real GitHub repositories
USE_FIXTURE_SNAPSHOTS=false
```

### 4. Configure frontend environment

Create `frontend/.env` with:

```env
VITE_API_BASE_URL=http://localhost:3000
```

### 4. Install dependencies and run

```bash
cd backend
npm install
npm run dev
```

```bash
cd frontend
npm install
npm run dev
```

Then open the frontend and use the GitHub or Google button on the login page.

### Additional backend documentation

- Detailed OAuth method breakdown: `backend/documentation/GITHUB_OAUTH_METHODS.md`
- Session management deep dive: `backend/documentation/SESSION_MANAGEMENT.md`
