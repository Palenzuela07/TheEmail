# The Email

An AI-powered Gmail client. Sign in with your Google account to read, search, organize and send email in a custom interface, with an AI assistant that drafts emails and replies, summarizes your inbox, and adapts to your preferred writing style.

## Features

**Email client (Gmail API)**
- Google OAuth sign-in
- Inbox with Gmail category tabs, plus Starred, Important and Sent views
- Threaded conversation view with inline images and attachment downloads
- Search with live suggestions
- Multi-select toolbar to star, mark important or delete emails in bulk
- Read/unread tracking, pagination, and background refresh every 30 seconds
- Compose and reply windows with rich text formatting (bold, italic, underline, links) and file attachments
- Resizable panels and a collapsible sidebar

**AI assistant (OpenAI)**
- A chat assistant that remembers the conversation and can write new emails or replies
- Drafted emails can be moved straight into the compose window after you confirm, with the subject line detected automatically
- AI-generated replies based on the full email thread
- A summary dashboard of the last 12 hours of email
- AI settings for tone, length, context awareness and a custom signature

**Security**
- All OpenAI requests go through the server, so the API key never reaches the browser
- Rate limiting: 100 requests per 15 minutes for general API routes, 30 for AI routes
- Input validation with `express-validator`
- Security headers and a Content Security Policy via Helmet

## Tech Stack

- **Frontend:** HTML, CSS, vanilla JavaScript, Google API JavaScript client (`gapi`)
- **Backend:** Node.js, Express
- **AI:** OpenAI Chat Completions API (`gpt-3.5-turbo`)
- **Database:** PostgreSQL with Sequelize
- **Security:** Helmet, express-rate-limit, express-validator

## Project Structure

```
├── server.js            # Express server, API routes, OpenAI integration
├── config/database.js   # PostgreSQL connection (Sequelize)
├── public/js/main.js    # Client-side app: Gmail integration, UI, AI chat
├── views/landing.html   # Landing page (served at /)
├── views/index.html     # Main email app (served at /app)
└── .env.example         # Required environment variables
```

## Getting Started

### Prerequisites
- Node.js
- PostgreSQL
- A Google Cloud project with the **Gmail API** enabled, an **OAuth 2.0 Client ID** (web application) and an **API key**
- An OpenAI API key

### Google Cloud setup
1. Enable the Gmail API in the [Google Cloud Console](https://console.cloud.google.com/).
2. Create an OAuth 2.0 Client ID of type "Web application" and add `http://localhost:3000` as an authorized JavaScript origin.
3. Create an API key and restrict it to the Gmail API.
4. On the OAuth consent screen, add these scopes: `gmail.readonly`, `gmail.modify`, `gmail.compose` and `gmail.send`.

### Installation

```bash
git clone https://github.com/Palenzuela07/TheEmail.git
cd TheEmail
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Description |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID |
| `GOOGLE_API_KEY` | Google API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `PORT` | Server port (default `3000`) |
| `DATABASE_URL` | PostgreSQL connection string |

Start the server:

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

## API Endpoints

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/auth` | Returns the Google OAuth credentials the client needs |
| `POST` | `/api/chat` | AI assistant chat with conversation history |
| `POST` | `/api/generate-email` | Generates an email from a prompt |

See [SECURITY.md](SECURITY.md) for details on the security setup.
