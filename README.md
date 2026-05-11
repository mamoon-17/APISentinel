# APISentinel

![APISentinel](https://img.shields.io/badge/APISentinel-111827?style=for-the-badge)
![v1.0](https://img.shields.io/badge/v1.0-6b7280?style=for-the-badge)
![STATUS](https://img.shields.io/badge/STATUS-374151?style=for-the-badge)
![PRODUCTION](https://img.shields.io/badge/PRODUCTION-22c55e?style=for-the-badge)
![AGENTIC LLM](https://img.shields.io/badge/AGENTIC%20LLM-0ea5e9?style=for-the-badge)
![API CONTRACTS](https://img.shields.io/badge/API%20CONTRACTS-2563eb?style=for-the-badge)

**Agentic API Contract Intelligence**

## Overview

APISentinel is a full-stack application that connects to GitHub, scans repositories, and uses an agentic LLM to map frontend API calls and backend routes, then surfaces inconsistencies and drift. It combines OAuth-powered repo access, automated endpoint discovery, and GPT-4.1-mini via GitHub Models to deliver fast contract insights.

Built using **React.js with Vite** for the frontend and **Node.js (Express + TypeScript)** for the backend, the system provides repository-level API intelligence with a modern UI.

Live Demo: https://api-sentinel-sigma.vercel.app

## Key Features

### OAuth and Identity

- GitHub OAuth for repository access
- Google sign-up and login
- Secure session handling

### Repository Linkage

- Link and sync GitHub repositories
- Public repository linking by URL
- Rate-limit aware fetch and caching

### Agentic LLM Scanning

- GPT-4.1-mini via GitHub Models
- Agentic code scanning that discovers endpoints
- Normalizes paths and methods across stacks
- Detects frontend frameworks (React, Next.js, Angular, Vue, Svelte, Django, HTML/CSS)

### Contract Inconsistency Detection

- Detect missing, extra, and method mismatches
- Highlight request and response schema drift
- Frontend vs backend inconsistencies and drift
- Backend endpoint totals vs OpenAPI spec totals
- Backend vs OpenAPI contract mismatches
- Confidence annotations for resolved findings

### Health Checks and Dashboard

- Queue health checks with retry logic
- Dashboard stats and request logs
- Endpoint usage summaries per repository

## Tech Stack

### Frontend

- **React.js** with TypeScript
- **Vite** for fast development and building
- **Tailwind CSS** for styling
- **React Query** for data fetching
- **Radix UI** components

### Backend

- **Node.js** with TypeScript
- **Express**
- **TypeORM** with MongoDB
- **GitHub OAuth** and **Google OAuth**
- **GitHub Models** with **GPT-4.1-mini**

## Project Structure

```
APISentinel/
├── frontend/           # React frontend application
│   ├── src/
│   │   ├── components/ # UI components
│   │   ├── hooks/      # API hooks
│   │   ├── lib/        # Utilities and API paths
│   │   ├── pages/      # Application pages
│   │   └── types/      # Shared types
│   └── ...
│
├── backend/            # Node.js backend application
│   ├── src/
│   │   ├── application/   # Use-case services
│   │   ├── domain/        # Domain entities and repositories
│   │   ├── infrastructure/# HTTP, persistence, analysis
│   │   ├── shared/        # Config and errors
│   │   ├── app.ts         # Express app setup
│   │   └── server.ts      # Composition root
│   └── ...
└── README.md
```

## Getting Started

### Prerequisites

- **Node.js** (v18 or higher)
- **MongoDB** instance (DATABASE_URI)
- **GitHub OAuth App** (for private repository access)

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/irtaza-shahzad/APISentinel.git
   cd APISentinel
   ```

2. **Setup Backend**

   ```bash
   cd backend
   npm install
   npm run dev
   ```

3. **Setup Frontend**

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

4. **Access the Application**
   - Frontend: `http://localhost:8080`
   - Backend API: `http://localhost:3000`

### Build and Run (Deployment)

Backend

```bash
cd backend
npm run build
npm start
```

Frontend

```bash
cd frontend
npm run build
npm start
```

## Environment Variables

### Frontend (.env)

Create a `.env` file in the `frontend/` directory:

```env
VITE_API_BASE_URL=http://localhost:3000
```

### Backend (.env)

Create a `.env` file in the `backend/` directory:

```env
PORT=3000
DATABASE_URI=your_mongodb_connection_string

# GitHub OAuth
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_CALLBACK_URL=http://localhost:3000/auth/github/callback

# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

# Frontend URL for CORS and redirects
FRONTEND_BASE_URL=http://localhost:8080

# Session signing secret
SESSION_SECRET=replace_with_a_long_random_secret

# LLM features
LLM_ENABLED=true
GITHUB_MODELS_TOKEN=your_github_models_token
```

Tip: you can copy `backend/.env.example` to `backend/.env` and fill in real values.

## Core Modules

| Module                   | Description                                     |
| ------------------------ | ----------------------------------------------- |
| **Authentication**       | GitHub and Google OAuth with secure sessions    |
| **Repositories**         | Link and list GitHub repositories               |
| **Agentic Analysis**     | LLM-powered endpoint discovery and scanning     |
| **Inconsistency Engine** | Detect missing, extra, method, and schema drift |
| **Health Checks**        | Queue and track repository health scans         |
| **Dashboard**            | Summary stats and request logs                  |

## Security Features

- HTTP-only session cookies
- OAuth-based authentication
- Server-side validation and error handling
- Config-based CORS

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is developed for educational purposes.
