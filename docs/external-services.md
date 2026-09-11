# Little Missy's Board - External Services and Dependencies

This document lists the external services, hosted libraries, APIs, and browser capabilities used by the standalone application in `docs/index.html`.

## 1. Firebase Authentication

**Purpose:** Email/password sign-in and session management.

**Endpoints used:**

- Sign in: `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword`
- Refresh ID token: `https://securetoken.googleapis.com/v1/token`

**Configuration:**

- `FIREBASE_API_KEY` in `docs/index.html`
- Firebase Authentication must have the Email/Password provider enabled.
- User accounts must be created in the Firebase project before they can sign in.

**Session behavior:**

- Firebase returns a short-lived ID token and a refresh token after sign-in.
- The ID token is used for authenticated Firestore requests.
- When **Keep me signed in** is enabled, the refresh token and email are stored in browser `localStorage`.
- The ID token is refreshed periodically and restored when the page is reopened.
- Signing out removes the saved session from `localStorage`.

**Important security note:** The Firebase Web API key identifies the Firebase project and is expected to be visible in browser code. It is not a password. Access control must be enforced through Firebase Authentication and Firestore Security Rules.

## 2. Firebase Cloud Firestore

**Purpose:** Shared persistence for calendar events, notices, and homework.

**Endpoint used:**

```text
https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/family_data/board
```

**Configuration:**

- `FIREBASE_PROJECT_ID` in `docs/index.html`
- A Firestore database must exist in the Firebase project.
- The `family_data/board` document path is used by the application.

**Operations:**

- `GET` loads the shared board.
- `PATCH` saves the complete `{ events, notices, homeworkLog }` state.
- The ID token is sent as a Bearer token on requests.
- The app polls approximately every 8 seconds for updates from other devices.

The app uses the Firestore REST API directly and does not load the Firebase JavaScript SDK.

## 3. Anthropic Claude API

**Purpose:** Extract structured events, notices, and homework from pasted text, images, and PDFs.

**Model:** `claude-sonnet-4-6`

**Request type:** Anthropic Messages API request with text, image, or PDF content blocks.

The browser normally sends requests through the Cloudflare Worker described below. Direct browser calls to Anthropic are only a fallback for special testing environments and should not be used for production secrets.

## 4. Cloudflare Worker

**Purpose:** Secure proxy between the browser and Anthropic.

**Source file:** `cloudflare-worker.js`

**Configuration:**

- `PROXY_URL` in `docs/index.html` points to the deployed Worker.
- The Worker stores `ANTHROPIC_API_KEY` as a Cloudflare secret.

**Request flow:**

```text
Browser -> Cloudflare Worker -> Anthropic Claude API
```

The Anthropic API key must remain in the Worker secret store and must not be placed in `docs/index.html`.

## 5. GitHub Pages

**Purpose:** Static hosting for the standalone HTML application.

The deployed site serves `docs/index.html`. GitHub Pages does not run the application backend; Firebase and Cloudflare provide the external backend services.

Typical URL:

```text
https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/
```

The repository should remain private, and the deployed URL should be shared only with authorized family users. GitHub Pages access control should be considered separately from the application's Firebase sign-in.

## 6. CDN-Hosted Libraries

The standalone page loads these libraries from `unpkg.com`:

| Library | URL | Purpose |
|---|---|---|
| React 18 | `https://unpkg.com/react@18/umd/react.development.js` | UI components and state |
| ReactDOM 18 | `https://unpkg.com/react-dom@18/umd/react-dom.development.js` | Mounts React into the page |
| Babel Standalone | `https://unpkg.com/@babel/standalone/babel.min.js` | Transforms JSX in the browser |

The page also loads Tailwind CSS from:

```text
https://cdn.tailwindcss.com
```

Tailwind is compiled in the browser. This is convenient for the no-build standalone file but is not recommended for a production application with stricter performance requirements.

## 7. Google Fonts

The page imports these fonts from Google Fonts:

```text
https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@1,600&family=Nunito:wght@400;600;700&display=swap
```

- `Nunito` is the primary application font.
- `Playfair Display` remains available for decorative display text.

If external font loading is blocked, the browser falls back to the declared generic font families.

## 8. Browser APIs Used

The application also relies on standard browser APIs:

- `fetch()` for Firebase, Firestore, Cloudflare Worker, and Anthropic requests.
- `localStorage` for the optional persistent sign-in session.
- `FileReader` for converting uploaded images and PDFs to base64.
- `URL.createObjectURL()` for temporary image previews.
- `<input type="file">` for selecting images and PDFs.
- `setInterval()` for token refresh and Firestore polling.

These are built into modern browsers and do not require additional packages.

## 9. Required Setup Checklist

Before deployment, verify:

- Firebase Authentication Email/Password provider is enabled.
- Authorized Firebase user accounts exist.
- Firestore database and security rules are configured.
- `FIREBASE_PROJECT_ID` is correct.
- `FIREBASE_API_KEY` belongs to the same Firebase project.
- Cloudflare Worker is deployed.
- `ANTHROPIC_API_KEY` is configured as a Worker secret.
- `PROXY_URL` points to the deployed Worker.
- GitHub Pages serves the `docs` folder.
- The GitHub repository and application URL are treated as private.
