require('dotenv').config();
const express = require('express');
const sequelize = require('./config/database');
const app = express();
const path = require('path');
const fetch = require('node-fetch');

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
        'Content-Security-Policy': "default-src 'self' https://apis.google.com https://accounts.google.com https://www.googleapis.com https://www.gstatic.com https://api.openai.com; " +
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://accounts.google.com https://www.gstatic.com; " +
            "style-src 'self' 'unsafe-inline' https://www.gstatic.com; " +
            "img-src 'self' data: https: blob:; " +
            "connect-src 'self' https://apis.google.com https://accounts.google.com https://www.googleapis.com https://www.gstatic.com https://api.openai.com; " +
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
    // Safely log partial key for debugging
    const keyExists = !!process.env.OPENAI_API_KEY;
    const keyPreview = keyExists 
        ? `${process.env.OPENAI_API_KEY.substring(0, 7)}...${process.env.OPENAI_API_KEY.substring(process.env.OPENAI_API_KEY.length - 4)}`
        : 'NOT FOUND';
    
    console.log('OpenAI API Key Status:', keyExists, 'Preview:', keyPreview);
    
    res.json({
        clientId: process.env.GOOGLE_CLIENT_ID,
        apiKey: process.env.GOOGLE_API_KEY,
        openaiKey: process.env.OPENAI_API_KEY
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

// Enhanced AI endpoint that uses OpenAI
app.post('/api/chat', async (req, res) => {
  console.log('Chat endpoint hit!', req.body);
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    // Check if we have an OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      console.error('OpenAI API key not found');
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }
    
    // Call OpenAI API
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: 'You are a helpful email assistant. Provide concise and useful responses.' },
            { role: 'user', content: message }
          ],
          temperature: 0.7
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('OpenAI API error:', response.status, errorText);
        return res.status(500).json({ error: 'Error calling OpenAI API' });
      }
      
      const data = await response.json();
      return res.json({
        response: data.choices[0].message.content,
        status: 'success'
      });
      
    } catch (apiError) {
      console.error('Error calling OpenAI API:', apiError);
      return res.status(500).json({ error: 'Error processing your request' });
    }
    
  } catch (error) {
    console.error('Error in chat endpoint:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Add this simple test endpoint
app.get('/api/test', (req, res) => {
    res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 