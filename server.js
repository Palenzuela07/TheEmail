require('dotenv').config();
const express = require('express');
const sequelize = require('./config/database');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
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

// Security: Use Helmet for security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'", "https://apis.google.com", "https://accounts.google.com", "https://www.googleapis.com", "https://www.gstatic.com", "https://www.googletagmanager.com", "https://*.google-analytics.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://apis.google.com", "https://accounts.google.com", "https://www.gstatic.com", "https://www.googletagmanager.com", "https://*.googletagmanager.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://www.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:", "https://www.google.com", "https://www.google-analytics.com", "https://*.google-analytics.com"],
      connectSrc: ["'self'", "https://apis.google.com", "https://accounts.google.com", "https://www.googleapis.com", "https://www.gstatic.com", "https://api.openai.com", "https://www.google.com", "https://www.google-analytics.com", "https://*.google-analytics.com", "https://www.googletagmanager.com", "https://*.googletagmanager.com"],
      frameSrc: ["https://accounts.google.com", "https://content.googleapis.com", "https://content-gmail.googleapis.com", "https://*.google.com"],
    },
  },
  crossOriginEmbedderPolicy: false, // Required for Google OAuth
}));

// Cache control headers
app.use((req, res, next) => {
    res.set({
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

// Add middleware to parse JSON with size limit
app.use(express.json({ limit: '10mb' }));

// Rate limiting - General API rate limiter
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiter for AI endpoints
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Limit each IP to 30 AI requests per windowMs
  message: 'Too many AI requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply general rate limiting to all API routes
app.use('/api/', generalLimiter);

// Basic authentication middleware - checks for Google OAuth token
async function verifyAuth(req, res, next) {
  // For now, we'll check if user has a valid session/token
  // In production, verify Google OAuth token properly
  const authHeader = req.headers.authorization;
  const userEmail = req.headers['x-user-email'];
  
  // Basic check - in production, verify the Google token
  if (authHeader || userEmail || req.headers.cookie?.includes('isAuthenticated')) {
    return next();
  }
  
  // For development, allow requests but log warning
  // In production, uncomment the return below
  // return res.status(401).json({ error: 'Unauthorized' });
  
  console.warn('API request without authentication:', req.path);
  next();
}

// Auth endpoint - SECURED: No longer exposes OpenAI API key
app.post('/api/auth', (req, res) => {
    // Only return Google credentials needed for client-side OAuth
    // OpenAI key stays on server
    res.json({
        clientId: process.env.GOOGLE_CLIENT_ID,
        apiKey: process.env.GOOGLE_API_KEY
        // openaiKey removed - never expose this to client
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

// Input validation middleware
const validateChatInput = [
  body('message')
    .trim()
    .isLength({ min: 1, max: 10000 })
    .withMessage('Message must be between 1 and 10000 characters'),
  body('history')
    .optional()
    .isArray()
    .withMessage('History must be an array'),
  body('timestamp')
    .optional()
    .isISO8601()
    .withMessage('Timestamp must be a valid ISO 8601 date'),
];

// Enhance the AI chat endpoint with stronger memory enforcement
app.post('/api/chat', aiLimiter, verifyAuth, validateChatInput, async (req, res) => {
  try {
    // Check validation results
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { message, history, timestamp, tone, length, contextAwareness, signature } = req.body;
    
    // Additional sanitization
    const sanitizedMessage = message.trim().substring(0, 10000);
    
    if (!sanitizedMessage) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    if (!process.env.OPENAI_API_KEY) {
      console.error('OpenAI API key not found');
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }
    
    // Format the timestamp for more user-friendly display
    const currentTime = timestamp 
      ? new Date(timestamp).toLocaleString() 
      : new Date().toLocaleString();
    
    // Get current date and time in readable formats
    const now = timestamp ? new Date(timestamp) : new Date();
    const currentDate = now.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    const currentTimeFormatted = now.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    });
    const currentDateShort = now.toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    
    // Get tone preference (default to 'professional' if not provided)
    const emailTone = tone || 'professional';
    
    // Define tone-specific instructions
    let toneInstructions = '';
    switch(emailTone) {
      case 'formal':
        toneInstructions = `TONE: Write in a FORMAL tone. Use formal language, proper titles (Mr., Ms., Dr.), complete sentences, and traditional business closings like "Respectfully yours" or "Yours sincerely". Avoid contractions and casual expressions.`;
        break;
      case 'professional':
        toneInstructions = `TONE: Write in a PROFESSIONAL tone. Use clear, business-appropriate language. Balance formality with approachability. Use standard business closings like "Best regards" or "Sincerely". You may use contractions sparingly.`;
        break;
      case 'casual':
        toneInstructions = `TONE: Write in a CASUAL tone. Use friendly, conversational language. Contractions are fine. Use casual greetings like "Hi" or "Hey" and closings like "Thanks" or "Best". Keep it relaxed but still respectful.`;
        break;
      default:
        toneInstructions = `TONE: Write in a PROFESSIONAL tone. Use clear, business-appropriate language.`;
    }
    
    // Get response length preference (default to 'medium' if not provided)
    const emailLength = length || 'medium';
    
    // Define length-specific instructions
    let lengthInstructions = '';
    switch(emailLength) {
      case 'short':
        lengthInstructions = `LENGTH: Write a SHORT email. Keep it concise - 2-3 sentences maximum. Get straight to the point without unnecessary details.`;
        break;
      case 'medium':
        lengthInstructions = `LENGTH: Write a MEDIUM-length email. Include necessary details and context, typically 1-2 paragraphs.`;
        break;
      case 'long':
        lengthInstructions = `LENGTH: Write a LONG email. Provide comprehensive details, context, and explanations. Use multiple paragraphs as needed to fully address the topic.`;
        break;
      default:
        lengthInstructions = `LENGTH: Write a MEDIUM-length email. Include necessary details and context, typically 1-2 paragraphs.`;
    }
    
    // Get context awareness preference (default to 'on' if not provided)
    const useContextAwareness = contextAwareness !== 'off';
    
    // Define context awareness instructions
    let contextInstructions = '';
    if (useContextAwareness) {
      contextInstructions = `CONTEXT AWARENESS: Use the conversation history and email thread context to provide more relevant and contextual responses. Reference previous messages when appropriate to maintain continuity and understanding.`;
    } else {
      contextInstructions = `CONTEXT AWARENESS: Do not rely heavily on conversation history. Generate responses based primarily on the current message without extensive reference to previous context.`;
    }
    
    // Update system prompt to generate emails immediately without questions
    const systemPrompt = {
      role: 'system',
      content: `You are a helpful assistant that answers questions and generates emails instantly.

${toneInstructions}

${lengthInstructions}

${contextInstructions}

CURRENT DATE AND TIME INFORMATION:
- Current date: ${currentDate}
- Current time: ${currentTimeFormatted}
- Date (MM/DD/YYYY): ${currentDateShort}
- Day of week: ${now.toLocaleDateString('en-US', { weekday: 'long' })}
- Time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}

When users ask about the current date, time, day of the week, or any time-related questions, use the information above to provide accurate answers.

KEY INSTRUCTIONS FOR EMAILS:
1. For email requests - NEVER ask for more details, just create the email IMMEDIATELY
2. When user says "write email to [person] about [topic]" - generate complete email right away
3. All emails MUST follow this EXACT format:
   - Start with "Subject: [clear subject line]" on the first line
   - Add a blank line
   - Add a proper greeting like "Dear [name]," or "Hello,"
   - Write the email body with clear paragraphs
   - Add a blank line
   - End with a closing like "Best regards," or "Sincerely,"
   ${signature ? `   - Add the following signature after the closing:\n${signature}` : "   - Add a signature line with the user's name"}
4. Never invent information not provided by the user
5. Keep emails simple and focused on the requested topic
6. Always generate complete, ready-to-send emails in proper format
7. NEVER respond with "What would you like to say" or "What details should I include"

CRITICAL: If there is a THREAD CONTEXT in the conversation history:
- ALWAYS use the ACTUAL thread content, sender names, and subjects from the thread context
- When asked about "the original email" or "the first email", refer to the FIRST message in the thread context
- When generating replies, base them on the ACTUAL thread context, NOT on generic examples
- Do NOT use the example email below if thread context is available - use the actual thread content instead

For general questions, provide friendly, conversational responses.

Example email format (ONLY use if no thread context is available):
Subject: Meeting Request for Project Discussion

Dear Team,

I hope this email finds you well. I would like to schedule a meeting to discuss our current project status.

Please let me know your availability for this week.

Best regards,
[User's Name]`
    };
    
    console.log(`Processing chat. History items: ${history ? history.length : 0}, Time: ${currentTime}`);
    
    // Create fresh message array with our system prompt first
    let messages = [systemPrompt];
    
    // Add all history items, preserving system messages that contain thread context
    if (history && history.length > 0) {
      // Filter history: keep system messages that contain thread context, remove others
      const filteredHistory = history.filter(msg => {
        if (msg.role === 'system') {
          // Keep system messages that contain thread context (case-insensitive check)
          const content = msg.content ? msg.content.toLowerCase() : '';
          const hasThreadContext = content.includes('email thread') || 
                                   content.includes('thread context') ||
                                   content.includes('email_thread') ||
                                   content.includes('thread_context');
          
          if (hasThreadContext) {
            console.log('Preserving thread context system message:', msg.content.substring(0, 200) + '...');
          }
          
          return hasThreadContext;
        }
        // Keep all non-system messages
        return true;
      });
      
      console.log(`Filtered history: ${filteredHistory.length} messages (from ${history.length} total)`);
      const threadContextMsgs = filteredHistory.filter(m => m.role === 'system');
      console.log(`Thread context messages found: ${threadContextMsgs.length}`);
      
      // Add filtered history after system prompt
      messages = [
        systemPrompt,
        ...filteredHistory
      ];
    }
    
    // Add current message (sanitized)
    messages.push({ role: 'user', content: sanitizedMessage });
    
    // Use gpt-4 model for better memory if available, otherwise use gpt-3.5-turbo
    const model = 'gpt-3.5-turbo';
    
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: model,
          messages: messages,
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

// New endpoint for AI email generation (replaces client-side OpenAI calls)
const validateEmailGenInput = [
  body('prompt')
    .trim()
    .isLength({ min: 1, max: 2000 })
    .withMessage('Prompt must be between 1 and 2000 characters'),
];

app.post('/api/generate-email', aiLimiter, verifyAuth, validateEmailGenInput, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { prompt } = req.body;
    const sanitizedPrompt = prompt.trim().substring(0, 2000);
    
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }
    
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [{
            role: 'user',
            content: `Help me write an email: ${sanitizedPrompt}`
          }],
          temperature: 0.7,
          max_tokens: 1000
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
    console.error('Error in generate-email endpoint:', error);
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