require('dotenv').config();
const express = require('express');
const sequelize = require('./config/database');
const app = express();
const path = require('path');

// Initialize database and sync models
async function initDatabase() {
  try {
    await sequelize.sync({ alter: true });
    console.log('Database synced successfully');
  } catch (error) {
    console.error('Error syncing database:', error);
  }
}

initDatabase();

// Add EJS as the template engine
app.engine('html', require('ejs').renderFile);
app.set('view engine', 'html');

// Add Content Security Policy and cache control middleware
app.use((req, res, next) => {
    // Set Content Security Policy headers
    res.set({
        'Content-Security-Policy': "default-src 'self' https://apis.google.com https://accounts.google.com https://www.googleapis.com https://www.gstatic.com; " +
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://accounts.google.com https://www.gstatic.com; " +
            "style-src 'self' 'unsafe-inline' https://www.gstatic.com; " +
            "img-src 'self' data: https: blob:; " +
            "connect-src 'self' https://apis.google.com https://accounts.google.com https://www.googleapis.com https://www.gstatic.com; " +
            "frame-src https://accounts.google.com https://content.googleapis.com https://content-gmail.googleapis.com https://*.google.com;",
        // Cache control headers
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Surrogate-Control': 'no-store'
    });
    next();
});

// Add these middleware before your routes
app.use((req, res, next) => {
    // Set correct MIME type for JavaScript files
    if (req.url.endsWith('.js')) {
        res.type('application/javascript');
    }
    next();
});

// Make sure this comes after the MIME type middleware
app.use(express.static(path.join(__dirname, 'public')));

// Add middleware to parse JSON
app.use(express.json());

// Auth endpoint
app.post('/api/auth', (req, res) => {
    res.json({
        clientId: process.env.GOOGLE_CLIENT_ID,
        apiKey: process.env.GOOGLE_API_KEY
    });
});

// Serve landing page at root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'landing.html'));
});

// Serve app page at /app
app.get('/app', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 