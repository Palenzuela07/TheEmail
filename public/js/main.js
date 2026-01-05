// Add at the very top of the file
let selectedEmails = new Set();
let emailAttachments = []; // Store attachments for the current email

// Cached emails for Gmail-style search suggestions (always real data, no mocks)
let currentEmailMessages = []; // currently unused but kept for potential future use
let searchSuggestionIndex = -1;

// Global search index for suggestions (up to the last ~500 emails)
let searchIndexEmails = [];
let searchIndexLoaded = false;
let searchIndexLoading = false;

// Track blob URLs for inline attachments to clean up on email close
let currentEmailBlobUrls = [];

// Store current email thread context for AI chat
let currentEmailThreadContext = null;

// Function to reset compose window form fields
function resetComposeWindow() {
    const toField = document.getElementById('compose-to');
    const subjectField = document.getElementById('compose-subject');
    const bodyField = document.getElementById('compose-body');
    
    if (toField) toField.value = '';
    if (subjectField) subjectField.value = '';
    if (bodyField) {
        // Handle contenteditable div
        if (bodyField.getAttribute('contenteditable') === 'true') {
            bodyField.innerHTML = '';
        } else {
            bodyField.value = '';
        }
        
        if (bodyField.style) bodyField.style.height = 'auto';
    }
    
    // Also clear the hidden textarea if it exists
    const hiddenBody = document.getElementById('compose-body-hidden');
    if (hiddenBody) hiddenBody.value = '';
    
    // Clear attachments
    emailAttachments = [];
    updateAttachmentsList();
    
    // Clear any reply-to data
    if (window.replyToData) {
        DEBUG("Clearing replyToData", window.replyToData);
        window.replyToData = null;
    }
    
    console.log('Compose window has been reset');
}

// Function to handle file selection for attachments
function handleAttachmentSelect(event) {
    const files = Array.from(event.target.files);
    
    files.forEach(file => {
        // Check if file already exists
        if (!emailAttachments.find(att => att.name === file.name && att.size === file.size)) {
            emailAttachments.push(file);
        }
    });
    
    updateAttachmentsList();
    
    // Reset the input so the same file can be selected again if needed
    event.target.value = '';
}

// Make function globally accessible
window.handleAttachmentSelect = handleAttachmentSelect;

// Function to remove an attachment
function removeAttachment(index) {
    emailAttachments.splice(index, 1);
    updateAttachmentsList();
}

// Make function globally accessible
window.removeAttachment = removeAttachment;

// Function to update the attachments list display
function updateAttachmentsList() {
    const attachmentsList = document.getElementById('attachments-list');
    if (!attachmentsList) return;
    
    if (emailAttachments.length === 0) {
        attachmentsList.innerHTML = '';
        attachmentsList.style.display = 'none';
        return;
    }
    
    attachmentsList.style.display = 'block';
    attachmentsList.innerHTML = emailAttachments.map((file, index) => {
        const size = formatFileSize(file.size);
        return `
            <div class="attachment-item">
                <span class="attachment-name" title="${file.name}">📎 ${file.name}</span>
                <span class="attachment-size">${size}</span>
                <button class="attachment-remove" onclick="removeAttachment(${index})" title="Remove">×</button>
            </div>
        `;
    }).join('');
}

// Function to format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Function to read a file as base64
function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Consolidated function to move content to compose window
function moveToCompose(content, to = '', subject = '') {
    openComposeModal(null);
    
    // Populate the fields with the provided content, to, and subject
    populateComposeFields(content, to, subject);
}

// Helper function to actually populate the fields
function populateComposeFields(content, to = '', subject = '') {
    const toField = document.getElementById('compose-to');
    const subjectField = document.getElementById('compose-subject');
    const bodyField = document.getElementById('compose-body');
    
    if (toField && to) toField.value = to;
    if (subjectField && subject) subjectField.value = subject;
    
    if (bodyField && content) {
        if (bodyField.getAttribute('contenteditable') === 'true') {
            bodyField.innerHTML = content;
            // Also update the hidden textarea if it exists
            const hiddenBody = document.getElementById('compose-body-hidden');
            if (hiddenBody) hiddenBody.value = content;
        } else {
            bodyField.value = content;
        }
    }
    
    console.log("Fields populated. To:", to, "Subject:", subject, "Body length:", content?.length || 0);
}

// Update existing functions to use the new consolidated moveToCompose

// Alias for backward compatibility
function moveEmailToCompose(emailContent) {
    DEBUG("moveEmailToCompose called", {
        type: typeof emailContent,
        isString: typeof emailContent === 'string',
        contentPreview: typeof emailContent === 'string' ? 
            emailContent.substring(0, 50) + "..." : 
            JSON.stringify(emailContent).substring(0, 50) + "..."
    });
    
    try {
        // Handle different types of input (string or object)
        if (typeof emailContent === 'string') {
            // It's a string (raw email content) - parse it
            let subject = '';
            let body = emailContent;
            
            // Better subject detection patterns
            const subjectPatterns = [
                /Subject:(.+?)(?:\n|$)/i,
                /Subject line:(.+?)(?:\n|$)/i,
                /^(?:.*?)Subject:(.+?)(?:\n|$)/im,
                /^RE:(.+?)(?:\n|$)/i,
                /^Re:(.+?)(?:\n|$)/i,
                /^FWD:(.+?)(?:\n|$)/i,
                /^Fwd:(.+?)(?:\n|$)/i,
            ];
            
            // Try each pattern to extract subject
            for (const pattern of subjectPatterns) {
                const match = emailContent.match(pattern);
                if (match && match[1]) {
                    subject = match[1].trim();
                    DEBUG("Subject extracted:", subject);
                    // Remove the subject line from the body
                    body = body.replace(pattern, '').trim();
                    break;
                }
            }
            
            // If we still don't have a subject, look for the first line that might be a subject
            if (!subject && body.includes('\n')) {
                const firstLine = body.split('\n')[0].trim();
                // If the first line is short and doesn't look like a greeting, it might be a subject
                if (firstLine.length < 80 && 
                    !firstLine.match(/^(hi|hello|hey|dear|to whom)/i)) {
                    subject = firstLine;
                    DEBUG("First line as subject:", subject);
                    body = body.substring(firstLine.length).trim();
                }
            }
            
            // If still no subject, use a default
            if (!subject) {
                subject = "Generated Email";
                DEBUG("Using default subject");
            }
            
            // Clean up the body (remove extra lines at beginning)
            body = body.replace(/^\s*\n+/g, '');
            
            DEBUG("Moving to compose", { subject, bodyLength: body.length });
            moveToCompose(body, '', subject);
            return true;
        } else if (emailContent && typeof emailContent === 'object') {
            // It's an object with properties
            const subject = emailContent.subject || '';
            const to = emailContent.from || '';
            const body = emailContent.body || '';
            
            DEBUG("Moving object to compose", { subject, to, bodyLength: body?.length || 0 });
            // Pass all three parameters to moveToCompose
            moveToCompose(body, to, subject);
            return true;
        } else {
            // Invalid input
            DEBUG("ERROR: Invalid email content", emailContent);
            return false;
        }
    } catch (error) {
        DEBUG("ERROR in moveEmailToCompose", error);
        console.error("Error in moveEmailToCompose:", error);
        return false; // Return false instead of throwing
    }
}

// Alias for backward compatibility
function moveLastAIMessageToCompose(messages) {
    // Extract the last AI message
    const lastAIMessage = messages.filter(m => m.role === 'assistant').pop();
    
    if (lastAIMessage) {
        // Check if content contains email format with subject
        const content = lastAIMessage.content;
        let subject = '';
        let body = content;
        
        // Better subject detection patterns
        const subjectPatterns = [
            /Subject:(.+?)(?:\n|$)/i,
            /Subject line:(.+?)(?:\n|$)/i,
            /^(?:.*?)Subject:(.+?)(?:\n|$)/im,
            /^RE:(.+?)(?:\n|$)/i,
            /^Re:(.+?)(?:\n|$)/i,
        ];
        
        // Try each pattern to extract subject
        for (const pattern of subjectPatterns) {
            const match = content.match(pattern);
            if (match && match[1]) {
                subject = match[1].trim();
                // Remove the subject line from the body
                body = body.replace(pattern, '').trim();
                break;
            }
        }
        
        // If we still don't have a subject, look for the first line that might be a subject
        if (!subject && body.includes('\n')) {
            const firstLine = body.split('\n')[0].trim();
            // If the first line is short and doesn't look like a greeting, it might be a subject
            if (firstLine.length < 80 && 
                !firstLine.match(/^(hi|hello|hey|dear|to whom)/i)) {
                subject = firstLine;
                body = body.substring(firstLine.length).trim();
            }
        }
        
        // Clean up the body (remove extra lines at beginning)
        body = body.replace(/^\s*\n+/g, '');
        
        moveToCompose(body, '', subject);
        return true; // Return success
    }
    
    return false; // Return failure if no AI message found
}

document.addEventListener('DOMContentLoaded', () => {
    // Initialize greeting button if user is already authenticated
    if (localStorage.getItem('isAuthenticated') === 'true') {
        const userEmail = localStorage.getItem('userEmail');
        updateGreeting();
    }
    
    // Add styles for email formatting
    const style = document.createElement('style');
    style.textContent = `
        .formatted-email {
            background-color: #f8f9fa;
            border-left: 3px solid #1a73e8;
            padding: 10px;
            margin: 5px 0;
            border-radius: 4px;
        }
        .email-part {
            margin-bottom: 8px;
        }
        .email-subject {
            font-weight: 500;
            color: #202124;
        }
        .email-greeting {
            margin-top: 10px;
        }
        .email-body {
            margin: 12px 0;
            line-height: 1.5;
        }
        .email-closing {
            margin-top: 12px;
        }
        .selection-toolbar {
            display: none;
            position: fixed;
            background: white;
            padding: 8px;
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            z-index: 1000;
        }
        
        .toolbar-actions {
            display: flex;
            gap: 8px;
        }
        
        .toolbar-btn {
            padding: 8px;
            border: none;
            background: none;
            cursor: pointer;
            border-radius: 4px;
        }
        
        .toolbar-btn:hover {
            background: #f1f3f4;
        }
        .email-item.selected {
            background-color: #e8f0fe;
        }
        .email-checkbox {
            margin-right: 8px;
        }
    `;
    document.head.appendChild(style);
    
    // Only try to set up compose button if we're on the app page
    if (window.location.pathname === '/app') {
        const composeButton = document.getElementById('compose-btn-sidebar');
        if (composeButton) {
            composeButton.addEventListener('click', function(e) {
                e.preventDefault();
                openComposeModal(null);
            });
        }
    }

    // Delay toolbar creation to ensure DOM is fully loaded
    setTimeout(() => {
        createSelectionToolbar();
    }, 1000);

    // Add the document click event listener
    document.addEventListener('click', (event) => {
        // Check if click is inside email items, toolbar, or any interactive elements
        const isClickInsideEmail = event.target.closest('.email-item');
        const isClickInsideToolbar = event.target.closest('#selection-toolbar');
        const isClickOnCheckbox = event.target.classList.contains('email-checkbox');
        const isClickOnStar = event.target.closest('.email-star');
        const isClickOnImportant = event.target.closest('.email-important');
        
        // If clicking outside all interactive elements, clear all selections
        if (!isClickInsideEmail && !isClickInsideToolbar && !isClickOnCheckbox && 
            !isClickOnStar && !isClickOnImportant) {
            clearAllSelections();
        }
    });
});

function createSelectionToolbar() {
    const existingToolbar = document.getElementById('selection-toolbar');
    if (existingToolbar) {
        existingToolbar.remove(); // Remove any existing toolbar
    }

    const newToolbar = document.createElement('div');
    newToolbar.id = 'selection-toolbar';
    newToolbar.className = 'selection-toolbar';
    newToolbar.innerHTML = `
        <div class="toolbar-actions">
            <button id="star-selected-btn" class="toolbar-btn" title="Star">
                <span class="action-icon">⭐</span>
            </button>
            <button id="important-selected-btn" class="toolbar-btn" title="Mark as important">
                <span class="action-icon">❗</span>
            </button>
            <button id="delete-selected-btn" class="toolbar-btn delete-btn" title="Delete">
                <span class="action-icon">🗑️</span>
            </button>
        </div>
    `;
    document.body.appendChild(newToolbar);
    console.log('Toolbar created');
    
    // Add direct click handlers rather than using setupToolbarListeners
    document.getElementById('star-selected-btn').onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('Star button clicked directly');
        handleStarSelected(e);
    };
    
    document.getElementById('important-selected-btn').onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('Important button clicked directly');
        handleImportantSelected(e);
    };
    
    document.getElementById('delete-selected-btn').onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('Delete button clicked directly');
        handleDeleteSelected(e);
    };
}

// Discovery doc URL for APIs used by the quickstart
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest';
const SCOPES = 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose';

// OpenAI API key removed - now handled server-side only
// No sensitive keys should be stored in client-side code
// Initialize conversation history - load from localStorage if available
let conversationHistory = (() => {
    try {
        const saved = localStorage.getItem('chatHistory');
        if (saved) {
            const parsed = JSON.parse(saved);
            // Ensure we have at least the system message
            if (Array.isArray(parsed) && parsed.length > 0) {
                // Check if first message is system message, if not add it
                if (parsed[0].role !== 'system') {
                    parsed.unshift({
                        role: "system",
                        content: "You are a helpful email assistant. Help users compose professional emails and answer questions about their emails. If the user has an email thread open, you can reference the thread context to answer questions about the conversation. Remember previous parts of the conversation and maintain context. Be concise but thorough in your responses."
                    });
                }
                return parsed;
            }
        }
    } catch (e) {
        console.warn('Failed to load chat history from localStorage:', e);
    }
    // Default initialization
    return [{
        role: "system",
        content: "You are a helpful email assistant. Help users compose professional emails and answer questions about their emails. If the user has an email thread open, you can reference the thread context to answer questions about the conversation. Remember previous parts of the conversation and maintain context. Be concise but thorough in your responses."
    }];
})();

let tokenClient;
let gapiInited = false;
let gisInited = false;
let currentPage = 1;
const EMAILS_PER_PAGE = 50;
let totalEmails = 0;
let pageTokens = {};
let nextPageToken = null;
let currentEmail = null;
let currentFilter = 'primary'; // Default filter
let cachedDashboardData = null; // Cache for summary dashboard

// Define a maximum number of retry attempts
const MAX_RETRY_ATTEMPTS = 3;

document.addEventListener('DOMContentLoaded', initializeAPI);

// Remove hardcoded credentials
let CLIENT_ID;
let API_KEY;

// Add these variables at the top with other global variables
const selectionToolbar = document.getElementById('selection-toolbar');

// Fetch credentials when needed
async function initializeAPI() {
    try {
        const response = await fetch('/api/auth', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        const credentials = await response.json();
        
        CLIENT_ID = credentials.clientId;
        API_KEY = credentials.apiKey;
        
        // OpenAI API key is no longer exposed to client
        // All AI operations are handled server-side for security
        
        // Continue with Google API initialization
        gapi.load('client', async () => {
            try {
                await gapi.client.init({
                    apiKey: API_KEY,
                    discoveryDocs: [DISCOVERY_DOC],
                });
                gapiInited = true;
                console.log('GAPI initialized');

                // Initialize the token client but don't auto-login
                tokenClient = google.accounts.oauth2.initTokenClient({
                    client_id: CLIENT_ID,
                    scope: SCOPES,
                    callback: handleAuthResponse,
                    prompt: 'consent',
                    include_granted_scopes: true
                });
                gisInited = true;
                console.log('GIS initialized');
                
                // Remove the auto-login code to ensure user must click the button
                // The handleAuthClick function will be called when the user clicks the login button

                console.log('Google API initialized successfully');
            } catch (error) {
                console.error('Error initializing API:', error);
            }
        });
    } catch (error) {
        console.error('Error fetching credentials:', error);
    }
}

function handleAuthClick() {
    console.log('Auth click - gapiInited:', gapiInited, 'gisInited:', gisInited);
    if (!gapiInited || !gisInited) {
        console.log('API not initialized yet');
        return;
    }

    console.log('Requesting access token...');
    try {
        tokenClient.requestAccessToken({
            prompt: 'consent' // Force re-consent to ensure all scopes are granted
        });
        console.log('Token request sent successfully');
    } catch (err) {
        console.error('Error requesting token:', err);
    }
}

async function handleAuthResponse(response) {
    console.log('Auth response received:', response);
    if (response.error !== undefined) {
        console.error('Auth error:', response.error);
        return;
    }
    
    try {
        console.log('Getting user profile...');
        const profile = await gapi.client.gmail.users.getProfile({
            'userId': 'me'
        });
        
        userEmail = profile.result.emailAddress;
        console.log('User email:', userEmail);
        localStorage.setItem('isAuthenticated', 'true');
        localStorage.setItem('userEmail', userEmail);
        
        updateGreeting();
        document.getElementById('login-container').style.display = 'none';
        document.getElementById('app').style.display = 'block';
        
        // Show email tabs
        document.querySelector('.email-tabs').style.display = 'flex';
        
        // Switch to primary tab immediately after login
        console.log('Switching to primary tab...');
        await switchTab('primary');
        
        // After successful login, clear any previous email drafts and chat history
        localStorage.removeItem('chatHistory');
        // Reset conversation history to default
        conversationHistory = [{
            role: "system",
            content: "You are a helpful email assistant. Help users compose professional emails and answer questions about their emails. If the user has an email thread open, you can reference the thread context to answer questions about the conversation. Remember previous parts of the conversation and maintain context. Be concise but thorough in your responses."
        }];
        
        // Reset compose fields if they exist
        const composeToField = document.getElementById('compose-to');
        const composeSubjectField = document.getElementById('compose-subject');
        const composeBodyField = document.getElementById('compose-body');
        
        if (composeToField) composeToField.value = '';
        if (composeSubjectField) composeSubjectField.value = '';  
        if (composeBodyField) composeBodyField.value = '';
        
        // Reset conversation history to initial state
        conversationHistory = [{
            role: "system",
            content: "You are a helpful email assistant. Help users compose professional emails and answer questions about their emails. If the user has an email thread open, you can reference the thread context to answer questions about the conversation. Remember previous parts of the conversation and maintain context. Be concise but thorough in your responses."
        }];
        
        // Reset chat messages if the element exists
        const chatMessages = document.getElementById('chat-messages');
        if (chatMessages) {
            chatMessages.innerHTML = `
                <div class="chat-message ai">
                    How can I help you with your emails today?
                </div>
            `;
        }
        
        console.log('Refreshing emails after login...');
        refreshEmails();
        
        console.log('Login process completed successfully');
        
    } catch (error) {
        console.error('Error during login process:', error);
    }
}

function isOnline() {
    return window.navigator.onLine;
}

async function listEmails(page = 1, filter = 'primary', retryCount = 0) {
    try {
        if (!isOnline()) {
            throw new Error('You are offline. Please check your internet connection and try again.');
        }

        const pageToken = page > 1 ? sessionStorage.getItem(`pageToken_${filter}_${page - 1}`) : null;
        const query = getQueryForFilter(filter);
        const maxResults = 50;

        console.log(`Fetching emails for filter: ${filter}, page: ${page}, query: ${query}`);

        // Show immediate loading indicator
        document.getElementById('emailList').innerHTML = '<div style="text-align: center; padding: 20px;">Loading emails...</div>';

        const response = await gapi.client.gmail.users.messages.list({
            userId: 'me',
            q: query,
            maxResults: maxResults,
            pageToken: pageToken
        });

        // Log the response to debug
        console.log('Gmail API response:', response);

        // Ensure we have a valid resultSizeEstimate
        const resultSizeEstimate = response.result.resultSizeEstimate || 0;
        console.log(`Total emails found: ${resultSizeEstimate}`);

        if (response.result.messages && response.result.messages.length > 0) {
            // Store next page token if available
            if (response.result.nextPageToken) {
                sessionStorage.setItem(`pageToken_${filter}_${page}`, response.result.nextPageToken);
            }

            // Fetch metadata for each message instead of full details for better performance
            const messages = await Promise.all(
                response.result.messages.map(async (message) => {
                    const fullMessage = await gapi.client.gmail.users.messages.get({
                        userId: 'me',
                        id: message.id,
                        format: 'metadata',
                        metadataHeaders: ['From', 'Subject', 'Date']
                    });
                    return fullMessage.result;
                })
            );

            return {
                messages: messages,
                nextPageToken: response.result.nextPageToken,
                resultSizeEstimate: resultSizeEstimate
            };
        } else {
            console.log('No emails found for this filter');
            return {
                messages: [],
                nextPageToken: null,
                resultSizeEstimate: 0
            };
        }
    } catch (error) {
        console.error('Error listing emails:', error);
        
        // Handle rate limiting or network errors with retry
        if (retryCount < 3 && (error.status === 429 || error.status === 500 || error.status === 503 || error.message.includes('offline'))) {
            console.log(`Retrying listEmails (attempt ${retryCount + 1})...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
            return listEmails(page, filter, retryCount + 1);
        }
        
        throw error;
    }
}

// Build a search index of recent emails for Gmail-style suggestions (up to maxCount).
// This fetches up to `maxCount` of the most recent messages across your mailbox so
// the dropdown can search "any" recent email (not just the current tab).
async function buildSearchIndex(maxCount = 500) {
    try {
        if (searchIndexLoading) {
            return;
        }
        searchIndexLoading = true;
        searchIndexEmails = [];

        let pageToken = null;

        while (searchIndexEmails.length < maxCount) {
            const batchSize = Math.min(100, maxCount - searchIndexEmails.length);

            // Empty query -> most recent messages from your entire mailbox
            const listResponse = await gapi.client.gmail.users.messages.list({
                userId: 'me',
                maxResults: batchSize,
                q: '',
                pageToken: pageToken
            });

            const messages = listResponse.result.messages;
            if (!messages || messages.length === 0) {
                break;
            }

            const fullMessages = await Promise.all(
                messages.map(msg => gapi.client.gmail.users.messages.get({
                    userId: 'me',
                    id: msg.id,
                    format: 'metadata',
                    metadataHeaders: ['Subject', 'From', 'Date']
                }))
            );

            fullMessages.forEach(fm => {
                const result = fm.result;
                if (!result || !result.payload || !Array.isArray(result.payload.headers)) return;

                const headers = result.payload.headers;
                const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
                const from = headers.find(h => h.name === 'From')?.value || '(no sender)';
                const snippet = result.snippet || '';

                searchIndexEmails.push({
                    id: result.id,
                    from,
                    subject,
                    snippet
                });
            });

            pageToken = listResponse.result.nextPageToken;
            if (!pageToken) {
                break;
            }
        }

        searchIndexLoaded = true;
        console.log('Search index built. Emails indexed:', searchIndexEmails.length);
    } catch (error) {
        console.error('Error building search index for suggestions:', error);
    } finally {
        searchIndexLoading = false;
    }
}

// Schedule building the search index for suggestions only after
// the inbox has rendered and the browser has some idle time.
function scheduleSearchIndexBuild() {
    // Avoid duplicate builds
    if (searchIndexLoaded || searchIndexLoading) {
        return;
    }

    const startBuild = () => {
        if (searchIndexLoaded || searchIndexLoading) return;
        console.log('Starting background search index build after idle...');
        buildSearchIndex().catch(err => {
            console.error('Failed to build search index:', err);
        });
    };

    // Prefer requestIdleCallback so we don't compete with initial render
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        window.requestIdleCallback(startBuild, { timeout: 5000 });
    } else {
        // Fallback: wait a bit after login/refresh to reduce contention
        setTimeout(startBuild, 2000);
    }
}

function getQueryForFilter(filter) {
    switch (filter) {
        case 'starred':
            return 'is:starred';
        case 'important':
            return 'is:important';
        case 'sent':
            return 'in:sent';
        case 'last12hours':
            // Gmail API query for emails from last 12 hours
            return 'newer_than:12h';
        case 'primary':
            return 'category:primary';
        case 'promotions':
            return 'category:promotions';
        case 'social':
            return 'category:social';
        case 'updates':
            return 'category:updates';
        default:
            return '';
    }
}

function displayEmails(emails) {
    console.log('Displaying emails:', emails);
    const emailList = document.getElementById('emailList');
    
    // Clear existing emails
    emailList.innerHTML = '';
    
    if (!emails || !emails.messages || emails.messages.length === 0) {
        emailList.innerHTML = '<div style="text-align: center; padding: 20px;">No emails found</div>';
        return;
    }
    
    // Calculate email count and pagination info
    const emailCount = emails.resultSizeEstimate !== undefined ? emails.resultSizeEstimate : emails.messages.length;
    const startIndex = (currentPage - 1) * 50 + 1;
    const endIndex = Math.min(startIndex + emails.messages.length - 1, emailCount);
    const totalPages = Math.max(Math.ceil(emailCount / 50) || 1, currentPage);
    
    // Create email list header
    const emailListHeader = document.createElement('div');
    emailListHeader.className = 'email-list-header';
    
    // Create a center content div for any centered content
    const centerContent = document.createElement('div');
    centerContent.className = 'email-header-center';
    centerContent.textContent = ''; // Empty for cleaner look
    emailListHeader.appendChild(centerContent);
    
    // Create navigation controls for header - positioned absolutely on the left
    const headerNavControls = document.createElement('div');
    headerNavControls.className = 'header-nav-controls';
    
    // Previous button (left arrow)
    const prevButton = document.createElement('button');
    prevButton.className = 'nav-btn';
    prevButton.innerHTML = '&lt;';
    prevButton.title = 'Previous page';
    prevButton.onclick = function() { changePage(currentPage - 1); };
    prevButton.disabled = currentPage === 1;
    
    // Email count display
    const emailCountDiv = document.createElement('div');
    emailCountDiv.className = 'email-count';
    emailCountDiv.textContent = `${startIndex}-${endIndex} of ${emailCount}`;
    
    // Next button (right arrow)
    const nextButton = document.createElement('button');
    nextButton.className = 'nav-btn';
    nextButton.innerHTML = '&gt;';
    nextButton.title = 'Next page';
    nextButton.onclick = function() { changePage(currentPage + 1); };
    nextButton.disabled = currentPage === totalPages;
    
    // Assemble header navigation in the requested order: count first, then left arrow, then right arrow
    headerNavControls.appendChild(emailCountDiv);
    headerNavControls.appendChild(prevButton);
    headerNavControls.appendChild(nextButton);
    
    // Add navigation controls to the header (will be positioned by CSS)
    emailListHeader.appendChild(headerNavControls);
    
    emailList.appendChild(emailListHeader);
    
    // Create container for email items
    const emailItemsContainer = document.createElement('div');
    emailItemsContainer.className = 'email-items-container';
    
    // Add each email
    emails.messages.forEach(email => {
        try {
            const emailItem = document.createElement('div');
            emailItem.className = 'email-item';
            emailItem.id = `email-${email.id}`;
            emailItem.setAttribute('data-id', email.id);
            
            // Check if email is read
            const isRead = !email.labelIds || !email.labelIds.includes('UNREAD');
            if (isRead) {
                emailItem.classList.add('email-read');
            }
            
            // Check if email is starred
            const isStarred = email.labelIds && email.labelIds.includes('STARRED');
            
            // Get headers from the metadata
            let from = 'Unknown';
            let subject = 'No Subject';
            let date = '';
            
            if (email.payload && email.payload.headers) {
                const fromHeader = email.payload.headers.find(h => h.name === 'From');
                const subjectHeader = email.payload.headers.find(h => h.name === 'Subject');
                const dateHeader = email.payload.headers.find(h => h.name === 'Date');
                
                from = fromHeader ? fromHeader.value : 'Unknown';
                subject = subjectHeader ? subjectHeader.value : 'No Subject';
                date = dateHeader ? dateHeader.value : '';
            }
            
            emailItem.innerHTML = `
                <input type="checkbox" class="email-checkbox" onchange="handleEmailSelection('${email.id}', this)">
                <div class="email-star" onclick="event.stopPropagation(); toggleStar('${email.id}', ${isStarred})" style="cursor: pointer;">
                    ${isStarred ? '<span class="gold-star">⭐</span>' : '☆'}
                </div>
                <div class="email-important" onclick="event.stopPropagation(); toggleImportant('${email.id}', ${email.labelIds && email.labelIds.includes('IMPORTANT')})" style="cursor: pointer;">
                    ${email.labelIds && email.labelIds.includes('IMPORTANT') ? '❗' : '❕'}
                </div>
                <div class="email-content" onclick="openEmail('${email.id}')">
                    <p class="email-sender">${formatSender(from)}</p>
                    <p class="email-subject">${subject}</p>
                    <p class="email-snippet">${email.snippet || ''}</p>
                </div>
                <div class="email-date">${formatDate(date)}</div>
            `;
            
            emailItemsContainer.appendChild(emailItem);
        } catch (err) {
            console.error('Error rendering email:', err, email);
        }
    });
    
    emailList.appendChild(emailItemsContainer);
    
    // Also add full pagination controls at the bottom for convenience
    const paginationControls = generatePaginationControls(currentPage, totalPages);
    emailList.appendChild(paginationControls);
}

function formatSender(from) {
    const match = from.match(/^"?([^"]*)"?\s*(?:<.*>)?$/);
    return match ? match[1] : from;
}

function formatDate(dateStr) {
    try {
        // Handle invalid or missing date
        if (!dateStr) return '';
        
        // Parse the date string
        const date = new Date(dateStr);
        
        // Check if date is valid
        if (isNaN(date.getTime())) {
            console.warn('Invalid date:', dateStr);
            return '';
        }
        
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();
        
        if (isToday) {
            return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        }
        
        const isThisYear = date.getFullYear() === now.getFullYear();
        if (isThisYear) {
            return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
        
        return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (error) {
        console.error('Error formatting date:', error, dateStr);
        return '';
    }
}

function handleSignOut() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token);
        gapi.client.setToken('');
        window.location.reload();
    }
}

function generatePaginationControls(currentPage, totalPages) {
    // Create a DOM element for pagination
    const paginationDiv = document.createElement('div');
    paginationDiv.className = 'pagination';
    
    // Previous button
    const prevButton = document.createElement('button');
    prevButton.className = 'page-button';
    prevButton.textContent = 'Previous';
    prevButton.onclick = function() { changePage(currentPage - 1); };
    if (currentPage === 1) {
        prevButton.disabled = true;
    }
    paginationDiv.appendChild(prevButton);

    // First page
    if (currentPage > 3) {
        const firstPageButton = document.createElement('button');
        firstPageButton.className = 'page-button';
        firstPageButton.textContent = '1';
        firstPageButton.onclick = function() { changePage(1); };
        paginationDiv.appendChild(firstPageButton);
        
        if (currentPage > 4) {
            const ellipsis = document.createElement('span');
            ellipsis.className = 'page-info';
            ellipsis.textContent = '...';
            paginationDiv.appendChild(ellipsis);
        }
    }

    // Pages around current page
    for (let i = Math.max(1, currentPage - 2); i <= Math.min(totalPages, currentPage + 2); i++) {
        const pageButton = document.createElement('button');
        pageButton.className = i === currentPage ? 'page-button active' : 'page-button';
        pageButton.textContent = i.toString();
        pageButton.onclick = function() { changePage(i); };
        paginationDiv.appendChild(pageButton);
    }

    // Last page
    if (currentPage < totalPages - 2) {
        if (currentPage < totalPages - 3) {
            const ellipsis = document.createElement('span');
            ellipsis.className = 'page-info';
            ellipsis.textContent = '...';
            paginationDiv.appendChild(ellipsis);
        }
        
        const lastPageButton = document.createElement('button');
        lastPageButton.className = 'page-button';
        lastPageButton.textContent = totalPages.toString();
        lastPageButton.onclick = function() { changePage(totalPages); };
        paginationDiv.appendChild(lastPageButton);
    }

    // Next button
    const nextButton = document.createElement('button');
    nextButton.className = 'page-button';
    nextButton.textContent = 'Next';
    nextButton.onclick = function() { changePage(currentPage + 1); };
    if (currentPage === totalPages) {
        nextButton.disabled = true;
    }
    paginationDiv.appendChild(nextButton);

    return paginationDiv;
}

async function changePage(newPage) {
    if (newPage < 1) return;

    try {
        console.log(`Changing to page ${newPage} for filter ${currentFilter}`);
        
        // Show loading state
        document.getElementById('emailList').innerHTML = '<div style="text-align: center; padding: 20px;">Loading...</div>';
        
        // Attempt to fetch emails for the new page
        const emails = await listEmails(newPage, currentFilter);
        
        // Check if we have valid emails object with messages
        if (emails && emails.messages && emails.messages.length > 0) {
            // Update current page
            currentPage = newPage;
            
            // Display the emails
            displayEmails(emails);
            
            // Scroll to top
            document.getElementById('emailList').scrollTop = 0;
            
            console.log(`Successfully changed to page ${newPage}`);
        } else {
            console.error('No emails returned for page:', newPage);
            
            // If we're trying to go to a page that doesn't exist, stay on current page
            const fallbackEmails = await listEmails(currentPage, currentFilter);
            displayEmails(fallbackEmails);
            
            // Show a message to the user
            alert('No more emails to display.');
        }
    } catch (error) {
        console.error('Error changing page:', error);
        
        // Try to recover by staying on current page
        try {
            const fallbackEmails = await listEmails(currentPage, currentFilter);
            displayEmails(fallbackEmails);
        } catch (fallbackError) {
            document.getElementById('emailList').innerHTML = 
                '<div style="text-align: center; padding: 20px;">Error loading emails. Please try again.</div>';
        }
        
        alert('Error loading emails. Please try again.');
    }
}

async function openEmail(emailId) {
    try {
        // Clean up any previous blob URLs before opening a new email
        currentEmailBlobUrls.forEach(url => {
            try {
                URL.revokeObjectURL(url);
            } catch (e) {
                console.warn('Error revoking blob URL:', e);
            }
        });
        currentEmailBlobUrls = [];
        
        currentEmail = emailId;
        
        // Get references to DOM elements
        const emailViewer = document.getElementById('email-viewer');
        const emailContent = document.getElementById('email-viewer-content');
        const emailTabs = document.getElementById('email-tabs');
        const emailList = document.getElementById('emailList');

        if (!emailViewer || !emailContent) {
            throw new Error('Required email viewer elements not found');
        }

        // Update the email viewer header first
        const emailViewerHeader = document.querySelector('.email-viewer-header');
        if (emailViewerHeader) {
            emailViewerHeader.innerHTML = `
                <button class="back-button" onclick="closeEmail()" style="margin-right: auto;">← Back</button>
                <div class="email-actions">
                    <button onclick="deleteEmail(currentEmail)">Delete</button>
                    <button onclick="replyEmail(currentEmail)">Reply</button>
                </div>
            `;
        }

        // Ensure container is in flex mode for split view (fixes issue when opening from summary dashboard)
        const emailListContainer = document.querySelector('.email-list-container');
        if (emailListContainer) {
            emailListContainer.style.display = 'flex';
            emailListContainer.classList.add('viewer-open');
        }
        
        // Remove summary-dashboard class and reset width if present
        if (emailList && emailList.classList.contains('summary-dashboard')) {
            emailList.classList.remove('summary-dashboard');
            emailList.style.maxWidth = '';
        }
        
        // Show loading state
        emailContent.innerHTML = '<div style="text-align: center; padding: 20px;">Loading email...</div>';
        emailViewer.style.display = 'flex';
        emailViewer.classList.add('show');
        
        // Show resize divider
        const resizeDivider = document.getElementById('resize-divider');
        if (resizeDivider && emailList) {
            resizeDivider.style.display = 'block';
            // Restore saved width or use default (40% of container)
            const savedWidth = localStorage.getItem('emailListWidth');
            if (savedWidth) {
                emailList.style.width = savedWidth + 'px';
            } else {
                // Set initial width to 40% of container
                if (emailListContainer) {
                    const initialWidth = emailListContainer.offsetWidth * 0.4;
                    emailList.style.width = initialWidth + 'px';
                }
            }
        }
        
        // Remove selected class from all email items
        document.querySelectorAll('.email-item').forEach(item => {
            item.classList.remove('selected');
        });
        
        // Add selected class to the clicked email item
        const clickedEmailItem = document.getElementById(`email-${emailId}`);
        if (clickedEmailItem) {
            clickedEmailItem.classList.add('selected');
            // Scroll the selected item into view
            clickedEmailItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        
        // Keep email list and tabs visible - they'll be side by side
        // Keep email list and tabs visible - they'll be side by side

        // Mark the email as read when opened
        await markAsRead(emailId);
        
        // Get full email content
        const response = await gapi.client.gmail.users.messages.get({
            'userId': 'me',
            'id': emailId,
            'format': 'full'
        });

        const email = response.result;
        const threadId = email.threadId;

        console.log('Fetching thread:', threadId);
        
        // Fetch all messages in the thread
        const threadResponse = await gapi.client.gmail.users.threads.get({
            'userId': 'me',
            'id': threadId,
            'format': 'full'
        });

        const thread = threadResponse.result;
        const messages = thread.messages || [];

        console.log('Thread messages:', messages.length);

        // Store thread context for AI chat (chronologically, oldest first)
        const threadMessagesForContext = [...messages].sort((a, b) => {
            const dateA = new Date(a.payload.headers.find(h => h.name === 'Date')?.value || 0);
            const dateB = new Date(b.payload.headers.find(h => h.name === 'Date')?.value || 0);
            return dateA - dateB; // Oldest first for context
        });
        
        // Build thread context string for AI (limit length to avoid token issues)
        const threadContextParts = [];
        threadMessagesForContext.forEach((msg, index) => {
            const msgHeaders = msg.payload.headers;
            const from = msgHeaders.find(h => h.name === 'From')?.value || 'Unknown';
            const date = msgHeaders.find(h => h.name === 'Date')?.value || '';
            const msgSubject = msgHeaders.find(h => h.name === 'Subject')?.value || '';
            const msgBody = getBody(msg.payload);
            const plainText = htmlToPlainText(msgBody);
            
            // Extract sender name (remove email address)
            const senderMatch = from.match(/^"?([^"<]+)"?\s*(?:<.*>)?$/);
            const senderName = senderMatch ? senderMatch[1].trim() : from;
            
            // Limit each message to 800 characters to keep context manageable
            const truncatedText = plainText.trim().substring(0, 800);
            const textPreview = truncatedText.length < plainText.trim().length ? truncatedText + '...' : truncatedText;
            
            threadContextParts.push(`--- Message ${index + 1} ---\nFrom: ${senderName}\nDate: ${date}\nSubject: ${msgSubject}\n\n${textPreview}`);
        });
        
        // Limit total context to ~4000 characters
        let fullContext = threadContextParts.join('\n\n---\n\n');
        if (fullContext.length > 4000) {
            fullContext = fullContext.substring(0, 4000) + '\n\n... (thread continues)';
        }
        
        currentEmailThreadContext = {
            threadId: threadId,
            subject: messages[0]?.payload?.headers?.find(h => h.name === 'Subject')?.value || '',
            context: `EMAIL THREAD CONTEXT:\n\n${fullContext}\n\n--- END OF THREAD ---`,
            messageCount: messages.length
        };
        
        console.log('Thread context stored for AI chat', { 
            threadId: threadId, 
            messageCount: messages.length 
        });
        
        // Update conversation history with thread context if context awareness is enabled
        const aiContextAwareness = localStorage.getItem('aiContextAwareness') || 'on';
        if (aiContextAwareness === 'on') {
            // Remove any existing thread context system messages
            conversationHistory = conversationHistory.filter(msg => 
                !(msg.role === 'system' && 
                  msg.content && 
                  (msg.content.includes('email thread') || 
                   msg.content.includes('thread context') ||
                   msg.content.includes('EMAIL THREAD') ||
                   msg.content.includes('THREAD CONTEXT')))
            );
            
            // Add current thread context as a system message after the main system message
            const contextSystemMessage = {
                role: "system",
                content: `=== EMAIL THREAD CONTEXT - READ THIS FIRST ===

You are viewing an email thread. When the user asks questions about emails, ALWAYS refer to the thread context below, NOT to example emails.

THREAD CONTEXT:
${currentEmailThreadContext.context}

CRITICAL RULES:
1. When asked "what was the original email?" or "give me the first email" → Return the FIRST message from the thread context above
2. When asked "what email did you reply to?" → Return the message that was replied to from the thread context
3. When asked about email content → Use ONLY the actual content from the thread context above
4. NEVER use the example email "Meeting Request for Project Discussion" - that is just an example format
5. ALWAYS use the actual sender names, subjects, dates, and content from the thread context
6. If the user asks for "exact text" → Copy the EXACT text from the thread context, word for word

The thread context above contains the REAL emails. Use it.`
            };
            
            // Insert context after the main system message but before user messages
            if (conversationHistory.length > 0 && conversationHistory[0].role === 'system') {
                conversationHistory.splice(1, 0, contextSystemMessage);
            } else {
                conversationHistory.unshift(contextSystemMessage);
            }
            
            // Save updated history
            localStorage.setItem('chatHistory', JSON.stringify(conversationHistory));
            
            console.log('Thread context added to conversation history', {
                threadId: threadId,
                historyLength: conversationHistory.length
            });
        }

        // Sort messages by date (newest first - most recent at top) for display
        messages.sort((a, b) => {
            const dateA = new Date(a.payload.headers.find(h => h.name === 'Date')?.value || 0);
            const dateB = new Date(b.payload.headers.find(h => h.name === 'Date')?.value || 0);
            return dateB - dateA; // Reverse order: newest first
        });

        // Create HTML for the thread
        let threadHtml = '';
        const hasThreadHistory = messages.length > 1;
        
        // Store message content for iframe injection
        const messageContents = new Map();
        
        // Helper function to create message HTML
        async function createMessageHtml(msg) {
            const headers = msg.payload.headers;
        const from = headers.find(header => header.name === 'From')?.value || '';
        const date = headers.find(header => header.name === 'Date')?.value || '';
            let content = getBody(msg.payload);
            
            // Debug: Log content type and preview
            console.log('Email content type:', typeof content);
            console.log('Email content length:', content ? content.length : 0);
            console.log('Email content preview:', content ? content.substring(0, 200) : 'No content');
            console.log('Email content contains HTML:', content ? content.includes('<') : false);
            
            // Extract attachments for this message
            const attachments = getAttachments(msg.payload, msg.id);
            
            // Extract inline attachments (CID attachments) and process images
            const inlineAttachments = await getInlineAttachments(msg.payload, msg.id);
            console.log('Found inline attachments:', inlineAttachments.size);
            if (inlineAttachments.size > 0) {
                console.log('Available CIDs:', Array.from(inlineAttachments.keys()));
            }
            
            // Process HTML content to replace CID references with blob URLs
            if (content && typeof content === 'string' && content.includes('<')) {
                // Log all img tags with CID references before processing
                const tempCheck = document.createElement('div');
                tempCheck.innerHTML = content;
                const cidImages = tempCheck.querySelectorAll('img[src^="cid:"], img[src*="cid:"]');
                if (cidImages.length > 0) {
                    console.log(`Found ${cidImages.length} images with CID references:`);
                    cidImages.forEach((img, idx) => {
                        console.log(`  Image ${idx + 1}:`, img.getAttribute('src'));
                    });
                }
                
                content = processEmailImages(content, inlineAttachments);
            }

            // Extract sender name from email
            const senderMatch = from.match(/^"?([^"<]+)"?\s*(?:<.*>)?$/);
            const senderName = senderMatch ? senderMatch[1].trim() : from;
            
            // Create attachments HTML
            let attachmentsHtml = '';
            if (attachments.length > 0) {
                attachmentsHtml = '<div class="message-attachments">';
                attachments.forEach(att => {
                    const size = formatFileSize(att.size);
                    const safeFilename = att.filename.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                    const safeMimeType = (att.mimeType || 'application/octet-stream').replace(/'/g, "\\'").replace(/"/g, '&quot;');
                    attachmentsHtml += `
                        <div class="attachment-item-view" onclick="downloadAttachment('${msg.id}', '${att.attachmentId}', '${safeFilename}', '${safeMimeType}')">
                            <span class="attachment-icon">📎</span>
                            <span class="attachment-name-view">${att.filename}</span>
                            <span class="attachment-size-view">${size}</span>
                        </div>
                    `;
                });
                attachmentsHtml += '</div>';
            }

            // Escape sender name and date for safety, but keep content as HTML
            const safeSenderName = senderName.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const safeDate = formatDate(new Date(date)).replace(/</g, '&lt;').replace(/>/g, '&gt;');
            
            // Ensure content is a string and not undefined/null
            const safeContent = content || 'No content available';
            
            // Create a unique ID for this message's iframe
            const messageIframeId = `email-iframe-${msg.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            
            // Store content for later injection into iframe
            messageContents.set(messageIframeId, safeContent);
            
            // Create the HTML structure with sandboxed iframe for email content
            return `
                <div class="email-message">
                    <div class="message-header">
                        <div style="flex: 1;">
                            <div class="message-sender">${safeSenderName}</div>
                        </div>
                        <div class="message-date">${safeDate}</div>
                    </div>
                    ${attachmentsHtml}
                    <div class="message-content-wrapper">
                        <iframe 
                            id="${messageIframeId}"
                            class="email-content-iframe"
                            sandbox="allow-same-origin allow-scripts allow-popups-to-escape-sandbox"
                            scrolling="no"
                            frameborder="0"
                            loading="lazy">
                        </iframe>
                    </div>
                </div>
            `;
        }
        
        // Show the most recent email first (index 0 after sorting)
        if (messages.length > 0) {
            threadHtml += await createMessageHtml(messages[0]);
        }
        
        // If there are more messages, show thread history
        if (hasThreadHistory) {
            threadHtml += `
                <div class="thread-history-break">
                    <div class="thread-history-line"></div>
                    <div class="thread-history-title">Thread History</div>
                    <div class="thread-history-line"></div>
                </div>
            `;
            
            // Show the rest of the messages (older ones)
            for (let i = 1; i < messages.length; i++) {
                threadHtml += await createMessageHtml(messages[i]);
            }
        }

        // Email styles - Gmail-like appearance
        const threadStyles = `
        <style>
            .thread-container {
                padding: 0;
                background: white;
                color: #202124 !important; /* Force explicit color */
                
                /* Contain thread content to prevent background leakage */
                contain: layout style paint;
                position: relative;
                isolation: isolate;
                overflow: hidden !important;
                clip-path: inset(0);
                color-scheme: light !important;
            }

            .email-message {
                margin-bottom: 0;
                padding: 16px 24px;
                border-bottom: 1px solid #eceff1;
                background: white;
                color: #202124 !important; /* Force explicit color */
                
                /* Contain each message to prevent background leakage */
                contain: layout style paint;
                position: relative;
                isolation: isolate;
                overflow: hidden;
                color-scheme: light !important;
            }

            .email-message:last-child {
                border-bottom: none;
            }

            .message-header {
                margin-bottom: 12px;
                padding-bottom: 12px;
                border-bottom: 1px solid #eceff1;
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                gap: 16px;
            }

            .message-sender {
                font-family: 'Google Sans', Arial, sans-serif;
                font-size: 14px;
                font-weight: 500;
                color: #202124;
                margin: 0 0 4px 0;
                line-height: 1.5;
            }

            .message-date {
                color: #5f6368;
                font-size: 13px;
                white-space: nowrap;
                flex-shrink: 0;
                font-family: Arial, sans-serif;
            }

            .message-content-wrapper {
                margin-top: 12px;
                width: 100%;
                position: relative;
                background: white;
            }
            
            .email-content-iframe {
                width: 100%;
                border: none;
                display: block;
                background: white;
                min-height: 50px;
            }
            
            .message-content {
                font-family: Arial, Helvetica, sans-serif;
                font-size: 14px;
                line-height: 1.5;
                color: #202124 !important; /* Force explicit color */
                max-width: 100%;
                overflow-x: auto;
                overflow-y: visible;
                word-wrap: break-word;
                padding: 0;
                margin-top: 12px;
                /* Don't set text-align here - let email HTML control it */
                
                /* Hard containment: Prevent background images/colors from bleeding */
                position: relative;
                isolation: isolate;
                contain: layout style paint;
                clip-path: inset(0);
                background: white !important;
                
                /* Force light color scheme */
                color-scheme: light !important;
            }
            
            /* Force explicit colors on all email content to prevent inheritance */
            .message-content * {
                color: inherit;
            }
            
            /* Override any dark colors in email content - default to dark text */
            .message-content p,
            .message-content div,
            .message-content span,
            .message-content td,
            .message-content th {
                color: #202124 !important;
            }
            
            /* Force white/light text on dark backgrounds */
            .message-content div[style*="background-color: black"],
            .message-content div[style*="background-color:#000"],
            .message-content div[style*="background-color: #000"],
            .message-content div[style*="background: black"],
            .message-content div[style*="background:#000"],
            .message-content div[style*="background: #000"],
            .message-content div[style*="background-color: rgb(0, 0, 0)"],
            .message-content div[style*="background-color:rgb(0,0,0)"],
            .message-content div[style*="background-color: rgba(0, 0, 0"],
            .message-content div[style*="background-color:rgba(0,0,0"],
            .message-content table[style*="background-color: black"],
            .message-content table[style*="background-color:#000"],
            .message-content table[style*="background-color: #000"],
            .message-content table[style*="background: black"],
            .message-content table[style*="background:#000"],
            .message-content table[style*="background: #000"],
            .message-content td[style*="background-color: black"],
            .message-content td[style*="background-color:#000"],
            .message-content td[style*="background-color: #000"],
            .message-content td[style*="background: black"],
            .message-content td[style*="background:#000"],
            .message-content td[style*="background: #000"],
            .message-content tr[style*="background-color: black"],
            .message-content tr[style*="background-color:#000"],
            .message-content tr[style*="background-color: #000"],
            .message-content tr[style*="background: black"],
            .message-content tr[style*="background:#000"],
            .message-content tr[style*="background: #000"],
            .message-content [style*="background-color: black"],
            .message-content [style*="background-color:#000"],
            .message-content [style*="background-color: #000"],
            .message-content [style*="background: black"],
            .message-content [style*="background:#000"],
            .message-content [style*="background: #000"] {
                color: #ffffff !important;
            }
            
            /* Force white text on all children of dark background elements */
            .message-content div[style*="background-color: black"] *,
            .message-content div[style*="background-color:#000"] *,
            .message-content div[style*="background-color: #000"] *,
            .message-content div[style*="background: black"] *,
            .message-content div[style*="background:#000"] *,
            .message-content div[style*="background: #000"] *,
            .message-content table[style*="background-color: black"] *,
            .message-content table[style*="background-color:#000"] *,
            .message-content table[style*="background-color: #000"] *,
            .message-content table[style*="background: black"] *,
            .message-content table[style*="background:#000"] *,
            .message-content table[style*="background: #000"] *,
            .message-content td[style*="background-color: black"] *,
            .message-content td[style*="background-color:#000"] *,
            .message-content td[style*="background-color: #000"] *,
            .message-content td[style*="background: black"] *,
            .message-content td[style*="background:#000"] *,
            .message-content td[style*="background: #000"] *,
            .message-content tr[style*="background-color: black"] *,
            .message-content tr[style*="background-color:#000"] *,
            .message-content tr[style*="background-color: #000"] *,
            .message-content tr[style*="background: black"] *,
            .message-content tr[style*="background:#000"] *,
            .message-content tr[style*="background: #000"] * {
                color: #ffffff !important;
            }
            
            /* Also handle very dark backgrounds (dark gray, etc.) - detect by checking for rgb values with low brightness */
            .message-content [style*="background-color: rgb(0"],
            .message-content [style*="background-color:rgb(0"],
            .message-content [style*="background-color: rgba(0"],
            .message-content [style*="background-color:rgba(0"],
            .message-content [style*="background-color: #111"],
            .message-content [style*="background-color:#111"],
            .message-content [style*="background-color: #222"],
            .message-content [style*="background-color:#222"],
            .message-content [style*="background-color: #333"],
            .message-content [style*="background-color:#333"] {
                color: #ffffff !important;
            }
            
            /* Force white text on children of very dark backgrounds */
            .message-content [style*="background-color: rgb(0"] *,
            .message-content [style*="background-color:rgb(0"] *,
            .message-content [style*="background-color: rgba(0"] *,
            .message-content [style*="background-color:rgba(0"] *,
            .message-content [style*="background-color: #111"] *,
            .message-content [style*="background-color:#111"] *,
            .message-content [style*="background-color: #222"] *,
            .message-content [style*="background-color:#222"] *,
            .message-content [style*="background-color: #333"] *,
            .message-content [style*="background-color:#333"] * {
                color: #ffffff !important;
            }
            
            /* Allow links on dark backgrounds to be light blue for visibility */
            .message-content div[style*="background-color: black"] a,
            .message-content div[style*="background-color:#000"] a,
            .message-content div[style*="background-color: #000"] a,
            .message-content div[style*="background: black"] a,
            .message-content div[style*="background:#000"] a,
            .message-content div[style*="background: #000"] a,
            .message-content table[style*="background-color: black"] a,
            .message-content table[style*="background-color:#000"] a,
            .message-content table[style*="background-color: #000"] a,
            .message-content table[style*="background: black"] a,
            .message-content table[style*="background:#000"] a,
            .message-content table[style*="background: #000"] a {
                color: #8ab4f8 !important; /* Light blue for links on dark backgrounds */
            }
            
            /* Allow links to keep their color on light backgrounds */
            .message-content a {
                color: #1a73e8 !important;
            }
            
            /* Clip all background images to the message content area */
            .message-content * {
                background-clip: padding-box !important;
                background-origin: padding-box !important;
                background-attachment: scroll !important;
            }
            
            /* Override background-attachment: fixed which can escape containers */
            .message-content *[style*="background-attachment"],
            .message-content *[style*="background-attachment: fixed"],
            .message-content *[style*="background-attachment:fixed"] {
                background-attachment: scroll !important;
            }
            
            /* Ensure background images don't extend beyond content */
            .message-content img,
            .message-content [style*="background-image"],
            .message-content [style*="background:"] {
                max-width: 100%;
                display: block;
            }
            
            /* Force clip-path on all elements to prevent background bleeding */
            .message-content > * {
                clip-path: inset(0);
                overflow: hidden;
            }
            
            /* Ensure fixed/absolute positioned elements don't escape */
            .message-content [style*="position: fixed"],
            .message-content [style*="position:absolute"],
            .message-content [style*="position: absolute"] {
                position: relative !important;
            }
            
            /* Prevent any element from extending beyond message-content */
            .message-content * {
                max-width: 100%;
                box-sizing: border-box;
            }
            
            /* Ensure email content preserves original styling but is readable */
            .message-content div,
            .message-content span,
            .message-content p {
                color: inherit;
            }
            
            /* Preserve background colors from emails but ensure text is readable */
            .message-content div[style*="background"],
            .message-content table[style*="background"],
            .message-content td[style*="background"] {
                /* Keep original backgrounds but ensure contrast */
            }
            
            .message-content p {
                margin: 0 0 10px 0;
                padding: 0;
            }
            
            .message-content p:last-child {
                margin-bottom: 0;
            }
            
            .message-content p:first-child {
                margin-top: 0;
            }
            
            .message-content blockquote {
                border-left: 3px solid #dadce0;
                padding-left: 12px;
                margin: 10px 0;
                color: #5f6368;
                font-style: italic;
            }
            
            .message-content pre {
                background: #f8f9fa;
                border: 1px solid #dadce0;
                border-radius: 4px;
                padding: 12px;
                overflow-x: auto;
                font-family: 'Courier New', monospace;
                font-size: 13px;
                line-height: 1.5;
                margin: 10px 0;
            }
            
            .message-content code {
                background: #f8f9fa;
                padding: 2px 6px;
                border-radius: 3px;
                font-family: 'Courier New', monospace;
                font-size: 13px;
            }
            
            .message-content pre code {
                background: transparent;
                padding: 0;
            }

            /* Image styling */
            .message-content img {
                max-width: 100%;
                height: auto;
                display: block;
                margin: 10px 0;
            }
            
            /* Link styling */
            .message-content a {
                color: #1a73e8;
                text-decoration: none;
            }
            
            .message-content a:hover {
                text-decoration: underline;
            }
            
            /* List styling */
            .message-content ul,
            .message-content ol {
                margin: 10px 0;
                padding-left: 24px;
            }
            
            .message-content li {
                margin: 4px 0;
                line-height: 1.5;
            }
            
            /* Table styling - Remove all borders and outlines for marketing emails */
            .message-content table {
                max-width: 100%;
                overflow-x: auto;
                border-collapse: collapse !important;
                margin: 10px 0;
                border: none !important;
                outline: none !important;
                box-shadow: none !important;
            }
            
            .message-content table tr {
                border: none !important;
                outline: none !important;
                box-shadow: none !important;
            }
            
            .message-content table td,
            .message-content table th {
                padding: 8px 12px;
                border: none !important;
                outline: none !important;
                box-shadow: none !important;
            }
            
            .message-content table th {
                background: #f8f9fa;
                font-weight: 600;
            }
            
            /* Remove borders, outlines, and debug styles from all elements in email content */
            .message-content div,
            .message-content span,
            .message-content p,
            .message-content table,
            .message-content tr,
            .message-content td,
            .message-content th {
                border: none !important;
                outline: none !important;
                box-shadow: none !important;
            }
            
            /* Prevent any global debug styles from affecting email content */
            .message-content * {
                outline: none !important;
            }
            
            /* Ensure table collapse is set */
            .message-content table {
                border-collapse: collapse !important;
                border-spacing: 0 !important;
            }
            
            /* Heading styling */
            .message-content h1,
            .message-content h2,
            .message-content h3,
            .message-content h4,
            .message-content h5,
            .message-content h6 {
                margin: 14px 0 6px 0;
                font-weight: 600;
                line-height: 1.4;
                color: #202124;
            }
            
            .message-content h1:first-child,
            .message-content h2:first-child,
            .message-content h3:first-child,
            .message-content h4:first-child,
            .message-content h5:first-child,
            .message-content h6:first-child {
                margin-top: 0;
            }
            
            .message-content h1 { font-size: 24px; }
            .message-content h2 { font-size: 20px; }
            .message-content h3 { font-size: 18px; }
            .message-content h4 { font-size: 16px; }
            .message-content h5 { font-size: 14px; }
            .message-content h6 { font-size: 12px; }
            
            /* Horizontal rule */
            .message-content hr {
                border: none;
                border-top: 1px solid #eceff1;
                margin: 12px 0;
            }
            
            /* Strong and emphasis */
            .message-content strong,
            .message-content b {
                font-weight: 600;
            }
            
            .message-content em,
            .message-content i {
                font-style: italic;
            }
            
            .message-content u {
                text-decoration: underline;
            }
            
            /* Small text */
            .message-content small {
                font-size: 12px;
                color: #5f6368;
            }
            
            /* Subscript and superscript */
            .message-content sub,
            .message-content sup {
                font-size: 75%;
                line-height: 0;
                position: relative;
                vertical-align: baseline;
            }
            
            .message-content sup {
                top: -0.5em;
            }
            
            .message-content sub {
                bottom: -0.25em;
            }
            
            /* Strikethrough and deleted text */
            .message-content del,
            .message-content s,
            .message-content strike {
                text-decoration: line-through;
                color: #5f6368;
            }
            
            /* Mark/highlight */
            .message-content mark {
                background-color: #fef08a;
                color: #202124;
                padding: 2px 4px;
                border-radius: 2px;
            }
            
            /* Address tag */
            .message-content address {
                font-style: italic;
                margin: 10px 0;
                line-height: 1.5;
            }
            
            /* Definition lists */
            .message-content dl {
                margin: 10px 0;
            }
            
            .message-content dt {
                font-weight: 600;
                margin-top: 10px;
                margin-bottom: 4px;
            }
            
            .message-content dd {
                margin-left: 24px;
                margin-bottom: 10px;
            }
            
            /* Font tag support (old HTML, still used in emails) */
            .message-content font {
                display: inline;
            }
            
            /* Email signatures - common patterns */
            .message-content .gmail_signature,
            .message-content .gmail_quote,
            .message-content .signature,
            .message-content [class*="signature"],
            .message-content [id*="signature"] {
                margin-top: 12px;
                padding-top: 12px;
                border-top: 1px solid #eceff1;
                color: #5f6368;
                font-size: 13px;
            }
            
            /* Quoted/reply text - common email patterns */
            .message-content .gmail_quote,
            .message-content [class*="quote"],
            .message-content [id*="quote"] {
                border-left: 3px solid #dadce0;
                padding-left: 12px;
                margin: 10px 0;
                color: #5f6368;
                font-size: 13px;
            }
            
            /* Outlook-specific elements */
            .message-content [class*="MsoNormal"],
            .message-content [class*="MsoListParagraph"] {
                margin: 10px 0;
            }
            
            /* Email client specific spacing */
            .message-content br {
                line-height: 1.5;
            }
            
            /* Divider/separator elements */
            .message-content .divider,
            .message-content .separator {
                border-top: 1px solid #eceff1;
                margin: 12px 0;
                height: 0;
            }
            
            /* Nested blockquotes (common in email threads) */
            .message-content blockquote blockquote {
                margin-left: 12px;
                border-left-color: #c6c6c6;
            }
            
            .message-content blockquote blockquote blockquote {
                border-left-color: #9e9e9e;
            }
            
            /* Email client specific classes */
            .message-content [class*="Apple"] {
                /* Apple Mail specific styles */
            }
            
            .message-content [class*="Outlook"] {
                /* Outlook specific styles */
            }
            
            /* Common email wrapper patterns */
            .message-content .email-body,
            .message-content .email-content,
            .message-content .message-body {
                margin: 0;
                padding: 0;
            }
            
            /* Email footer patterns */
            .message-content .email-footer,
            .message-content .footer,
            .message-content [class*="footer"] {
                margin-top: 16px;
                padding-top: 12px;
                border-top: 1px solid #eceff1;
                font-size: 12px;
                color: #5f6368;
            }
            
            /* Email header patterns */
            .message-content .email-header,
            .message-content .header {
                margin-bottom: 12px;
                padding-bottom: 12px;
                border-bottom: 1px solid #eceff1;
            }
            
            /* Button styling in emails */
            .message-content .button,
            .message-content [class*="button"],
            .message-content a[class*="btn"] {
                display: inline-block;
                padding: 10px 20px;
                background-color: #1a73e8;
                color: #ffffff !important;
                text-decoration: none;
                border-radius: 4px;
                font-weight: 500;
                margin: 8px 4px;
            }
            
            .message-content .button:hover,
            .message-content [class*="button"]:hover,
            .message-content a[class*="btn"]:hover {
                background-color: #1557b0;
                text-decoration: none;
            }
            
            /* Email call-to-action buttons */
            .message-content [class*="cta"],
            .message-content [class*="call-to-action"] {
                display: inline-block;
                padding: 12px 24px;
                background-color: #1a73e8;
                color: #ffffff !important;
                text-decoration: none;
                border-radius: 4px;
                font-weight: 600;
                margin: 10px 0;
            }
            
            /* Spacer elements (common in email templates) */
            .message-content .spacer,
            .message-content [class*="spacer"] {
                display: block;
                height: 1px;
                line-height: 1px;
                font-size: 1px;
            }

            /* Preserve centering and alignment from email HTML - use !important to ensure they work */
            .message-content center {
                display: block !important;
                text-align: center !important;
            }

            .message-content [align="center"] {
                text-align: center !important;
                    }

            .message-content [align="left"] {
                text-align: left !important;
            }

            .message-content [align="right"] {
                text-align: right !important;
            }

            /* Ensure inline styles for text-align are preserved and work */
            .message-content [style*="text-align: center"],
            .message-content [style*="text-align:center"],
            .message-content [style*="text-align: center;"],
            .message-content [style*="text-align:center;"] {
                text-align: center !important;
            }

            .message-content [style*="text-align: left"],
            .message-content [style*="text-align:left"],
            .message-content [style*="text-align: left;"],
            .message-content [style*="text-align:left;"] {
                text-align: left !important;
        }

            .message-content [style*="text-align: right"],
            .message-content [style*="text-align:right"],
            .message-content [style*="text-align: right;"],
            .message-content [style*="text-align:right;"] {
                text-align: right !important;
            }

            /* Only constrain width - don't interfere with alignment */
            .message-content * {
                max-width: 100%;
                box-sizing: border-box;
            }
            
            /* Override any inline styles that add borders/outlines - use multiple selectors for maximum coverage */
            .message-content [style*="border"],
            .message-content [style*="outline"],
            .message-content [style*="box-shadow"],
            .message-content [style*="border:"],
            .message-content [style*="outline:"],
            .message-content [style*="box-shadow:"],
            .message-content [style*="border "],
            .message-content [style*="outline "],
            .message-content [style*="box-shadow "] {
                border: none !important;
                outline: none !important;
                box-shadow: none !important;
            }
            
            /* Specifically target table-related elements with inline styles */
            .message-content table[style],
            .message-content tr[style],
            .message-content td[style],
            .message-content th[style],
            .message-content div[style],
            .message-content span[style] {
                border: none !important;
                outline: none !important;
                box-shadow: none !important;
            }

            .email-full-header {
                padding: 16px 24px;
                border-bottom: 1px solid #eceff1;
                background: white;
            }

            .email-full-subject {
                margin: 0 0 12px 0;
                font-size: 22px;
                font-weight: 400;
                color: #202124;
                line-height: 1.38;
                font-family: 'Google Sans', Arial, sans-serif;
                letter-spacing: 0;
            }
            
            .email-full-metadata {
                color: #5f6368;
                font-size: 13px;
                line-height: 1.5;
                font-family: Arial, sans-serif;
            }
            
            .email-full-metadata-row {
                display: flex;
                align-items: flex-start;
                gap: 8px;
                margin-bottom: 6px;
            }
            
            .email-full-metadata-row:last-child {
                margin-bottom: 0;
            }
            
            .email-full-metadata-label {
                color: #5f6368;
                font-weight: 500;
                min-width: 50px;
                flex-shrink: 0;
            }
            
            .email-full-metadata-value {
                color: #202124;
                flex: 1;
            }

            .current-indicator {
                display: none;
            }

            .thread-line {
                display: none;
            }

            .message-attachments {
                margin: 12px 0;
                padding: 12px;
                background: #f8f9fa;
                border: 1px solid #dadce0;
                border-radius: 4px;
            }

            .attachment-item-view {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 12px;
                background: white;
                border: 1px solid #dadce0;
                border-radius: 4px;
                margin-bottom: 8px;
                cursor: pointer;
                transition: background-color 0.2s;
            }

            .attachment-item-view:last-child {
                margin-bottom: 0;
            }

            .attachment-item-view:hover {
                background: #e8f0fe;
                border-color: #1a73e8;
            }

            .attachment-icon {
                font-size: 18px;
                flex-shrink: 0;
            }

            .attachment-name-view {
                flex: 1;
                color: #1a73e8;
                font-weight: 500;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .attachment-size-view {
                color: #5f6368;
                font-size: 12px;
                flex-shrink: 0;
            }

            .thread-history-break {
                display: flex;
                align-items: center;
                margin: 32px 0 24px 0;
                padding: 0 20px;
            }

            .thread-history-line {
                flex: 1;
                height: 1px;
                background: #dadce0;
            }

            .thread-history-title {
                padding: 0 16px;
                color: #5f6368;
                font-size: 13px;
                font-weight: 500;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                white-space: nowrap;
            }
        </style>
        `;

        // Get headers from the first (most recent) message
        const firstMessageHeaders = messages[0].payload.headers;
        const subject = firstMessageHeaders.find(h => h.name === 'Subject')?.value || '(no subject)';
        const from = firstMessageHeaders.find(h => h.name === 'From')?.value || '';
        const to = firstMessageHeaders.find(h => h.name === 'To')?.value || '';
        const date = firstMessageHeaders.find(h => h.name === 'Date')?.value || '';
        
        // Extract sender name from email
        const senderMatch = from.match(/^"?([^"<]+)"?\s*(?:<.*>)?$/);
        const senderName = senderMatch ? senderMatch[1].trim() : from;
        const senderEmail = from.match(/<(.+)>/)?.[1] || from;
        
        // Update the email viewer content with styles
        emailContent.innerHTML = `
            ${threadStyles}
            <div class="email-full-header">
                <h1 class="email-full-subject">${subject}</h1>
                <div class="email-full-metadata">
                    <div class="email-full-metadata-row">
                        <span class="email-full-metadata-label">From:</span>
                        <span class="email-full-metadata-value">${senderName}</span>
                </div>
                    ${to ? `
                    <div class="email-full-metadata-row">
                        <span class="email-full-metadata-label">To:</span>
                        <span class="email-full-metadata-value">${to}</span>
            </div>
                    ` : ''}
                    <div class="email-full-metadata-row">
                        <span class="email-full-metadata-label">Date:</span>
                        <span class="email-full-metadata-value">${formatDate(new Date(date))}</span>
                    </div>
                </div>
            </div>
            <div class="thread-container">
                ${threadHtml}
            </div>
        `;
        
        // Inject email content into iframes with CSS reset for sandboxing
        setTimeout(() => {
            messageContents.forEach((content, iframeId) => {
                const iframe = document.getElementById(iframeId);
                if (iframe && iframe.contentDocument) {
                    try {
                        const doc = iframe.contentDocument;
                        const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        /* CSS Reset to prevent email CSS from affecting app UI */
        html, body {
            margin: 0 !important;
            padding: 0 !important;
            all: revert-layer;
            width: 100%;
            height: auto;
            min-height: 0;
            overflow: visible;
            background: white !important;
            color: #202124 !important;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 14px;
            line-height: 1.5;
        }
        
        /* Ensure email content is contained */
        body {
            padding: 12px;
            box-sizing: border-box;
            word-wrap: break-word;
            overflow-wrap: break-word;
        }
        
        /* Prevent email styles from breaking layout */
        * {
            max-width: 100%;
            box-sizing: border-box;
        }
        
        img {
            max-width: 100% !important;
            height: auto !important;
            display: inline-block;
        }
        
        /* Allow email content to display but prevent global resets */
        table {
            border-collapse: collapse;
            width: 100%;
        }
    </style>
</head>
<body>
    ${content}
</body>
</html>
                        `;
                        doc.open();
                        doc.write(htmlContent);
                        doc.close();
                        
                        // Auto-resize iframe to fit content
                        const resizeIframe = () => {
                            try {
                                const body = doc.body;
                                const html = doc.documentElement;
                                const height = Math.max(
                                    body.scrollHeight,
                                    body.offsetHeight,
                                    html.clientHeight,
                                    html.scrollHeight,
                                    html.offsetHeight
                                );
                                iframe.style.height = height + 'px';
                            } catch (e) {
                                console.warn('Error resizing iframe:', e);
                            }
                        };
                        
                        // Resize after content loads
                        iframe.onload = resizeIframe;
                        setTimeout(resizeIframe, 100);
                        setTimeout(resizeIframe, 500);
                        
                        // Watch for content changes (e.g., images loading)
                        const observer = new MutationObserver(resizeIframe);
                        observer.observe(doc.body, {
                            childList: true,
                            subtree: true,
                            attributes: true,
                            attributeFilter: ['src', 'style']
                        });
                        
                        // Also resize when images load
                        const images = doc.querySelectorAll('img');
                        images.forEach(img => {
                            img.onload = resizeIframe;
                            img.onerror = resizeIframe;
                        });
                        
                        console.log(`Injected content into iframe: ${iframeId}`);
                    } catch (e) {
                        console.error(`Error injecting content into iframe ${iframeId}:`, e);
                    }
                } else {
                    console.warn(`Iframe not found or not accessible: ${iframeId}`);
                }
            });
            messageContents.clear(); // Clear the map after injection
        }, 50);
        
        // Fix dark backgrounds with white text after content is inserted
        // Run multiple times to catch all elements, including dynamically loaded ones
        setTimeout(() => {
            fixDarkBackgroundText();
        }, 100);
        setTimeout(() => {
            fixDarkBackgroundText();
        }, 500);
        setTimeout(() => {
            fixDarkBackgroundText();
        }, 1000);

    } catch (error) {
        console.error('Error opening email:', error);
        
        // Show error message in the email viewer
        const emailContent = document.getElementById('email-viewer-content');
        if (emailContent) {
            emailContent.innerHTML = `
                <div style="text-align: center; padding: 20px; color: #d93025;">
                    <h3>Error Opening Email</h3>
                    <p>${error.message || 'An unexpected error occurred. Please try again.'}</p>
                    <button onclick="closeEmail()" style="margin-top: 15px; padding: 8px 16px; background: #1a73e8; color: white; border: none; border-radius: 4px; cursor: pointer;">
                        Return to Inbox
                    </button>
                </div>
            `;
        }
    }
}

// Function to detect dark backgrounds and apply white text
function fixDarkBackgroundText() {
    const messageContents = document.querySelectorAll('.message-content');
    
    messageContents.forEach(messageContent => {
        // Get all elements within message content, including the message-content itself
        const allElements = [messageContent, ...messageContent.querySelectorAll('*')];
        
        allElements.forEach(element => {
            // Skip if it's a link (links have special handling)
            if (element.tagName === 'A') {
                // Check if link is on dark background
                const parent = element.parentElement;
                if (parent) {
                    const parentBg = window.getComputedStyle(parent).backgroundColor;
                    const rgb = parentBg.match(/\d+/g);
                    if (rgb && rgb.length >= 3) {
                        const r = parseInt(rgb[0]);
                        const g = parseInt(rgb[1]);
                        const b = parseInt(rgb[2]);
                        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                        if (brightness < 128) {
                            element.style.setProperty('color', '#8ab4f8', 'important');
                        }
                    }
                }
                return;
            }
            
            // Get computed background color
            const computedStyle = window.getComputedStyle(element);
            const bgColor = computedStyle.backgroundColor;
            
            // Check if background color is dark
            if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
                const rgb = bgColor.match(/\d+/g);
                if (rgb && rgb.length >= 3) {
                    const r = parseInt(rgb[0]);
                    const g = parseInt(rgb[1]);
                    const b = parseInt(rgb[2]);
                    
                    // Calculate brightness (using relative luminance formula)
                    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                    
                    // If background is dark (brightness < 128), make text white
                    if (brightness < 128) {
                        // Force white text on this element
                        element.style.setProperty('color', '#ffffff', 'important');
                        
                        // Also apply to all direct text children (p, span, div, td, th, etc.)
                        const textChildren = element.querySelectorAll('p, span, div, td, th, h1, h2, h3, h4, h5, h6, li, label');
                        textChildren.forEach(child => {
                            if (child.tagName !== 'A') {
                                child.style.setProperty('color', '#ffffff', 'important');
                            }
                        });
                    }
                }
            }
            
            // Also check inline style attribute for background colors
            const inlineStyle = element.getAttribute('style') || '';
            if (inlineStyle) {
                // Check for black/dark backgrounds in inline styles
                const darkBgPatterns = [
                    /background[^:;]*:\s*(?:black|#000|#000000|rgb\s*\(\s*0\s*,\s*0\s*,\s*0\s*\)|rgba\s*\(\s*0\s*,\s*0\s*,\s*0\s*)/i,
                    /background[^:;]*:\s*#(?:000|111|222|333|444|555|666)/i,
                    /background[^:;]*:\s*rgb\s*\(\s*([0-2]?\d|1[0-2]\d)\s*,\s*([0-2]?\d|1[0-2]\d)\s*,\s*([0-2]?\d|1[0-2]\d)\s*\)/i
                ];
                
                const hasDarkBg = darkBgPatterns.some(pattern => {
                    const match = inlineStyle.match(pattern);
                    if (match && match[1] && match[2] && match[3]) {
                        // Check if RGB values are all low (dark)
                        const r = parseInt(match[1]);
                        const g = parseInt(match[2]);
                        const b = parseInt(match[3]);
                        return (r + g + b) < 384; // Sum less than 384 means dark
                    }
                    return match !== null;
                });
                
                if (hasDarkBg) {
                    element.style.setProperty('color', '#ffffff', 'important');
                    
                    // Apply to text children
                    const textChildren = element.querySelectorAll('p, span, div, td, th, h1, h2, h3, h4, h5, h6, li, label');
                    textChildren.forEach(child => {
                        if (child.tagName !== 'A') {
                            child.style.setProperty('color', '#ffffff', 'important');
                        } else {
                            child.style.setProperty('color', '#8ab4f8', 'important');
                        }
                    });
                }
            }
        });
    });
}

function closeEmail() {
    console.log("Closing email viewer");
    const emailViewer = document.getElementById('email-viewer');
    emailViewer.style.display = 'none';
    emailViewer.classList.remove('show');
    document.getElementById('email-viewer-content').innerHTML = ''; // Clear content
    
    // Clean up blob URLs to prevent memory leaks
    currentEmailBlobUrls.forEach(url => {
        try {
            URL.revokeObjectURL(url);
        } catch (e) {
            console.warn('Error revoking blob URL:', e);
        }
    });
    currentEmailBlobUrls = [];
    
    // Hide resize divider
    const resizeDivider = document.getElementById('resize-divider');
    if (resizeDivider) {
        resizeDivider.style.display = 'none';
    }
    
    // Reset email list to full width
    const emailList = document.getElementById('emailList');
    if (emailList) {
        emailList.style.width = '100%';
    }
    
    // Remove selected class from all email items
    document.querySelectorAll('.email-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    // Update the read status of the current email item visually (if it was marked as read)
    // No need to refresh the entire list - just update the visual state
    if (currentEmail) {
        const emailItem = document.getElementById(`email-${currentEmail}`);
        if (emailItem) {
            // Mark as read visually (remove unread styling)
            emailItem.classList.add('email-read');
            emailItem.classList.remove('selected');
        }
    }
    
    // Clear current email reference
    currentEmail = null;
    
    // Clear current email reference but KEEP thread context in conversation history
    // This allows the AI to still reference the thread even after the email viewer is closed
    currentEmailThreadContext = null;
    
    // DO NOT remove thread context from conversation history - keep it so AI can reference it
    // The context will be updated/replaced when a new email is opened
}

// Add this helper function to properly decode email text
function decodeEmailText(text) {
    if (!text) return '';
    
    try {
        // First try to decode HTML entities
        const textArea = document.createElement('textarea');
        textArea.innerHTML = text;
        text = textArea.value;

        // Then handle special characters
        return text
            .replace(/â€™/g, "'")
            .replace(/â€œ/g, '"')
            .replace(/â€/g, '"')
            .replace(/â€¦/g, '...')
            .replace(/â€"/g, '—')
            .replace(/Â/g, '')
            .replace(/&apos;/g, "'")
            .replace(/&#x27;/g, "'")
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&');
    } catch (error) {
        console.error('Error decoding text:', error);
        return text;
    }
}

// Update switchSection function
async function switchSection(section) {
    // Close any open email
    closeEmail();
    
    // Show email tabs
    const emailTabs = document.querySelector('.email-tabs');
    emailTabs.style.display = 'flex';
    
    // Hide AI Settings if visible
    const aiSettingsContainer = document.getElementById('ai-settings-container');
    if (aiSettingsContainer) {
        aiSettingsContainer.style.display = 'none';
    }
    
    // Hide Profile Settings if visible
    const profileSettingsContainer = document.getElementById('profile-settings-container');
    if (profileSettingsContainer) {
        profileSettingsContainer.style.display = 'none';
    }
    
    // Show email list container
    const emailListContainer = document.querySelector('.email-list-container');
    if (emailListContainer) {
        emailListContainer.style.display = 'flex';
    }
    
    // Show email list
    const emailList = document.getElementById('emailList');
    if (emailList) {
        emailList.style.display = 'block';
    }
    
    // Show search bar
    const searchBar = document.querySelector('.search-bar');
    if (searchBar) {
        searchBar.style.display = 'flex';
    }
    
    // Clear ALL active states from sidebar items first
    document.querySelectorAll('.nav-item, .sub-nav-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Activate only the main Inbox nav-item
    const inboxNavItem = document.querySelector('.nav-item[onclick*="switchSection"]');
    if (inboxNavItem) {
        inboxNavItem.classList.add('active');
    }
    
    // Switch to primary tab immediately
    await switchTab('primary');
}

function deleteEmail(emailId) {
    console.log('Delete functionality coming soon');
}

// Function to reset AI chat
function resetAIChat() {
    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return;
    
    // Reset UI to show conversation history
    renderChatHistory();
    
    // Reset any state variables
    window.awaitingEmailConfirmation = false;
    window.lastGeneratedEmail = null;
    
    // Clear chat input if it exists
    const chatInput = document.getElementById('chat-input');
    if (chatInput) chatInput.value = '';
    
    console.log('AI chat UI has been reset (history preserved)');
}

// Function to render conversation history in the chat UI
function renderChatHistory() {
    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return;
    
    // Clear existing messages
    chatMessages.innerHTML = '';
    
    // Render all messages except the system message
    conversationHistory.forEach(msg => {
        if (msg.role === 'system') return; // Skip system messages in UI
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${msg.role}`;
        messageDiv.textContent = msg.content;
        chatMessages.appendChild(messageDiv);
    });
    
    // If no messages (only system), show welcome message
    if (conversationHistory.length <= 1) {
        chatMessages.innerHTML = `
            <div class="chat-message ai">
                How can I help you with your emails today?
            </div>
        `;
        // Add welcome message to history if not present
        const hasWelcome = conversationHistory.some(m => 
            m.role === 'assistant' && m.content.includes('How can I help')
        );
        if (!hasWelcome) {
            conversationHistory.push({
                role: "assistant",
                content: "How can I help you with your emails today?"
            });
        }
    }
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Add DEBUG helper function at the top of the file
function DEBUG(label, data) {
    console.log(`%c DEBUG: ${label} `, 'background: #007bff; color: white; padding: 2px 4px; border-radius: 2px;', data);
}

// Update sendChatMessage function to improve debugging
async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const messages = document.getElementById('chat-messages');
    const userMessage = input.value.trim();
    
    if (!userMessage) return;
    
    try {
        DEBUG('User message', userMessage);
        
        // First check if we're awaiting confirmation for an email
        if (window.awaitingEmailConfirmation === true) {
            DEBUG("Processing confirmation response via Send button", userMessage);
            
            // Add user message to UI
            messages.innerHTML += `
                <div class="chat-message user">
                    ${userMessage}
                </div>
            `;
            input.value = ''; // Clear input field
            
            // Check if it's a confirmation
            const isConfirmation = /^(yes|yeah|yea|yep|sure|ok|okay|y|good|fine|great)/i.test(userMessage);
            DEBUG("Is confirmation?", isConfirmation);
            
            if (isConfirmation) {
                DEBUG("Confirmation received", {
                    hasLastGeneratedEmail: !!window.lastGeneratedEmail,
                    preview: window.lastGeneratedEmail ? 
                        window.lastGeneratedEmail.substring(0, 50) + "..." : 
                        "No content"
                });
                
                // Check if lastGeneratedEmail exists and is not empty
                if (!window.lastGeneratedEmail) {
                    DEBUG("ERROR: lastGeneratedEmail is empty or null");
                    
                    messages.innerHTML += `
                        <div class="chat-message ai">
                            Sorry, I couldn't find the email content to move. Let me try generating a new email for you.
                        </div>
                    `;
                    
                    // Clear confirmation state
                    window.awaitingEmailConfirmation = false;
                    window.lastGeneratedEmail = null;
                    
                    // Reset state and return - don't continue with regular flow
                    messages.scrollTop = messages.scrollHeight;
                    return;
                }
                
                try {
                    // Move content to compose area
                    const success = moveEmailToCompose(window.lastGeneratedEmail);
                    
                    // Show confirmation message
                    messages.innerHTML += `
                        <div class="chat-message ai">
                            ${success ? 
                                "I've moved the email to the compose area for you. You can edit it there before sending." : 
                                "I had trouble moving the email to the compose area. Please try again or let me generate a new email."}
                        </div>
                    `;
                } catch (error) {
                    DEBUG("ERROR in moveEmailToCompose", error);
                    
                    messages.innerHTML += `
                        <div class="chat-message ai">
                            Sorry, there was an error moving the email. Please try again.
                        </div>
                    `;
                }
                
                // Clear confirmation state and return - don't continue with regular flow
                window.awaitingEmailConfirmation = false;
                window.lastGeneratedEmail = null;
                messages.scrollTop = messages.scrollHeight;
                return;
            }
            
            // If not a confirmation, treat it as a regular message and clear confirmation state
            // This allows users to ask questions even when confirmation is pending
            window.awaitingEmailConfirmation = false;
            window.lastGeneratedEmail = null;
            // Continue with regular message flow below
        }
        
        // Continue with regular message flow - this is the original function logic
        
        // Check if the message appears to be an email request
        const isEmailRequest = checkIfEmailRequest(userMessage);
        DEBUG('Is email request?', isEmailRequest);
        
        // Add user message to UI - skip if we already added it above
        if (!window.awaitingEmailConfirmation) {
            messages.innerHTML += `
                <div class="chat-message user">
                    ${userMessage}
                </div>
            `;
            input.value = ''; // Clear input field
        }
        
        // Show loading state
        messages.innerHTML += `
            <div class="chat-message ai" id="loading-message">
                <em>Typing...</em>
            </div>
        `;
        messages.scrollTop = messages.scrollHeight;

        // Add user message to conversation history
        conversationHistory.push({
            role: "user",
            content: userMessage
        });

        // Include current time in the API request
        DEBUG('Sending chat request to server', {
            message: userMessage, 
            historyLength: conversationHistory.length
        });
        
        // Get AI tone preference, length, context awareness, and signature from localStorage
        const aiTone = localStorage.getItem('aiTone') || 'professional';
        const aiLength = localStorage.getItem('aiLength') || 'medium';
        const aiContextAwareness = localStorage.getItem('aiContextAwareness') || 'on';
        const aiSignature = localStorage.getItem('aiSignature') || '';
        
        // Build the message with thread context if available and context awareness is enabled
        let messageWithContext = userMessage;
        let enhancedHistory = [...conversationHistory];
        
        if (aiContextAwareness === 'on') {
            // Check if we have a current thread context (email is open)
            if (currentEmailThreadContext) {
                // Update or add thread context as a system message
                // First, remove any existing thread context system messages
                enhancedHistory = enhancedHistory.filter(msg => {
                    if (msg.role === 'system' && msg.content) {
                        const content = msg.content.toLowerCase();
                        return !(content.includes('email thread') || 
                                 content.includes('thread context') ||
                                 content.includes('email_thread') ||
                                 content.includes('thread_context'));
                    }
                    return true;
                });
                
                // Add current thread context as a system message after the main system message
                const contextSystemMessage = {
                    role: "system",
                    content: `=== EMAIL THREAD CONTEXT - READ THIS FIRST ===

You are viewing an email thread. When the user asks questions about emails, ALWAYS refer to the thread context below, NOT to example emails.

THREAD CONTEXT:
${currentEmailThreadContext.context}

CRITICAL RULES:
1. When asked "what was the original email?" or "give me the first email" → Return the FIRST message from the thread context above
2. When asked "what email did you reply to?" → Return the message that was replied to from the thread context
3. When asked about email content → Use ONLY the actual content from the thread context above
4. NEVER use the example email "Meeting Request for Project Discussion" - that is just an example format
5. ALWAYS use the actual sender names, subjects, dates, and content from the thread context
6. If the user asks for "exact text" → Copy the EXACT text from the thread context, word for word

The thread context above contains the REAL emails. Use it.`
                };
                
                // Insert context after the main system message but before user messages
                if (enhancedHistory.length > 0 && enhancedHistory[0].role === 'system') {
                    enhancedHistory.splice(1, 0, contextSystemMessage);
                } else {
                    enhancedHistory.unshift(contextSystemMessage);
                }
                
                DEBUG('Including current thread context in chat', { 
                    threadId: currentEmailThreadContext.threadId,
                    messageCount: currentEmailThreadContext.messageCount,
                    contextLength: currentEmailThreadContext.context.length,
                    historyLength: enhancedHistory.length
                });
            } else {
                // No email currently open, but check if we have thread context in history
                // Keep any existing thread context in history so AI can still reference it
                const hasThreadContext = enhancedHistory.some(msg => 
                    msg.role === 'system' && 
                    msg.content && 
                    (msg.content.toLowerCase().includes('email thread') || 
                     msg.content.toLowerCase().includes('thread context') ||
                     msg.content.toLowerCase().includes('email_thread') ||
                     msg.content.toLowerCase().includes('thread_context'))
                );
                
                if (hasThreadContext) {
                    DEBUG('Using preserved thread context from conversation history');
                } else {
                    DEBUG('No thread context available in current conversation');
                }
            }
        }
        
        // Log what we're sending to help debug
        const threadContextInHistory = enhancedHistory.find(msg => 
            msg.role === 'system' && 
            msg.content && 
            (msg.content.includes('THREAD CONTEXT') || msg.content.includes('EMAIL THREAD'))
        );
        DEBUG('Sending to server', {
            historyLength: enhancedHistory.length,
            hasThreadContext: !!threadContextInHistory,
            threadContextPreview: threadContextInHistory ? threadContextInHistory.content.substring(0, 200) + '...' : 'none'
        });
        
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                message: messageWithContext,
                history: enhancedHistory,
                timestamp: new Date().toISOString(), // Add current timestamp
                tone: aiTone,
                length: aiLength,
                contextAwareness: aiContextAwareness,
                signature: aiSignature
            })
        });

        // Remove loading message
        const loadingMessage = document.getElementById('loading-message');
        if (loadingMessage) {
            loadingMessage.remove();
        }

        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }

        const data = await response.json();
        const aiResponse = data.response;
        DEBUG('AI response', aiResponse);

        // Add AI response to conversation history
        conversationHistory.push({
            role: "assistant",
            content: aiResponse
        });

        // Update localStorage with new history
        localStorage.setItem('chatHistory', JSON.stringify(conversationHistory));

        // Add AI response to UI
        messages.innerHTML += `
            <div class="chat-message ai">
                ${aiResponse}
            </div>
        `;

        // Check if response contains an email - but only if it's actually a generated email, not an example
        // Only trigger confirmation if the user explicitly asked for an email to be generated
        const userAskedForEmail = checkIfEmailRequest(userMessage);
        const isEmailFormat = containsEmailFormat(aiResponse);
        DEBUG('Is email format detected?', isEmailFormat);
        DEBUG('User asked for email?', userAskedForEmail);
        
        // Only show confirmation if it's actually a generated email AND user asked for one
        if (isEmailFormat && userAskedForEmail) {
            DEBUG("Email detected in response", {
                firstChars: aiResponse.substring(0, 50),
                length: aiResponse.length
            });
            
            // Store email content globally
            window.lastGeneratedEmail = aiResponse;
            window.awaitingEmailConfirmation = true;
            
            // Add a visible confirmation question
            messages.innerHTML += `
                <div class="chat-message ai confirmation-prompt" style="margin-top: 10px; color: #1a73e8; font-weight: bold;">
                    Would you like me to move this email to the compose area? (Yes/No)
                </div>
            `;
        } else {
            DEBUG("No email confirmation needed", {
                isEmailFormat,
                userAskedForEmail,
                response: aiResponse.substring(0, 100) + "..."
            });
        }

    } catch (error) {
        console.error('Error in chat:', error);
        
        // Show error message
        messages.innerHTML += `
            <div class="chat-message ai">
                Sorry, I'm having trouble responding right now. Please try again.
            </div>
        `;
    }
    
    messages.scrollTop = messages.scrollHeight;
}

// Improve email detection function
function containsEmailFormat(text) {
    if (!text) return false;
    
    // Log the first part of text being checked for debugging
    DEBUG("Checking for email format", { preview: text.substring(0, 100) + "..." });

    // Skip detection if this looks like an example email from system prompt
    const lowerText = text.toLowerCase();
    if (lowerText.includes('meeting request for project discussion') ||
        lowerText.includes('[user\'s name]') ||
        lowerText.includes('example email format') ||
        lowerText.includes('for email example:')) {
        DEBUG("Skipping email detection - appears to be example email");
        return false;
    }

    // Check for common email components
    const hasSubject = text.includes("Subject:") || text.includes("SUBJECT:") || 
                      text.match(/^([A-Za-z\s]+):\s*[A-Za-z]/m) !== null ||
                      text.match(/^(Re|RE|Fwd|FWD):/m) !== null;
    
    // Check for greeting
    const hasGreeting = text.includes("Dear") || text.includes("Hello") || 
                       text.includes("Hi") || text.includes("Hey") || 
                       text.includes("Greetings") || text.match(/^[A-Za-z\s,]+,/m) !== null ||
                       text.match(/^To whom/i) !== null || text.match(/^Good (morning|afternoon|evening)/i) !== null;
    
    // Check for closing
    const hasClosing = text.includes("Sincerely") || text.includes("Best") || 
                      text.includes("Regards") || text.includes("Thank you") || 
                      text.includes("Thanks") || text.includes("Cheers") ||
                      text.includes("Yours") || text.includes("Warm") || 
                      text.includes("See you") || text.includes("Truly") ||
                      text.includes("Appreciate") || text.includes("Respectfully");
    
    // Additional checks for email-like structures
    const hasMultipleLines = text.split('\n').length > 3;
    const hasSignature = text.includes("\n\n") && text.length > 100;
    
    DEBUG("Email format detection results:", {hasSubject, hasGreeting, hasClosing, hasMultipleLines, hasSignature});
    
    // Return true if the text has the structure of an email AND it's not an example
    const isEmail = (hasSubject && hasGreeting) || 
           (hasSubject && hasClosing) || 
           (hasGreeting && hasClosing) ||
           (hasSubject && hasMultipleLines && hasSignature) ||
           (hasGreeting && hasMultipleLines && hasSignature) ||
           (hasClosing && hasMultipleLines && hasSignature);
    
    return isEmail;
}

// Improve handleChatKeyPress to better handle confirmation
function handleChatKeyPress(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        
        const input = document.getElementById('chat-input');
        const userMessage = input.value.trim();
        
        if (!userMessage) return;
        
        // If awaiting confirmation for email
        if (window.awaitingEmailConfirmation === true) {
            DEBUG("Processing confirmation response", userMessage);
            
            const messages = document.getElementById('chat-messages');
            
            // Add user message to UI
            messages.innerHTML += `
                <div class="chat-message user">
                    ${userMessage}
                </div>
            `;
            input.value = ''; // Clear input
            
            // Check if it's a confirmation
            const isConfirmation = /^(yes|yeah|yea|yep|sure|ok|okay|y|good|fine|great)/i.test(userMessage);
            DEBUG("Is confirmation?", isConfirmation);
            
            if (isConfirmation) {
                DEBUG("Confirmation received", {
                    hasLastGeneratedEmail: !!window.lastGeneratedEmail,
                    preview: window.lastGeneratedEmail ? 
                        window.lastGeneratedEmail.substring(0, 50) + "..." : 
                        "No content"
                });
                
                // Check if lastGeneratedEmail exists and is not empty
                if (!window.lastGeneratedEmail) {
                    DEBUG("ERROR: lastGeneratedEmail is empty or null");
                    
                    messages.innerHTML += `
                        <div class="chat-message ai">
                            Sorry, I couldn't find the email content to move. Let me try generating a new email for you.
                        </div>
                    `;
                    
                    // Clear confirmation state
                    window.awaitingEmailConfirmation = false;
                    window.lastGeneratedEmail = null;
                    
                    // Continue with regular chat
                    sendChatMessage();
                    return;
                }
                
                try {
                    // Move content to compose area
                    const success = moveEmailToCompose(window.lastGeneratedEmail);
                    
                    // Show confirmation message
                    messages.innerHTML += `
                        <div class="chat-message ai">
                            ${success ? 
                                "I've moved the email to the compose area for you. You can edit it there before sending." : 
                                "I had trouble moving the email to the compose area. Please try again or let me generate a new email."}
                        </div>
                    `;
                } catch (error) {
                    DEBUG("ERROR in moveEmailToCompose", error);
                    
                    messages.innerHTML += `
                        <div class="chat-message ai">
                            Sorry, there was an error moving the email. Please try again.
                        </div>
                    `;
                }
            } else {
                DEBUG("Non-confirmation received, continuing chat", userMessage);
                // Handle as regular message
                sendChatMessage();
            }
            
            // Clear confirmation state regardless of response
            window.awaitingEmailConfirmation = false;
            window.lastGeneratedEmail = null;
        } else {
            // Regular chat message
            sendChatMessage();
        }
        
        // Scroll to bottom in all cases
        messages.scrollTop = messages.scrollHeight;
    }
}

// Add function to check if the user is asking for an email to be written
function checkIfEmailRequest(message) {
    const emailRequestPatterns = [
        /write (me|an) (a |)(email|mail)/i,
        /draft (me|an) (a |)(email|mail)/i,
        /create (me|an) (a |)(email|mail)/i,
        /compose (me|an) (a |)(email|mail)/i,
        /help (me |)write (an |a |)(email|mail)/i,
        /generate (me |)(an |a |)(email|mail)/i
    ];
    
    return emailRequestPatterns.some(pattern => pattern.test(message));
}

// Function to find the most recent email in the conversation history
function findEmailInHistory(history) {
    // Start from the end and look for the most recent assistant message with email format
    for (let i = history.length - 1; i >= 0; i--) {
        const message = history[i];
        if (message.role === 'assistant' && containsEmailFormat(message.content)) {
            return message.content;
        }
    }
    return null;
}

// Update the openComposeModal function to properly set the title
function openComposeModal(replyTo = null) {
    // Reset the form fields first
    resetComposeWindow();
    
    console.log('Opening compose modal', replyTo ? 'as reply' : 'as new message');
    
    const modal = document.getElementById('compose-modal');
    if (!modal) {
        console.error('Compose modal not found');
        return;
    }

    // If we're replying to an email, store the data globally
    if (replyTo) {
        window.replyToData = replyTo;
    } else if (window.replyToData) {
        // If we're not explicitly replying but replyToData exists from somewhere else, keep using it
        // This handles the case where replyEmail() was called first
    } else {
        // Clear any existing reply data
        window.replyToData = null;
    }

    // Find and update the modal title
    const modalTitle = modal.querySelector('.modal-header h2');
    if (modalTitle) {
        modalTitle.textContent = window.replyToData ? 'Reply' : 'New Message';
    }

    // Reset form fields
    const toField = document.getElementById('compose-to');
    const subjectField = document.getElementById('compose-subject');
    const bodyField = document.getElementById('compose-body');
    
    if (replyTo) {
        // Populate fields from explicit replyTo parameter
        if (toField) toField.value = replyTo.from || '';
        if (subjectField) subjectField.value = replyTo.subject ? (replyTo.subject.startsWith('Re:') ? replyTo.subject : `Re: ${replyTo.subject}`) : '';
    if (bodyField) {
        if (bodyField.getAttribute('contenteditable') === 'true') {
                bodyField.innerHTML = replyTo.body ? `

On ${replyTo.date || 'earlier'}, ${replyTo.from || 'sender'} wrote:
${replyTo.body.split('\n').map(line => '> ' + line).join('\n')}` : '';
        } else {
                bodyField.value = replyTo.body ? `

On ${replyTo.date || 'earlier'}, ${replyTo.from || 'sender'} wrote:
${replyTo.body.split('\n').map(line => '> ' + line).join('\n')}` : '';
            }
        }
    } else if (window.replyToData && !replyTo) {
        // If replyTo is null but we have replyToData set by replyEmail()
        if (toField) toField.value = window.replyToData.from || '';
        if (subjectField) subjectField.value = window.replyToData.subject ? 
            (window.replyToData.subject.startsWith('Re:') ? window.replyToData.subject : `Re: ${window.replyToData.subject}`) : '';
        // No need to set body here - it will be filled by AI or user
    }

    // Show the modal
    modal.style.display = 'block';
    document.body.classList.add('modal-open');
    setTimeout(() => modal.classList.add('show'), 10);
    
    // Reset AI chat UI (but preserve conversation history)
    resetAIChat();
    
    // Setup event handlers for chat input
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        // Remove any existing event listeners to prevent duplicates
        chatInput.removeEventListener('keypress', handleChatKeyPress);
        // Add the event listener
        chatInput.addEventListener('keypress', handleChatKeyPress);
    }
}

// Make sure the compose button explicitly calls with null parameter and restore sidebar state
document.addEventListener('DOMContentLoaded', function() {
    // Handle sidebar compose button
    const composeBtnSidebar = document.getElementById('compose-btn-sidebar');
    if (composeBtnSidebar) {
        composeBtnSidebar.onclick = function(e) {
            e.preventDefault();
            openComposeModal(null);
            console.log('Compose button clicked - opening new message');
        };
    }
    
    // Restore sidebar collapsed state
    const sidebar = document.getElementById('sidebar');
    if (sidebar && localStorage.getItem('sidebarCollapsed') === 'true') {
        sidebar.classList.add('collapsed');
    }
});

// Update closeComposeModal to properly close and reset the modal
function closeComposeModal() {
    const modal = document.getElementById('compose-modal');
    
    // Hide the modal
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('show');
        modal.classList.remove('minimized');
    }
    
    document.body.classList.remove('modal-open');
    
    // Reset the form after closing
    resetComposeWindow();
    
    // Clear any chat history in the AI assistant area
    resetAIChat();
    
    console.log('Compose modal closed and reset');
}

// Toggle compose modal minimize/restore
function toggleComposeModal() {
    const modal = document.getElementById('compose-modal');
    if (!modal || modal.style.display === 'none') return;
    
    if (modal.classList.contains('minimized')) {
        // Restore modal
        modal.classList.remove('minimized');
        modal.style.height = '650px';
        modal.style.width = '800px';
    } else {
        // Minimize modal
        modal.classList.add('minimized');
        modal.style.height = '60px';
        modal.style.width = '300px';
    }
}

// Allow clicking minimized modal header to restore
document.addEventListener('DOMContentLoaded', function() {
    const modal = document.getElementById('compose-modal');
    if (modal) {
        const modalHeader = modal.querySelector('.modal-header');
        if (modalHeader) {
            modalHeader.addEventListener('click', function(e) {
                // Only restore if minimized and not clicking buttons
                if (modal.classList.contains('minimized') && 
                    !e.target.closest('.minimize-modal-btn') && 
                    !e.target.closest('.close-modal')) {
                    toggleComposeModal();
                }
            });
        }
    }
});

// Toggle sidebar collapse/expand
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    
    sidebar.classList.toggle('collapsed');
    
    // Save state to localStorage
    localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
}

// Make functions globally accessible
window.toggleComposeModal = toggleComposeModal;
window.toggleSidebar = toggleSidebar;


// Function to send an email
async function sendEmail() {
    try {
        const to = document.getElementById('compose-to').value;
        const subject = document.getElementById('compose-subject').value;
        
        // Get content from contenteditable div or hidden textarea
        let body;
        const bodyField = document.getElementById('compose-body');
        
        if (bodyField.getAttribute('contenteditable') === 'true') {
            // Get from contenteditable div
            body = bodyField.innerHTML;
            
            // Also check hidden textarea as a backup
            const hiddenBody = document.getElementById('compose-body-hidden');
            if (!body && hiddenBody && hiddenBody.value) {
                body = hiddenBody.value;
            }
        } else {
            // Get from regular textarea
            body = bodyField.value;
        }
        
        // Convert HTML to plain text for email
        if (body.includes('<') && body.includes('>')) {
            // Simple HTML to text conversion
            body = body.replace(/<div>/gi, '\n')
                      .replace(/<\/div>/gi, '')
                      .replace(/<br\s*\/?>/gi, '\n')
                      .replace(/<[^>]+>/g, '')
                      .replace(/&nbsp;/g, ' ');
        }

        console.log('Body content:', body);

        if (!to || !subject || !body) {
            alert('Please fill in all fields');
            return;
        }

        console.log('Sending email to:', to);
        console.log('Subject:', subject);

        // Check if this is a reply (has threadId and originalMessageId)
        const isReply = window.replyToData && window.replyToData.threadId;
        
        // Check if we have attachments
        const hasAttachments = emailAttachments && emailAttachments.length > 0;
        
        // Create email headers
        const headers = [
            `From: ${userEmail}`,
            `To: ${to}`,
            'MIME-Version: 1.0',
            `Subject: ${subject}`
        ];
        
        // Add threading headers for replies
        if (isReply && window.replyToData.originalMessageId) {
            // Make sure the message ID has angle brackets if it doesn't already
            const formattedMessageId = window.replyToData.originalMessageId.includes('<') ? 
                window.replyToData.originalMessageId : 
                `<${window.replyToData.originalMessageId}>`;
            
            // In-Reply-To and References headers are crucial for proper threading
            headers.push(`In-Reply-To: ${formattedMessageId}`);
            headers.push(`References: ${formattedMessageId}`);
            
            DEBUG("Adding threading headers", {
                threadId: window.replyToData.threadId,
                originalMessageId: window.replyToData.originalMessageId,
                formattedMessageId: formattedMessageId
            });
        }
        
        let emailContent;
        
        if (hasAttachments) {
            // Create multipart message with attachments
            const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
            
            // Build multipart message
            const parts = [];
            
            // Add text body part
            parts.push(`--${boundary}`);
            parts.push('Content-Type: text/plain; charset=utf-8');
            parts.push('Content-Transfer-Encoding: 7bit');
            parts.push('');
            parts.push(body);
            
            // Add each attachment
            for (const file of emailAttachments) {
                const fileData = await readFileAsBase64(file);
                const base64Data = fileData.split(',')[1]; // Remove data URL prefix
                
                parts.push(`--${boundary}`);
                parts.push(`Content-Type: ${file.type || 'application/octet-stream'}`);
                parts.push('Content-Transfer-Encoding: base64');
                parts.push(`Content-Disposition: attachment; filename="${file.name}"`);
                parts.push('');
                // Split base64 into 76-character lines (RFC 2045)
                const base64Lines = base64Data.match(/.{1,76}/g) || [base64Data];
                parts.push(base64Lines.join('\r\n'));
            }
            
            parts.push(`--${boundary}--`);
            
            emailContent = [
                ...headers,
                '', // Empty line separates headers from body
                parts.join('\r\n')
            ].join('\r\n');
        } else {
            // Simple text email without attachments
            headers.push('Content-Type: text/plain; charset=utf-8');
            
            emailContent = [
                ...headers,
                '', // Empty line separates headers from body
            body
        ].join('\r\n');
        }

        console.log('Email content:', emailContent.substring(0, 500) + '...');

        // Base64 encode the email
        const encodedEmail = btoa(unescape(encodeURIComponent(emailContent)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

        console.log('Making API call...');

        let response;
        
        // Different handling for reply vs new email
        if (isReply) {
            DEBUG("Sending reply to thread", {
                threadId: window.replyToData.threadId,
                hasThreadingHeaders: !!window.replyToData.originalMessageId
            });
            
            // For replies, we'll use the different approach recommended in the Gmail API docs
            response = await gapi.client.gmail.users.messages.send({
                'userId': 'me',
                'resource': {
                    'raw': encodedEmail,
                    'threadId': window.replyToData.threadId
                }
            });
            
            console.log('Reply sent with threadId:', window.replyToData.threadId);
        } else {
            // For new emails (not replies)
            response = await gapi.client.gmail.users.messages.send({
            'userId': 'me',
            'resource': {
                'raw': encodedEmail
            }
        });
        }

        console.log('API Response:', response);

        closeComposeModal();
        alert('Email sent successfully!');

    } catch (error) {
        console.error('Detailed error:', error);
        alert(`Error sending email: ${error.message || 'Unknown error'}`);
    }
}

// Ensure the compose button is correctly set up
const composeBtn = document.getElementById('compose-btn-sidebar');
if (composeBtn) {
    composeBtn.onclick = function(e) {
        e.preventDefault();
        openComposeModal(null);
    };
}

// Helper function to add a timeout to a promise
function withTimeout(promise, timeout) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Request timed out')), timeout)
        )
    ]);
}

// Update the refreshEmails function to handle manual refresh
async function refreshEmails(retryCount = 0, forceRefresh = true) {
    try {
        // Show loading state in the email list
        document.getElementById('emailList').innerHTML = '<div style="text-align: center; padding: 20px;">Loading...</div>';
        
        // Get the current active category/filter
        const activeTab = currentFilter || 'primary';
        
        // Fetch new emails for the current category
        const newEmails = await listEmails(currentPage, activeTab);
        
        // Display the new emails
        if (newEmails) {
            displayEmails(newEmails);
            console.log('Emails refreshed successfully');
        }

    } catch (error) {
        console.error("Failed to refresh emails:", error);
        if (retryCount < 3) {
            console.log(`Retrying refresh in 2 seconds... (Attempt ${retryCount + 1})`);
            setTimeout(() => refreshEmails(retryCount + 1, forceRefresh), 2000);
        } else {
            document.getElementById('emailList').innerHTML = 
                '<div style="text-align: center; padding: 20px;">Error refreshing emails. Please try again.</div>';
        }
    }
}

// Add animation to the refresh button when clicked
function handleRefreshClick() {
    const refreshIcon = document.querySelector('.refresh-icon');
    refreshIcon.style.transform = 'rotate(360deg)';
    
    // Reset the rotation after animation
    setTimeout(() => {
        refreshIcon.style.transform = 'rotate(0deg)';
    }, 1000);
    
    // Perform the refresh
    refreshEmails();
}

// Update the refresh button onclick handler in the HTML
document.addEventListener('DOMContentLoaded', () => {
    const refreshBtn = document.querySelector('.refresh-btn');
    if (refreshBtn) {
        refreshBtn.onclick = handleRefreshClick;
    }
    
    // Initialize resize divider
    initializeResizeDivider();
    
    // Initialize modal resize handles
    initializeModalResize();
});

// Function to initialize the resize divider
function initializeResizeDivider() {
    const divider = document.getElementById('resize-divider');
    const emailList = document.getElementById('emailList');
    const emailListContainer = document.querySelector('.email-list-container');
    
    if (!divider || !emailList || !emailListContainer) return;
    
    let isDragging = false;
    let startX = 0;
    let startWidth = 0;
    
    divider.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startWidth = emailList.offsetWidth;
        divider.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const containerWidth = emailListContainer.offsetWidth;
        const diff = e.clientX - startX;
        let newWidth = startWidth + diff;
        
        // Constrain width between min and max
        const minWidth = 300;
        const maxWidth = containerWidth * 0.7; // Max 70% of container
        
        if (newWidth < minWidth) {
            newWidth = minWidth;
        } else if (newWidth > maxWidth) {
            newWidth = maxWidth;
        }
        
        emailList.style.width = newWidth + 'px';
    });
    
    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            divider.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            
            // Save width to localStorage
            const currentWidth = emailList.offsetWidth;
            localStorage.setItem('emailListWidth', currentWidth);
        }
    });
}

// Function to initialize modal resize handles
function initializeModalResize() {
    const modal = document.getElementById('compose-modal');
    if (!modal) return;
    
    const resizeBottom = document.getElementById('modal-resize-bottom');
    const resizeCorner = document.getElementById('modal-resize-corner');
    const resizeTopRight = document.getElementById('modal-resize-top-right');
    const resizeRight = document.getElementById('modal-resize-right');
    
    if (!resizeBottom || !resizeCorner || !resizeTopRight || !resizeRight) return;
    
    let isResizing = false;
    let resizeType = null; // 'width', 'height', 'both', or 'top-right'
    let startX = 0;
    let startY = 0;
    let startWidth = 0;
    let startHeight = 0;
    let startLeft = 0;
    let startBottom = 0;
    
    // Restore saved size (position stays locked to left/bottom)
    const savedWidth = localStorage.getItem('composeModalWidth');
    const savedHeight = localStorage.getItem('composeModalHeight');
    
    if (savedWidth && savedHeight) {
        modal.style.width = savedWidth + 'px';
        modal.style.height = savedHeight + 'px';
    }
    
    // Always keep modal locked to left and bottom
    modal.style.left = '24px';
    modal.style.bottom = '0';
    modal.style.right = 'auto';
    modal.style.top = 'auto';
    
    function startResize(e, type) {
        if (modal.classList.contains('minimized')) return;
        
        isResizing = true;
        resizeType = type;
        startX = e.clientX;
        startY = e.clientY;
        startWidth = modal.offsetWidth;
        startHeight = modal.offsetHeight;
        
        // For top-right resize, we need to track position too
        if (type === 'top-right') {
            const rect = modal.getBoundingClientRect();
            startLeft = rect.left;
            startBottom = window.innerHeight - rect.bottom;
        }
        
        // Disable transitions during resize
        modal.classList.add('resizing');
        
        document.body.style.cursor = type === 'width' ? 'ew-resize' : type === 'height' ? 'ns-resize' : 'nwse-resize';
        document.body.style.userSelect = 'none';
        
        if (resizeBottom) resizeBottom.classList.add('dragging');
        if (resizeCorner) resizeCorner.classList.add('dragging');
        if (resizeTopRight) resizeTopRight.classList.add('dragging');
        if (resizeRight) resizeRight.classList.add('dragging');
        
        e.preventDefault();
    }
    
    // Removed drag functionality - modal stays locked to right side
    
    function handleResize(e) {
        if (!isResizing) return;
        
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        
        // Handle top-right resize - keep left and bottom edges fixed
        if (resizeType === 'top-right') {
            // Calculate new dimensions
            // Dragging right (positive deltaX) = expand width
            // Dragging left (negative deltaX) = shrink width
            // Dragging up (negative deltaY) = expand height
            // Dragging down (positive deltaY) = shrink height
            let newWidth = startWidth + deltaX;
            let newHeight = startHeight - deltaY;
            
            // Apply constraints
            const minWidth = parseInt(getComputedStyle(modal).minWidth) || 400;
            const minHeight = parseInt(getComputedStyle(modal).minHeight) || 300;
            const maxWidth = parseInt(getComputedStyle(modal).maxWidth) || window.innerWidth * 0.95;
            const maxHeight = parseInt(getComputedStyle(modal).maxHeight) || window.innerHeight * 0.95;
            
            newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));
            newHeight = Math.max(minHeight, Math.min(newHeight, maxHeight));
            
            // Apply the new size - left and bottom stay fixed automatically
            modal.style.width = newWidth + 'px';
            modal.style.height = newHeight + 'px';
            modal.style.left = '24px';
            modal.style.bottom = '0';
            modal.style.right = 'auto';
            modal.style.top = 'auto';
            
            return;
        }
        
        // Handle corner resize (bottom-left) - keep top and right edges fixed
        if (resizeType === 'both') {
            // Calculate new dimensions
            // Dragging right (positive deltaX) = expand width
            // Dragging left (negative deltaX) = shrink width
            // Dragging down (positive deltaY) = expand height
            // Dragging up (negative deltaY) = shrink height
            let newWidth = startWidth + deltaX;
            let newHeight = startHeight + deltaY;
            
            // Apply constraints
            const minWidth = parseInt(getComputedStyle(modal).minWidth) || 400;
            const minHeight = parseInt(getComputedStyle(modal).minHeight) || 300;
            const maxWidth = parseInt(getComputedStyle(modal).maxWidth) || window.innerWidth * 0.95;
            const maxHeight = parseInt(getComputedStyle(modal).maxHeight) || window.innerHeight * 0.95;
            
            newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));
            newHeight = Math.max(minHeight, Math.min(newHeight, maxHeight));
            
            // Apply the new size - left and bottom stay fixed automatically
            modal.style.width = newWidth + 'px';
            modal.style.height = newHeight + 'px';
            modal.style.left = '24px';
            modal.style.bottom = '0';
            modal.style.right = 'auto';
            modal.style.top = 'auto';
            
            return;
        }
        
        // Handle width resize (right edge) - keep left edge fixed
        if (resizeType === 'width') {
            let newWidth = startWidth + deltaX; // Add because we're resizing from left
            const minWidth = parseInt(getComputedStyle(modal).minWidth) || 400;
            const maxWidth = parseInt(getComputedStyle(modal).maxWidth) || window.innerWidth * 0.95;
            newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));
            modal.style.width = newWidth + 'px';
            modal.style.left = '24px'; // Keep left fixed
        }
        
        // Handle height resize (bottom edge) - keep bottom edge fixed
        if (resizeType === 'height') {
            let newHeight = startHeight + deltaY; // Add because we're resizing from bottom
            const minHeight = parseInt(getComputedStyle(modal).minHeight) || 300;
            const maxHeight = parseInt(getComputedStyle(modal).maxHeight) || window.innerHeight * 0.95;
            newHeight = Math.max(minHeight, Math.min(newHeight, maxHeight));
            modal.style.height = newHeight + 'px';
            modal.style.bottom = '0'; // Keep bottom fixed
        }
    }
    
    function stopResize() {
        if (!isResizing) return;
        
        isResizing = false;
        modal.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        
        if (resizeBottom) resizeBottom.classList.remove('dragging');
        if (resizeCorner) resizeCorner.classList.remove('dragging');
        if (resizeTopRight) resizeTopRight.classList.remove('dragging');
        if (resizeRight) resizeRight.classList.remove('dragging');
        
        // Save size to localStorage
        localStorage.setItem('composeModalWidth', modal.offsetWidth);
        localStorage.setItem('composeModalHeight', modal.offsetHeight);
    }
    
    // Add event listeners for resize handles (top-right, bottom, bottom-left corner, and right edge)
    if (resizeBottom) {
        resizeBottom.addEventListener('mousedown', (e) => startResize(e, 'height'));
    }
    
    if (resizeCorner) {
        resizeCorner.addEventListener('mousedown', (e) => startResize(e, 'both'));
    }
    
    if (resizeTopRight) {
        resizeTopRight.addEventListener('mousedown', (e) => startResize(e, 'top-right'));
    }
    
    if (resizeRight) {
        resizeRight.addEventListener('mousedown', (e) => startResize(e, 'width'));
    }
    
    // Modal header is not draggable - modal stays locked to left side
    
    document.addEventListener('mousemove', handleResize);
    document.addEventListener('mouseup', stopResize);
    document.addEventListener('mouseleave', stopResize);
}

// Helper function to check if emails have changed
function emailsHaveChanged(newEmails) {
    const currentEmails = document.querySelectorAll('.email-item');
    if (currentEmails.length !== newEmails.length) return true;
    
    return newEmails.some((email, index) => {
        const currentEmail = currentEmails[index];
        return !currentEmail || currentEmail.getAttribute('data-email-id') !== email.id;
    });
}

// Add this new function for AI help with new messages
async function checkForAIHelp() {
    // Prevent auto-refreshes from resetting category
    if (refreshTimeout) {
        clearTimeout(refreshTimeout);
    }
    
    const bodyField = document.getElementById('compose-body');
    const text = bodyField.value;
    
    if (text.toLowerCase().startsWith('help:')) {
        const prompt = text.substring(5).trim();
        const aiSection = document.querySelector('.ai-suggestions');
        
        aiSection.innerHTML = `
            <h3>AI Suggestions</h3>
            <div class="suggestion-box" onclick="useAISuggestion(1)">
                <h4>Suggestion</h4>
                <div id="ai-suggestion-1">Generating...</div>
            </div>
        `;
        
        try {
            // Use secure server endpoint instead of direct OpenAI API call
            const response = await fetch('/api/generate-email', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    prompt: prompt
                })
            });

            if (!response.ok) {
                throw new Error('Server error');
            }

            const data = await response.json();
            document.getElementById('ai-suggestion-1').textContent = 
                data.response || 'Error generating suggestion. Please try again.';
        } catch (error) {
            console.error('Error getting AI help:', error);
            document.getElementById('ai-suggestion-1').textContent = 
                'Error generating suggestion. Please try again.';
        }
    }
}

// Add event listener for AI help
document.getElementById('compose-body').addEventListener('input', debounce(checkForAIHelp, 1000));

// Debounce helper function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

async function generateAIEmail() {
    try {
        DEBUG("Starting email generation");
        // Show the AI chat panel if it's not already visible
        document.getElementById('ai-chat-panel').style.display = 'block';
        
        // Get chat input and messages
        const chatInput = document.getElementById('chat-input');
        const messagesContainer = document.getElementById('chat-messages');
        
        if (!chatInput || !messagesContainer) {
            DEBUG("ERROR: Chat elements not found");
            throw new Error("Chat interface elements not found");
        }
        
        // Display "thinking" message 
        messagesContainer.innerHTML += `
            <div class="chat-message user">
                ${escapeHtml(chatInput.value)}
            </div>
            <div class="chat-message ai" id="loading-message">
                <em>Generating your email...</em>
            </div>
        `;
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        // Create a specific prompt for email generation
        const userMessage = `Write me an email about: ${chatInput.value}`;
        
        // Create history array with system prompt
        const emailHistory = [
            {
                role: "system",
                content: "You are an email writing assistant. Create complete, professional emails with proper structure including subject line, greeting, body and closing. Format the subject line as 'Subject: Your Subject Here'."
            }
        ];
        
        DEBUG("Sending request to server API for email generation");
        
        // Use the server's chat endpoint 
        // Get AI tone preference, length, context awareness, and signature from localStorage
        const aiTone = localStorage.getItem('aiTone') || 'professional';
        const aiLength = localStorage.getItem('aiLength') || 'medium';
        const aiContextAwareness = localStorage.getItem('aiContextAwareness') || 'on';
        const aiSignature = localStorage.getItem('aiSignature') || '';
        
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: userMessage,
                history: emailHistory,
                timestamp: new Date().toISOString(),
                tone: aiTone,
                length: aiLength,
                contextAwareness: aiContextAwareness,
                signature: aiSignature
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            DEBUG("Server API error", { status: response.status, error: errorText });
            throw new Error(`Server error: ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.response) {
            DEBUG("Invalid response format from server", data);
            throw new Error("Invalid response from server");
        }
        
        // Get the generated content
        const generatedEmail = data.response;
        DEBUG("Email generation successful", { 
            length: generatedEmail.length,
            preview: generatedEmail.substring(0, 100) + "..."
        });
        
        // Remove the loading message
        const loadingMessage = document.getElementById('loading-message');
        if (loadingMessage) {
            loadingMessage.remove();
        }
        
        // Store email content globally
        window.lastGeneratedEmail = generatedEmail;
        window.awaitingEmailConfirmation = true;
        
        // Show the generated email with confirmation prompt
        messagesContainer.innerHTML += `
            <div class="chat-message ai">
                ${formatEmailContent(generatedEmail)}
            </div>
            <div class="chat-message ai confirmation-prompt" style="margin-top: 10px; color: #1a73e8; font-weight: bold;">
                Would you like me to move this email to the compose area? (Yes/No)
            </div>
        `;
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        // Clear the chat input
        chatInput.value = '';
        
        return generatedEmail;
    } catch (error) {
        DEBUG("Error generating email", error);
        console.error('Error generating email:', error);
        
        // Display error message
        const messagesContainer = document.getElementById('chat-messages');
        const loadingMessage = document.getElementById('loading-message');
        
        if (loadingMessage) {
            loadingMessage.remove();
        }
        
        if (messagesContainer) {
            messagesContainer.innerHTML += `
                <div class="chat-message ai error-message">
                    <p>Sorry, I couldn't generate your email. An error occurred:</p>
                    <p>${error.message || "Unknown error"}</p>
                    <p>You can try again or compose the email manually.</p>
                </div>
            `;
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        
        return null;
    }
}

function toggleAIChat() {
    const promptArea = document.getElementById('ai-prompt-area');
    const chatArea = document.getElementById('ai-chat-area');
    
    if (chatArea.style.display === 'none') {
        promptArea.style.display = 'none';
        chatArea.style.display = 'block';
    } else {
        promptArea.style.display = 'block';
        chatArea.style.display = 'none';
    }
}

function detectUserIntent(message) {
    // Common negative responses
    const negativePatterns = [
        /^(no|nah|nope)/i,
        /not (yet|now|really)/i,
        /make (some|a few|more) changes/i,
        /can you (change|modify|update|revise)/i,
        /let'?s (change|modify|update|revise)/i,
        /needs? (some|a few|more) changes/i
    ];

    for (const pattern of negativePatterns) {
        if (pattern.test(message)) {
            return { type: 'chat', confidence: 'high' };
        }
    }

    // Natural language positive responses
    const positivePatterns = [
        // Direct yes variations
        /^(yes|yea|yeah|yup|sure|ok|okay)/i,
        
        // Positive phrases with "fine"
        /(that'?s |it'?s |looks |seems )?(fine|good|great|perfect)( to me| with me)?/i,
        
        // Approval phrases
        /i like it/i,
        /works? for me/i,
        /go (ahead|for it)/i,
        /move it/i,
        /use (it|that|this)/i,
        
        // Positive with modifications
        /yes,? but/i,
        /yeah,? that/i,
        /fine,? just/i
    ];

    for (const pattern of positivePatterns) {
        if (pattern.test(message)) {
            // If the message contains any modifiers or conditions, treat as chat
            if (message.includes('if') || 
                message.includes('but') || 
                message.includes('maybe') || 
                message.includes('could') ||
                message.includes('should')) {
                return { type: 'chat', confidence: 'high' };
            }
            return { type: 'confirm', action: 'move', confidence: 'high' };
        }
    }

    // Default to chat for any other responses
    return { type: 'chat', confidence: 'high' };
}

function handleConfirmedAction(action, messagesContainer) {
    if (action === 'move') {
        // Get all message elements
        const messageElements = messagesContainer.querySelectorAll('.chat-message');
        const messages = Array.from(messageElements).map(el => ({
            role: el.classList.contains('ai') ? 'assistant' : 'user',
            content: el.textContent.trim()
        }));
        
        // First move the content
        const success = moveLastAIMessageToCompose(messages);
        
        // Only show confirmation if we successfully moved content
        if (success) {
            messagesContainer.innerHTML += `
                <div class="chat-message ai">
                    I've moved the response to the compose area. Let me know if you need any changes!
                </div>
            `;
        } else {
            messagesContainer.innerHTML += `
                <div class="chat-message ai">
                    I couldn't find the last response to move. Would you like me to generate a new one?
                </div>
            `;
        }
    }
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function performSearch() {
    const query = document.getElementById('search-input').value.trim();
    if (!query) {
        alert('Please enter a search query');
        return;
    }

    let prefix = '';
    switch (currentFilter) {
        case 'starred':
            prefix = 'is:starred';
            break;
        case 'important':
            prefix = 'is:important';
            break;
        case 'sent':
            prefix = 'in:sent';
            break;
        default:
            prefix = `category:${currentFilter}`;
    }

    const searchQuery = `${prefix} ${query}`.trim();
    console.log(`Current Filter: ${currentFilter}`);
    console.log(`Search Query: ${searchQuery}`);

    try {
        console.log(`Searching emails with query: ${searchQuery}`);

        // Show loading state
        document.getElementById('emailList').innerHTML = `
            <div style="text-align: center; padding: 20px;">
                <p>Searching emails...</p>
            </div>
        `;

        // Reset page and get initial count
        currentPage = 1;

        // Perform search using the query
        const response = await gapi.client.gmail.users.messages.list({
            userId: 'me',
            maxResults: EMAILS_PER_PAGE,
            q: searchQuery
        });

        if (!response.result.messages || response.result.messages.length === 0) {
            displayEmails({ messages: [], resultSizeEstimate: 0 });
            return;
        }

        // Fetch metadata for each matching message in the same shape used by listEmails
        const messages = await Promise.all(
            response.result.messages.map(async (message) => {
            const emailDetails = await gapi.client.gmail.users.messages.get({
                    userId: 'me',
                    id: message.id,
                    format: 'metadata',
                    metadataHeaders: ['Subject', 'From', 'Date']
                });
                return emailDetails.result; // full Gmail message object
            })
        );

        const emailsForDisplay = {
            messages,
            nextPageToken: null,
            resultSizeEstimate: response.result.resultSizeEstimate || messages.length
        };

        displayEmails(emailsForDisplay);

    } catch (error) {
        console.error('Error performing search:', error);
        document.getElementById('emailList').innerHTML = `
            <div style="text-align: center; padding: 20px; color: #d93025;">
                <p>Error searching emails. Please try again.</p>
            </div>
        `;
    }
}

// Gmail-style search suggestions (based on currently visible emails in the list)
function clearSearchSuggestions() {
    const container = document.getElementById('search-suggestions');
    if (!container) return;
    container.innerHTML = '';
    container.style.display = 'none';
    searchSuggestionIndex = -1;
}

function updateSearchSuggestions(term) {
    const container = document.getElementById('search-suggestions');
    if (!container) return;

    const query = (term || '').trim().toLowerCase();

    if (!query) {
        clearSearchSuggestions();
        return;
    }

    const matches = [];

    // Prefer using the global search index of recent emails if available
    const sourceEmails = searchIndexLoaded && Array.isArray(searchIndexEmails) && searchIndexEmails.length
        ? searchIndexEmails
        : null;

    if (sourceEmails) {
        for (let i = 0; i < sourceEmails.length && matches.length < 5; i++) {
            const e = sourceEmails[i];
            const fromLower = (e.from || '').toLowerCase();
            const subjectLower = (e.subject || '').toLowerCase();
            const snippetLower = (e.snippet || '').toLowerCase();

            const haystack = `${fromLower} ${subjectLower} ${snippetLower}`;

            if (haystack.includes(query)) {
                matches.push({
                    id: e.id,
                    from: e.from,
                    subject: e.subject,
                    snippet: e.snippet
                });
            }
        }
    } else {
        // Fallback: search only within currently visible emails in the list
        const emailElements = Array.from(document.querySelectorAll('#emailList .email-item'));
        for (const el of emailElements) {
            const id = el.getAttribute('data-id') || (el.id ? el.id.replace(/^email-/, '') : '');
            const fromEl = el.querySelector('.email-sender');
            const subjectEl = el.querySelector('.email-subject');
            const snippetEl = el.querySelector('.email-snippet');

            const from = fromEl ? fromEl.textContent.trim() : '';
            const subject = subjectEl ? subjectEl.textContent.trim() : '';
            const snippet = snippetEl ? snippetEl.textContent.trim() : '';

            const haystack = `${from} ${subject} ${snippet}`.toLowerCase();

            if (haystack.includes(query)) {
                matches.push({ id, from, subject, snippet });
                if (matches.length >= 5) break;
            }
        }
    }

    container.innerHTML = '';

    if (matches.length === 0) {
        clearSearchSuggestions();
        return;
    }

    matches.forEach((m, index) => {
        const item = document.createElement('div');
        item.className = 'search-suggestion-item';
        item.dataset.index = String(index);
        item.dataset.id = m.id || '';
        item.innerHTML = `
            <div class="search-suggestion-top">
                <span class="search-suggestion-subject">${m.subject || '(No subject)'}</span>
                <span class="search-suggestion-from">${m.from || ''}</span>
            </div>
            <div class="search-suggestion-snippet">
                ${m.snippet || ''}
            </div>
        `;

        // Use mousedown so it fires even if the input loses focus
        item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            clearSearchSuggestions();
            if (m.id) {
                openEmail(m.id);
            }
        });

        container.appendChild(item);
    });

    // Add a small footer so users know they can search for more results
    const footer = document.createElement('div');
    footer.className = 'search-suggestions-footer';
    footer.textContent = 'Showing top 5 recent matches. Press Enter or click Search to see more results.';
    container.appendChild(footer);

    container.style.display = 'block';
    searchSuggestionIndex = -1;
}

function handleSearchInput(event) {
    const value = event && event.target ? event.target.value : '';
    updateSearchSuggestions(value);
}

function handleSearchKeyDown(event) {
    const container = document.getElementById('search-suggestions');
    const items = container ? Array.from(container.querySelectorAll('.search-suggestion-item')) : [];

    if (event.key === 'Enter') {
        if (items.length > 0 && searchSuggestionIndex >= 0 && searchSuggestionIndex < items.length) {
            event.preventDefault();
            const activeItem = items[searchSuggestionIndex];
            const id = activeItem && activeItem.dataset.id;
            clearSearchSuggestions();
            if (id) {
                openEmail(id);
            } else {
                performSearch();
            }
        } else {
            // No active suggestion, just perform a full search
            performSearch();
        }
    } else if (event.key === 'ArrowDown') {
        if (items.length === 0) return;
        event.preventDefault();
        searchSuggestionIndex = (searchSuggestionIndex + 1) % items.length;
        items.forEach((el, idx) => el.classList.toggle('active', idx === searchSuggestionIndex));
    } else if (event.key === 'ArrowUp') {
        if (items.length === 0) return;
        event.preventDefault();
        searchSuggestionIndex = (searchSuggestionIndex - 1 + items.length) % items.length;
        items.forEach((el, idx) => el.classList.toggle('active', idx === searchSuggestionIndex));
    } else if (event.key === 'Escape') {
        clearSearchSuggestions();
    }
}

// Hide the search suggestions dropdown if the user clicks outside
document.addEventListener('click', (event) => {
    const searchBar = document.querySelector('.search-bar');
    const suggestions = document.getElementById('search-suggestions');
    if (!searchBar || !suggestions) return;

    const target = event.target;
    const clickedInsideSearch =
        searchBar.contains(target) || suggestions.contains(target);

    if (!clickedInsideSearch) {
        clearSearchSuggestions();
    }
});

async function toggleStar(emailId, isCurrentlyStarred) {
    try {
        const labelAction = isCurrentlyStarred ? 'remove' : 'add';
        
        // Update Gmail API
        await gapi.client.gmail.users.messages.modify({
            'userId': 'me',
            'id': emailId,
            'resource': {
                [`${labelAction}LabelIds`]: ['STARRED']
            }
        });

        // Update UI immediately
        const starElement = document.querySelector(`.email-item[data-id="${emailId}"] .email-star`);
        if (starElement) {
            if (isCurrentlyStarred) {
                starElement.innerHTML = '☆';
                starElement.onclick = () => toggleStar(emailId, false);
            } else {
                starElement.innerHTML = '<span class="gold-star">⭐</span>';
                starElement.onclick = () => toggleStar(emailId, true);
            }
        }

        console.log(`Email ${emailId} ${labelAction === 'add' ? 'starred' : 'unstarred'}`);
    } catch (error) {
        console.error('Error toggling star:', error);
        alert('Error updating star status. Please try again.');
    }
}

async function replyEmail(emailId) {
    DEBUG("Starting reply to email", emailId);
    
    // Open the compose modal immediately
    openComposeModal();

    // Show a loading indicator in the AI chatbox
    const messages = document.getElementById('chat-messages');
    messages.innerHTML = `
        <div class="chat-message ai">
            <em>Generating reply...</em>
        </div>
    `;
    messages.scrollTop = messages.scrollHeight;

    try {
        // Get the email data - GAPI doesn't support native Promise .catch, so we use try/catch
        let response;
        try {
            response = await gapi.client.gmail.users.messages.get({
                'userId': 'me',
                'id': emailId,
                'format': 'full'
            });
        } catch (apiError) {
            DEBUG("Error fetching email from Gmail API", apiError);
            throw new Error("Failed to fetch email: " + (apiError.message || "Unknown error"));
        }

        const email = response.result;
        const headers = email.payload.headers;

        // Extract email details
        const fromHeader = headers.find(header => header.name === 'From')?.value || '';
        const emailMatch = fromHeader.match(/<(.+?)>/) || fromHeader.match(/[\w.-]+@[\w.-]+\.\w+/);
        const replyToEmail = emailMatch ? emailMatch[1] || emailMatch[0] : '';

        const subject = headers.find(header => header.name === 'Subject')?.value || '(no subject)';
        const emailBody = getBody(email.payload);
        
        // Convert HTML email body to plain text for AI processing
        const plainTextBody = htmlToPlainText(emailBody);
        
        // Log all headers to help debug
        console.log('All headers from email:');
        headers.forEach(header => {
            console.log(`${header.name}: ${header.value}`);
        });

        // Try multiple header names to find the Message-ID
        let messageIdHeader = headers.find(header => header.name === 'Message-ID')?.value;
        if (!messageIdHeader) messageIdHeader = headers.find(header => header.name === 'Message-Id')?.value;
        if (!messageIdHeader) messageIdHeader = headers.find(header => header.name === 'message-id')?.value;
        if (!messageIdHeader) messageIdHeader = headers.find(header => header.name.toLowerCase() === 'message-id')?.value;

        console.log('Found Message-ID header:', messageIdHeader);
        
        DEBUG("Extracted email info for reply", { 
            to: replyToEmail, 
            subject: subject,
            bodyLength: emailBody?.length || 0,
            plainTextLength: plainTextBody?.length || 0,
            threadId: email.threadId,
            messageId: messageIdHeader
        });

        // Store original email details including threadId for proper threading
        window.replyToData = {
            from: replyToEmail,
            subject: subject,
            body: emailBody,
            threadId: email.threadId, // Store threadId for proper threading
            messageId: email.id, // Gmail's internal message ID
            originalMessageId: messageIdHeader || `<${email.id}@mail.gmail.com>` // Message-ID header or create a fallback
        };

        // Add debug of what we're actually storing
        console.log('Stored replyToData:', window.replyToData);

        // Update the compose modal with email details
        document.getElementById('compose-to').value = replyToEmail;
        document.getElementById('compose-subject').value = subject.startsWith('Re:') ? subject : `Re: ${subject}`;

        // Check if context awareness is enabled
        const aiContextAwareness = localStorage.getItem('aiContextAwareness') || 'on';
        let contentForAI = plainTextBody;
        
        // If context awareness is enabled, fetch the full thread history
        if (aiContextAwareness === 'on' && email.threadId) {
            try {
                DEBUG("Fetching thread history for context-aware reply", { threadId: email.threadId });
                
                const threadResponse = await gapi.client.gmail.users.threads.get({
                    'userId': 'me',
                    'id': email.threadId,
                    'format': 'full'
                });
                
                const thread = threadResponse.result;
                const threadMessages = thread.messages || [];
                
                DEBUG("Thread fetched", { messageCount: threadMessages.length });
                
                // Sort messages chronologically (oldest first) to show conversation flow
                threadMessages.sort((a, b) => {
                    const dateA = new Date(a.payload.headers.find(h => h.name === 'Date')?.value || 0);
                    const dateB = new Date(b.payload.headers.find(h => h.name === 'Date')?.value || 0);
                    return dateA - dateB;
                });
                
                // Build thread history string with all messages
                const threadParts = [];
                threadMessages.forEach((msg, index) => {
                    const msgHeaders = msg.payload.headers;
                    const from = msgHeaders.find(h => h.name === 'From')?.value || 'Unknown';
                    const date = msgHeaders.find(h => h.name === 'Date')?.value || '';
                    const msgSubject = msgHeaders.find(h => h.name === 'Subject')?.value || '';
                    const msgBody = getBody(msg.payload);
                    const plainText = htmlToPlainText(msgBody);
                    
                    // Extract sender name (remove email address)
                    const senderMatch = from.match(/^"?([^"<]+)"?\s*(?:<.*>)?$/);
                    const senderName = senderMatch ? senderMatch[1].trim() : from;
                    
                    threadParts.push(`--- Message ${index + 1} ---\nFrom: ${senderName}\nDate: ${date}\nSubject: ${msgSubject}\n\n${plainText.trim()}`);
                });
                
                contentForAI = `EMAIL THREAD HISTORY:\n\n${threadParts.join('\n\n---\n\n')}\n\n--- END OF THREAD ---\n\nPlease generate a reply to the most recent message in this thread.`;
                
                DEBUG("Thread history built", { 
                    totalLength: contentForAI.length,
                    messageCount: threadMessages.length 
                });
            } catch (error) {
                console.warn('Error fetching thread history, using single email:', error);
                DEBUG("Thread fetch failed, falling back to single email", error);
                // Fall back to single email if thread fetch fails
                contentForAI = plainTextBody;
            }
        }

        // Generate AI response using thread history if available, or single email
        const aiResponse = await generateAIReply(contentForAI, email.threadId);
        DEBUG("AI response received", { responseLength: aiResponse?.length || 0 });

        // Store email content globally
        window.lastGeneratedEmail = aiResponse;
        window.awaitingEmailConfirmation = true;
        
        // Replace loading message with AI response and confirmation prompt
        messages.innerHTML = `
            <div class="chat-message ai">
                ${formatEmailContent(aiResponse)}
            </div>
            <div class="chat-message ai confirmation-prompt" style="margin-top: 10px; color: #1a73e8; font-weight: bold;">
                Would you like me to move this reply to the compose area? (Yes/No)
            </div>
        `;
        messages.scrollTop = messages.scrollHeight;

    } catch (error) {
        DEBUG("Error in replyEmail function", error);
        console.error('Error preparing reply:', error);
        
        messages.innerHTML = `
            <div class="chat-message ai">
                Sorry, I encountered an error while generating a reply: ${error.message || "Unknown error"}
                
                You can try again or compose a reply manually.
            </div>
        `;
        messages.scrollTop = messages.scrollHeight;
    }
}

// Function to convert HTML to plain text
function htmlToPlainText(html) {
    if (!html) return '';
    
    // If it's already plain text (no HTML tags), return as is
    if (!html.includes('<')) {
        return html.trim();
    }
    
    try {
        // Create a temporary DOM element to parse HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        
        // Replace block-level elements with newlines before getting text
        const blockElements = ['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'tr'];
        blockElements.forEach(tag => {
            tempDiv.querySelectorAll(tag).forEach(el => {
                if (tag === 'br') {
                    el.replaceWith('\n');
                } else {
                    el.insertAdjacentText('afterend', '\n');
                }
            });
        });
        
        // Get text content
        let text = tempDiv.textContent || tempDiv.innerText || '';
        
        // Decode HTML entities that might still be present
        const textArea = document.createElement('textarea');
        textArea.innerHTML = text;
        text = textArea.value;
        
        // Clean up multiple consecutive whitespace and newlines
        text = text.replace(/[ \t]+/g, ' '); // Multiple spaces to single space
        text = text.replace(/\n{3,}/g, '\n\n'); // Multiple newlines to double newline
        text = text.replace(/[ \t]+\n/g, '\n'); // Spaces before newlines
        text = text.replace(/\n[ \t]+/g, '\n'); // Spaces after newlines
        
        // Trim whitespace
        text = text.trim();
        
        return text;
    } catch (error) {
        console.error('Error converting HTML to plain text:', error);
        // Fallback: simple regex-based stripping
        return html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }
}

// Function to extract email body content
function getBody(payload) {
    if (!payload) return '';

    try {
    let content = '';

        // Handle multipart messages
    if (payload.parts) {
            // First try to find HTML part
        for (let part of payload.parts) {
                if (part.mimeType === 'text/html' && part.body && part.body.data) {
                    const htmlContent = decodeEmailContent(part.body.data);
                    console.log('Found HTML part, length:', htmlContent.length);
                    return htmlContent;
                }
            }
            
            // If no HTML, look for plain text
        for (let part of payload.parts) {
            if (part.mimeType === 'text/plain' && part.body && part.body.data) {
                    content = decodeEmailContent(part.body.data);
                    console.log('Found plain text part, length:', content.length);
                    break;
            }
            }
            
            // If still no content, recursively check nested parts
            if (!content) {
                for (let part of payload.parts) {
            if (part.parts) {
                        content = getBody(part);
                        if (content) {
                            console.log('Found content in nested parts, length:', content.length);
                            break;
                        }
            }
        }
            }
        } 
        // Handle single part messages
        else if (payload.body && payload.body.data) {
            content = decodeEmailContent(payload.body.data);
        }

        return content || 'No content available';
    } catch (error) {
        console.error('Error extracting email body:', error);
        return 'Error extracting email content';
    }
}

// Helper function to decode email content
function decodeEmailContent(data) {
    try {
        // Replace special characters that come from base64url encoding
        const text = data.replace(/-/g, '+').replace(/_/g, '/');
        
        // Decode base64
        const decoded = atob(text);
        
        // Handle UTF-8 encoding
        let htmlContent;
        try {
            htmlContent = decodeURIComponent(escape(decoded));
        } catch (e) {
            // Fallback if UTF-8 decoding fails
            htmlContent = decoded;
        }
        
        // Basic HTML sanitization:
        // - strip scripts
        // - strip inline event handlers
        // - strip javascript: URLs (but preserve data:image/*;base64)
        // - strip color-scheme and color-related meta tags
        // Layout and sizing are handled via CSS instead of rewriting tags here.
        let sanitized = htmlContent
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/on\w+="[^"]*"/gi, '')
            .replace(/on\w+='[^']*'/gi, '')
            // Only strip javascript: URLs, preserve data:image/*;base64
            .replace(/javascript:/gi, '');
        
        // Strip color-scheme and dark mode meta tags
        sanitized = sanitized
            .replace(/<meta[^>]*name=["']color-scheme["'][^>]*>/gi, '')
            .replace(/<meta[^>]*name=["']theme-color["'][^>]*>/gi, '')
            .replace(/<meta[^>]*name=["']prefers-color-scheme["'][^>]*>/gi, '')
            .replace(/<meta[^>]*content=["'][^"]*color-scheme[^"]*["'][^>]*>/gi, '');
        
        // Strip color-scheme from HTML/body/style tags
        sanitized = sanitized
            .replace(/<html[^>]*color-scheme[^>]*>/gi, (match) => match.replace(/\s*color-scheme\s*=\s*["'][^"']*["']/gi, ''))
            .replace(/<body[^>]*color-scheme[^>]*>/gi, (match) => match.replace(/\s*color-scheme\s*=\s*["'][^"']*["']/gi, ''));
        
        // Debug: Log if we have HTML content
        if (sanitized.includes('<')) {
            console.log('Decoded HTML content detected, length:', sanitized.length);
        }
        
        return sanitized;
    } catch (error) {
        console.error('Error decoding email content:', error);
        return 'Error decoding email content';
    }
}

// Function to extract attachments from email payload
function getAttachments(payload, messageId) {
    const attachments = [];
    
    if (!payload) return attachments;
    
    function extractFromParts(parts, messageId) {
        if (!parts) return;
        
        for (const part of parts) {
            // Check if this part is an attachment
            if (part.filename && part.body && part.body.attachmentId) {
                attachments.push({
                    attachmentId: part.body.attachmentId,
                    filename: part.filename,
                    mimeType: part.mimeType || 'application/octet-stream',
                    size: part.body.size || 0
                });
            }
            
            // Recursively check nested parts
            if (part.parts) {
                extractFromParts(part.parts, messageId);
            }
        }
    }
    
    if (payload.parts) {
        extractFromParts(payload.parts, messageId);
    } else if (payload.filename && payload.body && payload.body.attachmentId) {
        // Single attachment
        attachments.push({
            attachmentId: payload.body.attachmentId,
            filename: payload.filename,
            mimeType: payload.mimeType || 'application/octet-stream',
            size: payload.body.size || 0
        });
    }
    
    return attachments;
}

// Function to extract inline attachments (CID attachments) from email payload
async function getInlineAttachments(payload, messageId) {
    const inlineAttachments = new Map(); // Map of CID -> attachment data
    
    if (!payload) return inlineAttachments;
    
    async function extractFromParts(parts, messageId) {
        if (!parts) return;
        
        for (const part of parts) {
            // Check if this part has a Content-ID header (inline attachment)
            const headers = part.headers || [];
            const contentIdHeader = headers.find(h => h.name && h.name.toLowerCase() === 'content-id');
            const contentDispositionHeader = headers.find(h => h.name && h.name.toLowerCase() === 'content-disposition');
            
            // Check if it's an image or inline attachment
            const isImage = part.mimeType && part.mimeType.startsWith('image/');
            const hasContentId = contentIdHeader && contentIdHeader.value;
            const isInlineDisposition = contentDispositionHeader && contentDispositionHeader.value && 
                                      contentDispositionHeader.value.toLowerCase().includes('inline');
            const hasNoDisposition = !contentDispositionHeader || !contentDispositionHeader.value;
            
            // Consider it inline if:
            // 1. Has Content-ID header, OR
            // 2. Is an image with inline disposition, OR
            // 3. Is an image with no disposition (often inline in multipart/related)
            const isInline = hasContentId || (isImage && (isInlineDisposition || hasNoDisposition));
            
            if (isInline && part.body) {
                let cid = null;
                
                // Extract CID from Content-ID header (format: <cid-value>)
                if (contentIdHeader && contentIdHeader.value) {
                    cid = contentIdHeader.value.trim();
                    // Remove angle brackets if present
                    cid = cid.replace(/^<|>$/g, '');
                    console.log('Found Content-ID:', cid, 'MIME type:', part.mimeType);
                }
                
                // If no CID but has attachmentId, use it as fallback
                if (!cid && part.body.attachmentId) {
                    cid = part.body.attachmentId;
                    console.log('Using attachmentId as CID fallback:', cid);
                }
                
                // If still no CID but it's an image, generate one from attachmentId
                if (!cid && isImage && part.body.attachmentId) {
                    cid = part.body.attachmentId;
                }
                
                if (cid) {
                    let blobUrl = null;
                    
                    // Try to get attachment data
                    if (part.body.attachmentId) {
                        // Fetch the attachment data
                        try {
                            const response = await gapi.client.gmail.users.messages.attachments.get({
                                'userId': 'me',
                                'messageId': messageId,
                                'id': part.body.attachmentId
                            });
                            
                            const attachment = response.result;
                            const data = attachment.data;
                            
                            // Decode base64url to base64
                            const base64Data = data.replace(/-/g, '+').replace(/_/g, '/');
                            
                            // Convert to blob URL
                            const byteCharacters = atob(base64Data);
                            const byteNumbers = new Array(byteCharacters.length);
                            for (let i = 0; i < byteCharacters.length; i++) {
                                byteNumbers[i] = byteCharacters.charCodeAt(i);
                            }
                            const byteArray = new Uint8Array(byteNumbers);
                            const blob = new Blob([byteArray], { type: part.mimeType || 'application/octet-stream' });
                            blobUrl = URL.createObjectURL(blob);
                            
                            // Track blob URL for cleanup
                            currentEmailBlobUrls.push(blobUrl);
                            
                            console.log(`Created blob URL for CID: ${cid}, MIME: ${part.mimeType}`);
                        } catch (error) {
                            console.error('Error fetching inline attachment:', error, 'CID:', cid);
                        }
                    } else if (part.body.data) {
                        // Inline attachment with embedded data (base64)
                        try {
                            const base64Data = part.body.data.replace(/-/g, '+').replace(/_/g, '/');
                            const byteCharacters = atob(base64Data);
                            const byteNumbers = new Array(byteCharacters.length);
                            for (let i = 0; i < byteCharacters.length; i++) {
                                byteNumbers[i] = byteCharacters.charCodeAt(i);
                            }
                            const byteArray = new Uint8Array(byteNumbers);
                            const blob = new Blob([byteArray], { type: part.mimeType || 'application/octet-stream' });
                            blobUrl = URL.createObjectURL(blob);
                            
                            // Track blob URL for cleanup
                            currentEmailBlobUrls.push(blobUrl);
                            
                            console.log(`Created blob URL from embedded data for CID: ${cid}`);
                        } catch (error) {
                            console.error('Error processing inline attachment data:', error, 'CID:', cid);
                        }
                    }
                    
                    if (blobUrl) {
                        inlineAttachments.set(cid, {
                            blobUrl: blobUrl,
                            mimeType: part.mimeType || 'application/octet-stream',
                            attachmentId: part.body.attachmentId || null
                        });
                        
                        // Also add variations of the CID for better matching
                        // Add with angle brackets
                        if (!cid.startsWith('<')) {
                            inlineAttachments.set(`<${cid}>`, {
                                blobUrl: blobUrl,
                                mimeType: part.mimeType || 'application/octet-stream',
                                attachmentId: part.body.attachmentId || null
                            });
                        }
                        // Add without angle brackets if it had them
                        if (cid.startsWith('<')) {
                            const cleanCid = cid.replace(/^<|>$/g, '');
                            inlineAttachments.set(cleanCid, {
                                blobUrl: blobUrl,
                                mimeType: part.mimeType || 'application/octet-stream',
                                attachmentId: part.body.attachmentId || null
                            });
                        }
                    }
                }
            }
            
            // Recursively check nested parts
            if (part.parts) {
                await extractFromParts(part.parts, messageId);
            }
        }
    }
    
    if (payload.parts) {
        await extractFromParts(payload.parts, messageId);
    }
    
    console.log(`Total inline attachments found: ${inlineAttachments.size}`, Array.from(inlineAttachments.keys()));
    return inlineAttachments;
}

// Function to process HTML content and replace CID references with blob URLs
function processEmailImages(htmlContent, inlineAttachments) {
    if (!htmlContent || typeof htmlContent !== 'string') {
        return htmlContent;
    }
    
    // If no inline attachments, return content as-is (but still process for safety)
    if (!inlineAttachments || inlineAttachments.size === 0) {
        return htmlContent;
    }
    
    // Create a temporary DOM element to parse HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlContent;
    
    // Find all img tags
    const images = tempDiv.querySelectorAll('img');
    
    images.forEach((img, idx) => {
        const src = img.getAttribute('src');
        if (!src) {
            console.warn(`Image ${idx + 1} has no src attribute`);
            return;
        }
        
        // Handle CID references (cid:XXXX or cid:XXXX@domain)
        if (src.toLowerCase().startsWith('cid:')) {
            // Extract CID value (remove 'cid:' prefix and any @domain part)
            const cidMatch = src.match(/^cid:(.+?)(?:@.*)?$/i);
            if (cidMatch) {
                let cid = cidMatch[1].trim();
                const originalCid = cid;
                
                // Try exact match first
                let attachment = inlineAttachments.get(cid);
                
                // If no exact match, try without angle brackets (some emails have <cid> format)
                if (!attachment) {
                    const cleanCid = cid.replace(/^<|>$/g, '');
                    attachment = inlineAttachments.get(cleanCid);
                    if (attachment) cid = cleanCid;
                }
                
                // Try with angle brackets if it didn't have them
                if (!attachment && !cid.startsWith('<')) {
                    attachment = inlineAttachments.get(`<${cid}>`);
                    if (attachment) cid = `<${cid}>`;
                }
                
                // Try case-insensitive match
                if (!attachment) {
                    for (const [key, value] of inlineAttachments.entries()) {
                        if (key.toLowerCase() === originalCid.toLowerCase()) {
                            attachment = value;
                            cid = key;
                            break;
                        }
                    }
                }
                
                // Try partial match (in case CID has extra characters)
                if (!attachment) {
                    for (const [key, value] of inlineAttachments.entries()) {
                        const cleanKey = key.replace(/^<|>$/g, '').toLowerCase();
                        const cleanOriginal = originalCid.replace(/^<|>$/g, '').toLowerCase();
                        if (cleanKey === cleanOriginal || cleanKey.includes(cleanOriginal) || cleanOriginal.includes(cleanKey)) {
                            attachment = value;
                            cid = key;
                            break;
                        }
                    }
                }
                
                if (attachment && attachment.blobUrl) {
                    // Set up error handler in case blob URL fails
                    img.onerror = function() {
                        console.error(`Failed to load blob URL for CID: ${originalCid}`);
                        // Try to reload once
                        setTimeout(() => {
                            if (this.src === attachment.blobUrl) {
                                this.src = attachment.blobUrl + '?retry=' + Date.now();
                            }
                        }, 100);
                    };
                    img.onload = function() {
                        console.log(`✓ Successfully loaded image for CID: ${originalCid}`);
                    };
                    img.src = attachment.blobUrl;
                    console.log(`✓ Replaced CID "${originalCid}" (matched as "${cid}") with blob URL`);
                } else {
                    console.warn(`✗ No attachment found for CID: "${originalCid}". Available CIDs:`, Array.from(inlineAttachments.keys()));
                    // Try to find similar CIDs for debugging
                    const similarCids = Array.from(inlineAttachments.keys()).filter(k => 
                        k.toLowerCase().includes(originalCid.toLowerCase()) || 
                        originalCid.toLowerCase().includes(k.toLowerCase())
                    );
                    if (similarCids.length > 0) {
                        console.warn(`  Similar CIDs found:`, similarCids);
                    }
                    // Mark as failed but keep visible for debugging
                    img.alt = `Image not found (CID: ${originalCid})`;
                    img.title = `CID not found: ${originalCid}`;
                    // Add a class to style broken CID images
                    img.classList.add('cid-image-missing');
                }
            } else {
                console.warn(`Could not parse CID from src: ${src}`);
            }
        } else if (src.startsWith('data:image')) {
            console.log(`Image ${idx + 1} uses base64 data URI (preserved)`);
        } else if (src.startsWith('http://') || src.startsWith('https://')) {
            console.log(`Image ${idx + 1} uses remote URL: ${src.substring(0, 50)}...`);
        } else {
            console.warn(`Image ${idx + 1} has unexpected src format: ${src.substring(0, 50)}`);
        }
    });
    
    // Also check for CID references in CSS background-image and other attributes
    // This handles cases where images are embedded in style attributes
    const allElements = tempDiv.querySelectorAll('*');
    allElements.forEach(el => {
        // Check style attribute for background-image with CID
        const style = el.getAttribute('style');
        if (style && style.includes('cid:')) {
            const updatedStyle = style.replace(/cid:([^"'\s)]+)/gi, (match, cid) => {
                let attachment = inlineAttachments.get(cid.trim());
                if (!attachment) {
                    // Try without angle brackets
                    const cleanCid = cid.trim().replace(/^<|>$/g, '');
                    attachment = inlineAttachments.get(cleanCid);
                }
                if (!attachment) {
                    // Try case-insensitive
                    for (const [key, value] of inlineAttachments.entries()) {
                        if (key.toLowerCase() === cid.trim().toLowerCase()) {
                            attachment = value;
                            break;
                        }
                    }
                }
                return attachment && attachment.blobUrl ? attachment.blobUrl : match;
            });
            if (updatedStyle !== style) {
                el.setAttribute('style', updatedStyle);
            }
        }
    });
    
    return tempDiv.innerHTML;
}

// Function to download an attachment
async function downloadAttachment(messageId, attachmentId, filename, mimeType = 'application/octet-stream') {
    try {
        const response = await gapi.client.gmail.users.messages.attachments.get({
            'userId': 'me',
            'messageId': messageId,
            'id': attachmentId
        });
        
        const attachment = response.result;
        const data = attachment.data;
        
        // Decode base64url to base64
        const base64Data = data.replace(/-/g, '+').replace(/_/g, '/');
        
        // Convert base64 to blob with proper MIME type
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: mimeType });
        
        // Create download link
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Error downloading attachment:', error);
        alert('Error downloading attachment: ' + (error.message || 'Unknown error'));
    }
}

// Make function globally accessible
window.downloadAttachment = downloadAttachment;

async function generateAIReply(emailContent, threadId = null) {
    try {
        const isThreadHistory = emailContent.includes('EMAIL THREAD HISTORY:');
        DEBUG("Generating AI reply", { 
            bodyLength: emailContent?.length || 0,
            isThreadHistory: isThreadHistory,
            threadId: threadId
        });
        
        // Prepare system prompt - adjust based on whether we have thread history
        let systemPrompt = `You are an email assistant that generates professional replies.
Write complete email responses with proper structure:
1. Start with an appropriate greeting
2. Include 2-3 paragraphs that directly address the email content`;

        if (isThreadHistory) {
            systemPrompt += `
3. Reference previous messages in the thread when relevant to maintain context
4. Acknowledge any questions or points from earlier in the conversation
5. Keep the reply focused on the most recent message but show awareness of the thread history`;
        } else {
            systemPrompt += `
3. Address the specific points raised in the email`;
        }
        
        systemPrompt += `
4. End with a professional closing (like "Best regards," or "Sincerely,")
5. Don't ask questions about what to include - just create a complete reply`;

        // Truncate content if too long (increase limit for thread history)
        const maxLength = isThreadHistory ? 4000 : 1500;
        const truncatedContent = emailContent.trim().substring(0, maxLength);
        
        // Add this as a conversation history item
        const replyHistory = [
            {
                role: "system",
                content: systemPrompt
            },
            {
                role: "user",
                content: isThreadHistory 
                    ? `Reply to this email thread:\n\n${truncatedContent}`
                    : `Reply to this email: ${truncatedContent}`
            }
        ];
        
        DEBUG("Sending request to server API", { 
            contentLength: truncatedContent.length,
            isThreadHistory: isThreadHistory
        });
        
        // Use the server's chat endpoint instead of calling OpenAI directly
        // Get AI tone preference, length, context awareness, and signature from localStorage
        const aiTone = localStorage.getItem('aiTone') || 'professional';
        const aiLength = localStorage.getItem('aiLength') || 'medium';
        const aiContextAwareness = localStorage.getItem('aiContextAwareness') || 'on';
        const aiSignature = localStorage.getItem('aiSignature') || '';
        
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: isThreadHistory 
                    ? `Reply to this email thread:\n\n${truncatedContent}`
                    : `Reply to this email: ${truncatedContent}`,
                history: replyHistory,
                timestamp: new Date().toISOString(),
                tone: aiTone,
                length: aiLength,
                contextAwareness: aiContextAwareness,
                signature: aiSignature
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            DEBUG("Server API error", { status: response.status, error: errorText });
            throw new Error(`Server error: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data.response) {
            DEBUG("Invalid response format from server", data);
            throw new Error("Invalid response from server");
        }
        
        const generatedReply = data.response;
        DEBUG("Generated reply success", { 
            length: generatedReply.length,
            preview: generatedReply.substring(0, 100) + "..."
        });
        
        return generatedReply;
    } catch (error) {
        DEBUG("Error generating AI reply", error);
        console.error('Error generating AI reply:', error);
        
        // Return a helpful error message that users will understand
        return `I apologize, but I encountered an error while generating a reply.

This might be due to:
- Network connectivity issues
- API rate limits
- Server configuration problems

You can try again or compose a reply manually.`;
    }
}

// Modify moveToCompose to use our hidden textarea instead
function moveToComposeSimple(text) {
    DEBUG("moveToComposeSimple called", { textLength: text?.length || 0 });
    
    // Use the primary moveToCompose implementation with default values
    const editableDiv = document.getElementById('compose-body');
    
    if (editableDiv) {
        // Call the main implementation 
        moveToCompose(text, '', '');
        
        // Make sure hidden textarea is updated
        updateHiddenTextarea();
    } else {
        DEBUG("ERROR: compose-body element not found!");
    }
}

/**
 * Escapes HTML to prevent XSS when displaying user input
 */
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function ensureTabsVisible() {
    const emailTabs = document.querySelector('.email-tabs');
    if (emailTabs) {
        emailTabs.style.display = 'flex'; // Ensure tabs are visible
    }
}

async function switchTab(category) {
    try {
        // Update UI to show loading state
        document.getElementById('emailList').innerHTML = '<div style="text-align: center; padding: 20px;">Loading...</div>';
        
        console.log("Switching to category:", category);
        
        // Clear active class from sub-nav-items first (but keep main nav-item for email categories)
        document.querySelectorAll('.sub-nav-item').forEach(item => {
            item.classList.remove('active');
        });
        
        // Clear active class from all email tabs
        document.querySelectorAll('.email-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        
        // Set active class on the correct email category tab
        const emailTabs = document.querySelectorAll('#email-tabs .email-tab');
        emailTabs.forEach(tab => {
            const tabText = tab.textContent.trim().toLowerCase();
            
            if ((category === 'primary' && tabText.includes('inbox')) ||
                (category === 'promotions' && tabText.includes('promotion')) ||
                (category === 'social' && tabText.includes('social')) ||
                (category === 'updates' && tabText.includes('update')) ||
                (category === 'starred' && tabText.includes('starred')) ||
                (category === 'important' && tabText.includes('important')) ||
                (category === 'sent' && tabText.includes('sent'))) {
                
                tab.classList.add('active');
                console.log("Set active class on tab:", tabText);
            }
        });
        
        // For main email categories (primary, promotions, social, updates), keep the main Inbox nav-item active
        if (['primary', 'promotions', 'social', 'updates'].includes(category)) {
            const inboxNavItem = document.querySelector('.nav-item[onclick*="switchSection"]');
            if (inboxNavItem) {
                inboxNavItem.classList.add('active');
            }
        } else if (['starred', 'important', 'sent', 'last12hours'].includes(category)) {
            // For sub-categories (starred, important, sent, last12hours), clear main nav-item and activate the corresponding sub-nav-item
            const inboxNavItem = document.querySelector('.nav-item[onclick*="switchSection"]');
            if (inboxNavItem) {
                inboxNavItem.classList.remove('active');
            }
            
            const sidebarItems = document.querySelectorAll('.sub-nav-item');
            sidebarItems.forEach(item => {
                const itemText = item.textContent.trim().toLowerCase();
                
                if (itemText.includes(category.toLowerCase()) || 
                    (category === 'last12hours' && itemText.includes('ai summary'))) {
                    item.classList.add('active');
                    console.log("Set active class on sidebar item:", itemText);
                }
            });
        }
        
        // Hide AI settings if visible
        const aiSettingsContainer = document.getElementById('ai-settings-container');
        if (aiSettingsContainer) {
            aiSettingsContainer.style.display = 'none';
        }
        
        // Hide Profile Settings if visible
        const profileSettingsContainer = document.getElementById('profile-settings-container');
        if (profileSettingsContainer) {
            profileSettingsContainer.style.display = 'none';
        }
        
        // Show email list container
        const emailListContainer = document.querySelector('.email-list-container');
        if (emailListContainer) {
            emailListContainer.style.display = 'flex';
        }
        
        // Show email list and tabs
        document.getElementById('emailList').style.display = 'block';
        
        // Hide category tabs for sub-tabs
        const emailTabsContainer = document.getElementById('email-tabs');
        if (['starred', 'important', 'sent', 'last12hours'].includes(category)) {
            emailTabsContainer.style.display = 'none';
        } else {
            emailTabsContainer.style.display = 'flex';
        }
        
        document.querySelector('.search-bar').style.display = 'flex';
        
        // Hide email viewer if open
        document.getElementById('email-viewer').style.display = 'none';
        
        // Special handling for AI Summary
        if (category === 'last12hours') {
            // Check if we have cached dashboard data
            if (cachedDashboardData) {
                displaySummaryDashboard(cachedDashboardData);
            } else {
                await generateLast12HoursSummary();
            }
            return;
        }
        
        // Load emails for the selected category
        const emails = await listEmails(1, category);
        
        // Display emails
        displayEmails(emails);
        
        // Update current filter
        currentFilter = category;
        
        // Reset pagination to page 1
        currentPage = 1;
        
        // Update URL with the current category
        const urlParams = new URLSearchParams(window.location.search);
        urlParams.set('category', category);
        const newUrl = `${window.location.pathname}?${urlParams.toString()}`;
        window.history.pushState({ path: newUrl }, '', newUrl);
        
    } catch (error) {
        console.error('Error switching tab:', error);
        document.getElementById('emailList').innerHTML = '<div style="text-align: center; padding: 20px;">Error loading emails. Please try again.</div>';
    }
}

// Generate comprehensive dashboard summary of emails from the last 12 hours
async function generateLast12HoursSummary() {
    try {
        const emailList = document.getElementById('emailList');
        
        // Show loading state
        emailList.innerHTML = `
            <div style="text-align: center; padding: 40px;">
                <div style="font-size: 18px; color: #5f6368; margin-bottom: 16px;">⚡ Generating Summary Dashboard...</div>
                <div style="color: #5f6368;">Analyzing emails from the last 12 hours</div>
            </div>
        `;
        
        // Fetch emails from the last 24 hours
        const query = 'newer_than:1d';
        const maxResults = 100;
        
        // Also fetch important emails separately to ensure we get them
        const importantQuery = 'newer_than:1d is:important';
        
        const [response, importantResponse] = await Promise.all([
            gapi.client.gmail.users.messages.list({
                userId: 'me',
                q: query,
                maxResults: maxResults
            }),
            gapi.client.gmail.users.messages.list({
                userId: 'me',
                q: importantQuery,
                maxResults: maxResults
            })
        ]);
        
        if (!response.result.messages || response.result.messages.length === 0) {
            displaySummaryDashboard({
                totalEmails: 0,
                importantEmails: 0,
                urgentEmails: 0,
                fromContacts: 0,
                emails: [],
                categories: {},
                aiDigest: ['No emails found in the last 24 hours.'],
                priorityEmails: [],
                recommendedActions: []
            });
            return;
        }
        
        const emailCount = response.result.messages.length;
        const importantEmailIds = new Set((importantResponse.result.messages || []).map(m => m.id));
        console.log(`Found ${emailCount} emails in the last 24 hours`);
        console.log(`Found ${importantEmailIds.size} important emails`);
        
        // Fetch full message details
        const messages = await Promise.all(
            response.result.messages.slice(0, 100).map(async (message) => {
                try {
                    const fullMessage = await gapi.client.gmail.users.messages.get({
                        userId: 'me',
                        id: message.id,
                        format: 'metadata',
                        metadataHeaders: ['From', 'Subject', 'Date']
                    });
                    return fullMessage.result;
                } catch (error) {
                    console.error('Error fetching message:', error);
                    return null;
                }
            })
        );
        
        // Filter out null results and process emails
        const validMessages = messages.filter(msg => msg !== null);
        const processedEmails = validMessages.map(msg => {
            const headers = msg.payload?.headers || [];
            const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
            const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
            const date = headers.find(h => h.name === 'Date')?.value || '';
            const snippet = msg.snippet || '';
            // labelIds should be at the top level of the message object
            const labelIds = msg.labelIds || [];
            
            // Debug: log labelIds for important emails
            if (labelIds.includes('IMPORTANT')) {
                console.log('Found IMPORTANT email:', {
                    id: msg.id,
                    subject: subject,
                    labelIds: labelIds
                });
            }
            
            // Extract email address from "From" field
            const emailMatch = from.match(/<(.+)>/);
            const emailAddress = emailMatch ? emailMatch[1] : from.toLowerCase();
            
            // Check both labelIds and the importantEmailIds set
            const isImportant = labelIds.includes('IMPORTANT') || importantEmailIds.has(msg.id);
            
            return {
                id: msg.id,
                from: from,
                fromEmail: emailAddress,
                fromName: from.replace(/<.+>/, '').trim() || emailAddress.split('@')[0],
                subject: subject,
                date: date,
                snippet: snippet.substring(0, 200),
                isImportant: isImportant,
                isStarred: labelIds.includes('STARRED'),
                isUnread: labelIds.includes('UNREAD'),
                labelIds: labelIds
            };
        });
        
        // Debug: log all processed emails with their important status
        console.log('Processed emails important status:', 
            processedEmails.map(e => ({ 
                subject: e.subject.substring(0, 30), 
                isImportant: e.isImportant, 
                labelIds: e.labelIds 
            }))
        );
        
        // Calculate metrics
        const importantEmails = processedEmails.filter(e => e.isImportant).length;
        console.log(`Total important emails found: ${importantEmails} out of ${processedEmails.length}`);
        const urgentEmails = processedEmails.filter(e => {
            // Consider urgent: important + unread, or emails with urgent keywords
            const urgentKeywords = ['urgent', 'asap', 'immediate', 'emergency', 'deadline'];
            const subjectLower = e.subject.toLowerCase();
            return e.isImportant && e.isUnread || urgentKeywords.some(kw => subjectLower.includes(kw));
        }).length;
        
        // Count emails from contacts (simplified: emails with names, not just addresses)
        const fromContacts = processedEmails.filter(e => {
            const fromName = e.fromName;
            return fromName && fromName !== e.fromEmail.split('@')[0] && !fromName.includes('noreply');
        }).length;
        
        // Categorize emails
        const categories = {
            work: 0,
            personal: 0,
            finance: 0,
            promotions: 0,
            other: 0
        };
        
        processedEmails.forEach(email => {
            const subjectLower = email.subject.toLowerCase();
            const fromLower = email.from.toLowerCase();
            
            if (fromLower.includes('promo') || fromLower.includes('deal') || subjectLower.includes('sale') || 
                subjectLower.includes('discount') || subjectLower.includes('offer')) {
                categories.promotions++;
            } else if (subjectLower.includes('invoice') || subjectLower.includes('payment') || 
                       subjectLower.includes('bank') || subjectLower.includes('transaction')) {
                categories.finance++;
            } else if (subjectLower.includes('meeting') || subjectLower.includes('project') || 
                       subjectLower.includes('work') || fromLower.includes('work')) {
                categories.work++;
            } else if (fromLower.includes('family') || fromLower.includes('friend') || 
                       subjectLower.includes('personal')) {
                categories.personal++;
            } else {
                categories.other++;
            }
        });
        
        // Get priority emails (top 5 important/unread)
        const priorityEmails = processedEmails
            .filter(e => e.isImportant || e.isUnread)
            .sort((a, b) => {
                // Sort by: important + unread first, then by date
                const aPriority = (a.isImportant ? 2 : 0) + (a.isUnread ? 1 : 0);
                const bPriority = (b.isImportant ? 2 : 0) + (b.isUnread ? 1 : 0);
                return bPriority - aPriority;
            })
            .slice(0, 5);
        
        // Generate AI digest
        const emailSummaries = processedEmails.slice(0, 30).map((email, index) => {
            return `${index + 1}. From: ${email.fromName}\n   Subject: ${email.subject}\n   Preview: ${email.snippet}`;
        }).join('\n\n');
        
        const aiTone = localStorage.getItem('aiTone') || 'professional';
        const aiLength = localStorage.getItem('aiLength') || 'medium';
        
        const digestPrompt = `Provide 3-6 concise bullet point summaries of these ${emailCount} emails from the last 24 hours. 
Focus on:
- Main themes or topics
- Important senders or conversations
- Action items or follow-ups needed
- Any urgent matters

Format as simple bullet points, one per line. Be concise and actionable.

Email list:
${emailSummaries.substring(0, 6000)}`;
        
        let aiDigest = [];
        try {
            const digestResponse = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: digestPrompt,
                    history: [{
                        role: 'system',
                        content: 'You are an email assistant. Provide concise bullet point summaries. Format as simple lines, one insight per line.'
                    }],
                    timestamp: new Date().toISOString(),
                    tone: aiTone,
                    length: 'short'
                })
            });
            
            if (digestResponse.ok) {
                const digestData = await digestResponse.json();
                const digestText = digestData.response || '';
                // Split into bullet points
                aiDigest = digestText.split('\n')
                    .filter(line => line.trim().length > 0)
                    .map(line => line.replace(/^[-•*]\s*/, '').trim())
                    .slice(0, 6);
            }
        } catch (error) {
            console.error('Error generating AI digest:', error);
            aiDigest = ['Analyzing email patterns...', 'Reviewing important conversations...'];
        }
        
        if (aiDigest.length === 0) {
            aiDigest = ['Most messages today were work and scheduling related.', '3 people followed up on unanswered emails.'];
        }
        
        // Generate AI summaries for priority emails
        const priorityWithSummaries = await Promise.all(priorityEmails.map(async (email) => {
            let aiSummary = email.snippet.substring(0, 100) + '...';
            
            try {
                const summaryResponse = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: `Provide a one-sentence summary of this email:\nSubject: ${email.subject}\nPreview: ${email.snippet}`,
                        history: [{
                            role: 'system',
                            content: 'Provide a concise one-sentence summary of the email content.'
                        }],
                        timestamp: new Date().toISOString(),
                        tone: aiTone,
                        length: 'short'
                    })
                });
                
                if (summaryResponse.ok) {
                    const summaryData = await summaryResponse.json();
                    aiSummary = summaryData.response || aiSummary;
                }
            } catch (error) {
                console.error('Error generating email summary:', error);
            }
            
            // Determine status
            let status = 'important';
            if (email.isImportant && email.isUnread) {
                status = 'urgent';
            } else if (email.isUnread && !email.isImportant) {
                status = 'followup';
            }
            
            return {
                ...email,
                aiSummary: aiSummary.substring(0, 120),
                status: status
            };
        }));
        
        // Generate recommended actions
        const recommendedActions = [];
        if (categories.promotions > 5) {
            recommendedActions.push({
                icon: '🧹',
                text: `Archive ${categories.promotions} promotional emails?`,
                action: 'Archive',
                onClick: () => switchTab('promotions')
            });
        }
        
        const unreadImportant = processedEmails.filter(e => e.isImportant && e.isUnread).length;
        if (unreadImportant > 0) {
            recommendedActions.push({
                icon: '⏳',
                text: `You haven't replied to ${unreadImportant} important email${unreadImportant > 1 ? 's' : ''}`,
                action: 'Review',
                onClick: () => switchTab('important')
            });
        }
        
        const newsletters = processedEmails.filter(e => {
            const fromLower = e.from.toLowerCase();
            return fromLower.includes('newsletter') || fromLower.includes('unsubscribe');
        }).length;
        if (newsletters > 3) {
            recommendedActions.push({
                icon: '🚫',
                text: `Unsubscribe from ${newsletters} newsletters?`,
                action: 'Unsubscribe',
                onClick: () => alert('Unsubscribe feature coming soon')
            });
        }
        
        // Store dashboard data in cache
        const dashboardData = {
            totalEmails: emailCount,
            importantEmails: importantEmails,
            urgentEmails: urgentEmails,
            fromContacts: fromContacts,
            emails: processedEmails,
            categories: categories,
            aiDigest: aiDigest,
            priorityEmails: priorityWithSummaries,
            recommendedActions: recommendedActions,
            timestamp: new Date()
        };
        
        cachedDashboardData = dashboardData;
        
        // Display the dashboard
        displaySummaryDashboard(dashboardData);
        
    } catch (error) {
        console.error('Error generating summary dashboard:', error);
        const emailList = document.getElementById('emailList');
        emailList.innerHTML = `
            <div style="text-align: center; padding: 40px;">
                <div style="font-size: 18px; color: #d93025; margin-bottom: 16px;">❌ Error generating summary</div>
                <div style="color: #5f6368;">${error.message || 'Please try again later.'}</div>
            </div>
        `;
    }
}

// Display comprehensive summary dashboard
function displaySummaryDashboard(data) {
    const emailList = document.getElementById('emailList');
    const emailListContainer = document.querySelector('.email-list-container');
    
    // Make sure the container takes full width for dashboard
    if (emailListContainer) {
        emailListContainer.style.display = 'block';
    }
    
    emailList.innerHTML = '';
    emailList.className = 'summary-dashboard';
    emailList.style.width = '100%';
    emailList.style.maxWidth = '100%';
    emailList.style.margin = '0';
    emailList.style.padding = '0';
    
    // Header Section
    const header = document.createElement('div');
    header.className = 'summary-header';
    
    const headerLeft = document.createElement('div');
    headerLeft.className = 'summary-header-left';
    
    const title = document.createElement('h1');
    title.className = 'summary-header-title';
    title.textContent = 'Summary';
    
    const subtitle = document.createElement('p');
    subtitle.className = 'summary-header-subtitle';
    const updateTime = data.timestamp ? new Date(data.timestamp) : new Date();
    subtitle.textContent = `Last 24 hours • Updated ${updateTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    
    headerLeft.appendChild(title);
    headerLeft.appendChild(subtitle);
    
    const filterChips = document.createElement('div');
    filterChips.className = 'summary-filter-chips';
    ['Last 24 Hours', 'This Week', 'Custom'].forEach((label, index) => {
        const chip = document.createElement('button');
        chip.className = `filter-chip ${index === 0 ? 'active' : ''}`;
        chip.textContent = label;
        chip.onclick = () => {
            filterChips.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
        };
        filterChips.appendChild(chip);
    });
    
    // Add reload button
    const reloadButton = document.createElement('button');
    reloadButton.className = 'filter-chip';
    reloadButton.style.marginLeft = '8px';
    reloadButton.innerHTML = '🔄 Reload';
    reloadButton.onclick = async () => {
        cachedDashboardData = null; // Clear cache
        await generateLast12HoursSummary();
    };
    filterChips.appendChild(reloadButton);
    
    header.appendChild(headerLeft);
    header.appendChild(filterChips);
    
    // Content Container
    const content = document.createElement('div');
    content.className = 'summary-content';
    
    // Metrics Section
    const metricsSection = document.createElement('div');
    metricsSection.className = 'summary-section';
    metricsSection.innerHTML = '<h2 class="summary-section-title">Overview</h2>';
    
    const metricsRow = document.createElement('div');
    metricsRow.className = 'metrics-row';
    
    const metrics = [
        { icon: '📧', value: data.totalEmails, label: 'Total Emails' },
        { icon: '❗', value: data.importantEmails, label: 'Important Emails' },
        { icon: '⏰', value: data.urgentEmails, label: 'Urgent / Time-Sensitive' },
        { icon: '👤', value: data.fromContacts, label: 'From Contacts' }
    ];
    
    metrics.forEach(metric => {
        const card = document.createElement('div');
        card.className = 'metric-card';
        card.innerHTML = `
            <div class="metric-icon">${metric.icon}</div>
            <div class="metric-content">
                <div class="metric-value">${metric.value}</div>
                <div class="metric-label">${metric.label}</div>
            </div>
        `;
        metricsRow.appendChild(card);
    });
    
    metricsSection.appendChild(metricsRow);
    content.appendChild(metricsSection);
    
    // AI Digest Section
    const digestSection = document.createElement('div');
    digestSection.className = 'summary-section';
    digestSection.innerHTML = '<h2 class="summary-section-title">AI Digest</h2>';
    
    const digestPanel = document.createElement('div');
    digestPanel.className = 'ai-digest-panel';
    
    const digestList = document.createElement('ul');
    digestList.className = 'ai-digest-list';
    data.aiDigest.forEach(point => {
        const li = document.createElement('li');
        li.textContent = point;
        digestList.appendChild(li);
    });
    
    const viewFullLink = document.createElement('a');
    viewFullLink.className = 'view-full-link';
    viewFullLink.href = '#';
    viewFullLink.textContent = 'View Full Digest';
    viewFullLink.onclick = (e) => {
        e.preventDefault();
        // Could expand to show full AI summary
    };
    
    digestPanel.appendChild(digestList);
    digestPanel.appendChild(viewFullLink);
    digestSection.appendChild(digestPanel);
    content.appendChild(digestSection);
    
    // Priority Emails Section
    if (data.priorityEmails.length > 0) {
        const prioritySection = document.createElement('div');
        prioritySection.className = 'summary-section';
        prioritySection.innerHTML = '<h2 class="summary-section-title">Priority Emails</h2>';
        
        data.priorityEmails.forEach(email => {
            const row = document.createElement('div');
            row.className = 'priority-email-row';
            
            const emailContent = document.createElement('div');
            emailContent.className = 'priority-email-content';
            
            const sender = document.createElement('div');
            sender.className = 'priority-email-sender';
            sender.textContent = email.fromName;
            
            const subject = document.createElement('div');
            subject.className = 'priority-email-subject';
            subject.textContent = email.subject;
            
            const summary = document.createElement('div');
            summary.className = 'priority-email-summary';
            summary.innerHTML = `<span class="priority-email-status status-${email.status}">${email.status.charAt(0).toUpperCase() + email.status.slice(1)}</span>${email.aiSummary}`;
            
            emailContent.appendChild(sender);
            emailContent.appendChild(subject);
            emailContent.appendChild(summary);
            
            const actions = document.createElement('div');
            actions.className = 'priority-email-actions';
            
            const openBtn = document.createElement('button');
            openBtn.className = 'action-btn';
            openBtn.textContent = 'Open';
            openBtn.onclick = () => openEmail(email.id);
            
            const replyBtn = document.createElement('button');
            replyBtn.className = 'action-btn';
            replyBtn.textContent = 'Reply';
            replyBtn.onclick = () => replyEmail(email.id);
            
            actions.appendChild(openBtn);
            actions.appendChild(replyBtn);
            
            row.appendChild(emailContent);
            row.appendChild(actions);
            prioritySection.appendChild(row);
        });
        
        content.appendChild(prioritySection);
    }
    
    // Categorized Breakdown
    const categorySection = document.createElement('div');
    categorySection.className = 'summary-section';
    categorySection.innerHTML = '<h2 class="summary-section-title">By Category</h2>';
    
    const categoryNames = {
        work: 'Work',
        personal: 'Personal',
        finance: 'Finance',
        promotions: 'Promotions',
        other: 'Other'
    };
    
    const totalCategory = Object.values(data.categories).reduce((a, b) => a + b, 0);
    
    Object.entries(data.categories).forEach(([key, count]) => {
        if (count === 0) return;
        
        const row = document.createElement('div');
        row.className = 'category-row';
        row.onclick = () => {
            // Switch to appropriate category
            if (key === 'promotions') switchTab('promotions');
            else if (key === 'work') switchTab('primary');
        };
        
        const name = document.createElement('div');
        name.className = 'category-name';
        name.textContent = categoryNames[key];
        
        const countDiv = document.createElement('div');
        countDiv.className = 'category-count';
        countDiv.textContent = count;
        
        const progress = document.createElement('div');
        progress.className = 'category-progress';
        const progressBar = document.createElement('div');
        progressBar.className = 'category-progress-bar';
        progressBar.style.width = `${(count / totalCategory) * 100}%`;
        progress.appendChild(progressBar);
        
        row.appendChild(name);
        row.appendChild(countDiv);
        row.appendChild(progress);
        categorySection.appendChild(row);
    });
    
    content.appendChild(categorySection);
    
    // Recommended Actions
    if (data.recommendedActions.length > 0) {
        const actionsSection = document.createElement('div');
        actionsSection.className = 'summary-section';
        actionsSection.innerHTML = '<h2 class="summary-section-title">Recommended Actions</h2>';
        
        data.recommendedActions.forEach(action => {
            const card = document.createElement('div');
            card.className = 'recommended-action-card';
            
            const actionContent = document.createElement('div');
            actionContent.className = 'recommended-action-content';
            
            const icon = document.createElement('span');
            icon.className = 'recommended-action-icon';
            icon.textContent = action.icon;
            
            const text = document.createElement('span');
            text.className = 'recommended-action-text';
            text.textContent = action.text;
            
            actionContent.appendChild(icon);
            actionContent.appendChild(text);
            
            const btn = document.createElement('button');
            btn.className = 'recommended-action-btn';
            btn.textContent = action.action;
            btn.onclick = action.onClick;
            
            card.appendChild(actionContent);
            card.appendChild(btn);
            actionsSection.appendChild(card);
        });
        
        content.appendChild(actionsSection);
    }
    
    // Assemble dashboard
    emailList.appendChild(header);
    emailList.appendChild(content);
}

function getQueryForCategory(category) {
    switch (category) {
        case 'starred':
            return 'is:starred';
        case 'important':
            return 'is:important';
        case 'sent':
            return 'in:sent';
        default:
            return `category:${category}`;
    }
}

// Add function to handle profile settings
function openProfileSettings() {
    // Hide email list container, email list, tabs, and search bar
    const emailListContainer = document.querySelector('.email-list-container');
    if (emailListContainer) {
        emailListContainer.style.display = 'none';
    }
    document.getElementById('emailList').style.display = 'none';
    document.getElementById('email-tabs').style.display = 'none';
    document.querySelector('.search-bar').style.display = 'none';
    
    // Hide email viewer if visible
    const emailViewer = document.getElementById('email-viewer');
    if (emailViewer) {
        emailViewer.style.display = 'none';
    }
    
    // Hide AI settings if visible
    const aiSettingsContainer = document.getElementById('ai-settings-container');
    if (aiSettingsContainer) {
        aiSettingsContainer.style.display = 'none';
    }
    
    // Get or create profile settings container
    let settingsContainer = document.getElementById('profile-settings-container');
    
    if (!settingsContainer) {
        settingsContainer = document.createElement('div');
        settingsContainer.id = 'profile-settings-container';
        const mainContent = document.querySelector('.main-content');
        mainContent.appendChild(settingsContainer);
        // Ensure consistent positioning
        settingsContainer.style.position = 'relative';
        settingsContainer.style.top = '0';
        settingsContainer.style.left = '0';
    }
    
    // Get user email from localStorage or global variable
    const userEmail = localStorage.getItem('userEmail') || window.userEmail || 'User';
    
    // Store current tab state
    const currentTab = settingsContainer.getAttribute('data-current-tab') || 'profile';
    
    // Update settings content with tabs
    settingsContainer.innerHTML = `
        <div style="padding: 16px 24px 0 24px;">
            <button class="settings-back-button" onclick="closeProfileSettings()">Back to Emails</button>
        </div>
        <div class="settings-tabs">
            <button class="settings-tab ${currentTab === 'profile' ? 'active' : ''}" onclick="switchSettingsTab('profile')">Profile Settings</button>
            <button class="settings-tab ${currentTab === 'ai' ? 'active' : ''}" onclick="switchSettingsTab('ai')">AI Settings</button>
        </div>
        <div class="settings-tab-content-wrapper" id="settings-tab-content-wrapper">
            ${currentTab === 'profile' ? `
            <div class="settings-tab-content" id="profile-tab-content">
                <div class="settings-header">
                    <h2>Profile Settings</h2>
                </div>
                <div class="settings-content">
                    <div class="profile-section">
                        <h3>Account Information</h3>
                        <div class="profile-field">
                            <label>Email Address:</label>
                            <span>${userEmail}</span>
                        </div>
                    </div>
                    <div class="profile-section">
                        <h3>Personal Information</h3>
                        <div class="profile-field">
                            <label for="profile-name">Full Name:</label>
                            <input type="text" id="profile-name" placeholder="Enter your full name" value="${localStorage.getItem('profileName') || ''}">
                        </div>
                        <div class="profile-field">
                            <label for="profile-greeting">Greeting Name:</label>
                            <input type="text" id="profile-greeting" placeholder="Enter name for greeting (e.g., John)" value="${localStorage.getItem('profileGreeting') || ''}">
                            <small style="display: block; color: #5f6368; font-size: 12px; margin-top: 4px;">This will be used instead of your email in the greeting</small>
                        </div>
                        <div class="profile-field">
                            <label for="profile-title">Job Title:</label>
                            <input type="text" id="profile-title" placeholder="Enter your job title" value="${localStorage.getItem('profileTitle') || ''}">
                        </div>
                    </div>
                    <div class="profile-section">
                        <h3>Contact Information</h3>
                        <div class="profile-field">
                            <label for="profile-phone">Phone Number:</label>
                            <input type="tel" id="profile-phone" placeholder="Enter your phone number" value="${localStorage.getItem('profilePhone') || ''}">
                        </div>
                    </div>
                    <div class="profile-actions">
                        <button class="save-btn" onclick="saveProfileSettings()">Save Changes</button>
                        <button class="cancel-btn" onclick="closeProfileSettings()">Cancel</button>
                    </div>
                </div>
            </div>
            ` : `
            <div class="settings-tab-content" id="ai-tab-content">
        <div class="settings-header">
            <h2>AI Settings</h2>
        </div>
        <div class="settings-content">
                    <div class="profile-section">
                        <h3>Email Tone</h3>
                        <div class="profile-field">
                            <label>Choose the tone for AI-generated emails</label>
                            <div class="tone-selector">
                                <button class="tone-option ${(localStorage.getItem('aiTone') || 'professional') === 'formal' ? 'active' : ''}" onclick="setAITone('formal')" data-tone="formal">Formal</button>
                                <button class="tone-option ${(localStorage.getItem('aiTone') || 'professional') === 'professional' ? 'active' : ''}" onclick="setAITone('professional')" data-tone="professional">Professional</button>
                                <button class="tone-option ${(localStorage.getItem('aiTone') || 'professional') === 'casual' ? 'active' : ''}" onclick="setAITone('casual')" data-tone="casual">Casual</button>
                            </div>
                        </div>
                    </div>
                    <div class="profile-section">
                        <h3>Response Length</h3>
                        <div class="profile-field">
                            <label>Choose the length for AI-generated emails</label>
                            <div class="tone-selector">
                                <button class="tone-option ${(localStorage.getItem('aiLength') || 'medium') === 'short' ? 'active' : ''}" onclick="setAILength('short')" data-length="short">Short</button>
                                <button class="tone-option ${(localStorage.getItem('aiLength') || 'medium') === 'medium' ? 'active' : ''}" onclick="setAILength('medium')" data-length="medium">Medium</button>
                                <button class="tone-option ${(localStorage.getItem('aiLength') || 'medium') === 'long' ? 'active' : ''}" onclick="setAILength('long')" data-length="long">Long</button>
                            </div>
                        </div>
                    </div>
                    <div class="profile-section">
                        <h3>Context Awareness</h3>
                        <div class="profile-field">
                            <label>Use email thread history for better responses</label>
                            <div class="tone-selector">
                                <button class="tone-option ${(localStorage.getItem('aiContextAwareness') || 'on') === 'on' ? 'active' : ''}" onclick="setAIContextAwareness('on')" data-context="on">On</button>
                                <button class="tone-option ${(localStorage.getItem('aiContextAwareness') || 'on') === 'off' ? 'active' : ''}" onclick="setAIContextAwareness('off')" data-context="off">Off</button>
                            </div>
                        </div>
                    </div>
                    <div class="profile-section">
                        <h3>Email Signature</h3>
                        <div class="profile-field">
                            <label>Add a signature that will be automatically included at the end of AI-generated emails</label>
                            <div class="signature-input-container">
                                <textarea id="ai-signature" class="signature-input" placeholder="Enter your signature (e.g., Your Name&#10;Job Title&#10;Company Name&#10;Email: your.email@example.com&#10;Phone: (555) 123-4567)" rows="5">${localStorage.getItem('aiSignature') || ''}</textarea>
                                <button class="save-signature-btn" onclick="saveAISignature()">Save Signature</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            `}
        </div>
    `;
    
    // Store current tab
    settingsContainer.setAttribute('data-current-tab', currentTab);
    
    // Reset position and show container
    settingsContainer.style.display = 'block';
    settingsContainer.style.position = 'relative';
    settingsContainer.style.top = '0';
    settingsContainer.style.left = '0';
    settingsContainer.style.margin = '20px';
    
    // Update active state in navigation
    document.querySelectorAll('.nav-item, .sub-nav-item').forEach(item => {
        item.classList.remove('active');
    });
}

// Function to update the greeting button with greeting name or email
function updateGreeting() {
    const greetingBtn = document.getElementById('user-greeting');
    if (!greetingBtn) return;
    
    const greetingName = localStorage.getItem('profileGreeting');
    const userEmail = localStorage.getItem('userEmail') || window.userEmail;
    
    // Use greeting name if available, otherwise use email
    const displayName = greetingName && greetingName.trim() ? greetingName.trim() : userEmail;
    
    if (displayName) {
        greetingBtn.textContent = `Hi, ${displayName}`;
    }
}

function saveProfileSettings() {
    // Save profile settings to localStorage
    const name = document.getElementById('profile-name').value;
    const greeting = document.getElementById('profile-greeting').value;
    const title = document.getElementById('profile-title').value;
    const phone = document.getElementById('profile-phone').value;
    
    localStorage.setItem('profileName', name);
    localStorage.setItem('profileGreeting', greeting);
    localStorage.setItem('profileTitle', title);
    localStorage.setItem('profilePhone', phone);
    
    // Update greeting button
    updateGreeting();
    
    // Show success message
    alert('Profile settings saved successfully!');
    
    // Close profile settings
    closeProfileSettings();
}

function switchSettingsTab(tabName) {
    const settingsContainer = document.getElementById('profile-settings-container');
    if (!settingsContainer) return;
    
    // Store current tab
    settingsContainer.setAttribute('data-current-tab', tabName);
    
    // Get user email for profile tab
    const userEmail = localStorage.getItem('userEmail') || window.userEmail || 'User';
    
    // Get the wrapper
    const wrapper = document.getElementById('settings-tab-content-wrapper');
    if (!wrapper) return;
    
    // Remove active class from all tabs
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Update tab buttons
    const tabs = document.querySelectorAll('.settings-tab');
    if (tabName === 'profile' && tabs[0]) {
        tabs[0].classList.add('active');
    } else if (tabName === 'ai' && tabs[1]) {
        tabs[1].classList.add('active');
    }
    
    // Replace content based on tab
    if (tabName === 'profile') {
        wrapper.innerHTML = `
            <div class="settings-tab-content" id="profile-tab-content">
                <div class="settings-header">
                    <h2>Profile Settings</h2>
                </div>
                <div class="settings-content">
                    <div class="profile-section">
                        <h3>Account Information</h3>
                        <div class="profile-field">
                            <label>Email Address:</label>
                            <span>${userEmail}</span>
                        </div>
                    </div>
                    <div class="profile-section">
                        <h3>Personal Information</h3>
                        <div class="profile-field">
                            <label for="profile-name">Full Name:</label>
                            <input type="text" id="profile-name" placeholder="Enter your full name" value="${localStorage.getItem('profileName') || ''}">
                        </div>
                        <div class="profile-field">
                            <label for="profile-greeting">Greeting Name:</label>
                            <input type="text" id="profile-greeting" placeholder="Enter name for greeting (e.g., John)" value="${localStorage.getItem('profileGreeting') || ''}">
                            <small style="display: block; color: #5f6368; font-size: 12px; margin-top: 4px;">This will be used instead of your email in the greeting</small>
                        </div>
                        <div class="profile-field">
                            <label for="profile-title">Job Title:</label>
                            <input type="text" id="profile-title" placeholder="Enter your job title" value="${localStorage.getItem('profileTitle') || ''}">
                        </div>
                    </div>
                    <div class="profile-section">
                        <h3>Contact Information</h3>
                        <div class="profile-field">
                            <label for="profile-phone">Phone Number:</label>
                            <input type="tel" id="profile-phone" placeholder="Enter your phone number" value="${localStorage.getItem('profilePhone') || ''}">
                        </div>
                    </div>
                    <div class="profile-actions">
                        <button class="save-btn" onclick="saveProfileSettings()">Save Changes</button>
                        <button class="cancel-btn" onclick="closeProfileSettings()">Cancel</button>
                    </div>
                </div>
            </div>
        `;
    } else if (tabName === 'ai') {
        const currentTone = localStorage.getItem('aiTone') || 'professional';
        const currentLength = localStorage.getItem('aiLength') || 'medium';
        const currentContextAwareness = localStorage.getItem('aiContextAwareness') || 'on';
        wrapper.innerHTML = `
            <div class="settings-tab-content" id="ai-tab-content">
                <div class="settings-header">
                    <h2>AI Settings</h2>
                </div>
                <div class="settings-content">
                    <div class="profile-section">
                        <h3>Email Tone</h3>
                        <div class="profile-field">
                            <label>Choose the tone for AI-generated emails</label>
                            <div class="tone-selector">
                                <button class="tone-option ${currentTone === 'formal' ? 'active' : ''}" onclick="setAITone('formal')" data-tone="formal">Formal</button>
                                <button class="tone-option ${currentTone === 'professional' ? 'active' : ''}" onclick="setAITone('professional')" data-tone="professional">Professional</button>
                                <button class="tone-option ${currentTone === 'casual' ? 'active' : ''}" onclick="setAITone('casual')" data-tone="casual">Casual</button>
                            </div>
                        </div>
                    </div>
                    <div class="profile-section">
                        <h3>Response Length</h3>
                        <div class="profile-field">
                            <label>Choose the length for AI-generated emails</label>
                            <div class="tone-selector">
                                <button class="tone-option ${currentLength === 'short' ? 'active' : ''}" onclick="setAILength('short')" data-length="short">Short</button>
                                <button class="tone-option ${currentLength === 'medium' ? 'active' : ''}" onclick="setAILength('medium')" data-length="medium">Medium</button>
                                <button class="tone-option ${currentLength === 'long' ? 'active' : ''}" onclick="setAILength('long')" data-length="long">Long</button>
                            </div>
                        </div>
                    </div>
                    <div class="profile-section">
                        <h3>Context Awareness</h3>
                        <div class="profile-field">
                            <label>Use email thread history for better responses</label>
                            <div class="tone-selector">
                                <button class="tone-option ${(localStorage.getItem('aiContextAwareness') || 'on') === 'on' ? 'active' : ''}" onclick="setAIContextAwareness('on')" data-context="on">On</button>
                                <button class="tone-option ${(localStorage.getItem('aiContextAwareness') || 'on') === 'off' ? 'active' : ''}" onclick="setAIContextAwareness('off')" data-context="off">Off</button>
                            </div>
                        </div>
                    </div>
                    <div class="profile-section">
                        <h3>Email Signature</h3>
                        <div class="profile-field">
                            <label>Add a signature that will be automatically included at the end of AI-generated emails</label>
                            <div class="signature-input-container">
                                <textarea id="ai-signature" class="signature-input" placeholder="Enter your signature (e.g., Your Name&#10;Job Title&#10;Company Name&#10;Email: your.email@example.com&#10;Phone: (555) 123-4567)" rows="5">${localStorage.getItem('aiSignature') || ''}</textarea>
                                <button class="save-signature-btn" onclick="saveAISignature()">Save Signature</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
}

// Function to set AI tone preference
function setAITone(tone) {
    // Get current tone from localStorage
    const currentTone = localStorage.getItem('aiTone');
    
    // If clicking the same tone that's already active, reset to default
    if (currentTone === tone) {
        const defaultTone = 'professional';
        localStorage.setItem('aiTone', defaultTone);
        
        // Update UI - remove active class from all buttons
        document.querySelectorAll('.tone-option[data-tone]').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Add active class to default button
        const defaultBtn = document.querySelector(`.tone-option[data-tone="${defaultTone}"]`);
        if (defaultBtn) {
            defaultBtn.classList.add('active');
        }
        
        console.log(`AI tone reset to default: ${defaultTone}`);
        return;
    }
    
    // Save to localStorage
    localStorage.setItem('aiTone', tone);
    
    // Update UI - remove active class from all buttons
    document.querySelectorAll('.tone-option[data-tone]').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Add active class to selected button
    const selectedBtn = document.querySelector(`.tone-option[data-tone="${tone}"]`);
    if (selectedBtn) {
        selectedBtn.classList.add('active');
    }
    
    // Show confirmation (optional - you can remove this if you want)
    console.log(`AI tone set to: ${tone}`);
}

// Make function globally accessible
window.setAITone = setAITone;

// Function to set AI response length preference
function setAILength(length) {
    // Get current length from localStorage
    const currentLength = localStorage.getItem('aiLength');
    
    // If clicking the same length that's already active, reset to default
    if (currentLength === length) {
        const defaultLength = 'medium';
        localStorage.setItem('aiLength', defaultLength);
        
        // Update UI - remove active class from all buttons
        document.querySelectorAll('.tone-option[data-length]').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Add active class to default button
        const defaultBtn = document.querySelector(`.tone-option[data-length="${defaultLength}"]`);
        if (defaultBtn) {
            defaultBtn.classList.add('active');
        }
        
        console.log(`AI response length reset to default: ${defaultLength}`);
        return;
    }
    
    // Save to localStorage
    localStorage.setItem('aiLength', length);
    
    // Update UI - remove active class from all buttons
    document.querySelectorAll('.tone-option[data-length]').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Add active class to selected button
    const selectedBtn = document.querySelector(`.tone-option[data-length="${length}"]`);
    if (selectedBtn) {
        selectedBtn.classList.add('active');
    }
    
    // Show confirmation (optional - you can remove this if you want)
    console.log(`AI response length set to: ${length}`);
}

// Make function globally accessible
window.setAILength = setAILength;

// Function to set AI context awareness preference
function setAIContextAwareness(context) {
    // Get current context awareness from localStorage
    const currentContext = localStorage.getItem('aiContextAwareness');
    
    // If clicking the same context that's already active, reset to default
    if (currentContext === context) {
        const defaultContext = 'on';
        localStorage.setItem('aiContextAwareness', defaultContext);
        
        // Update UI - remove active class from all buttons
        document.querySelectorAll('.tone-option[data-context]').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Add active class to default button
        const defaultBtn = document.querySelector(`.tone-option[data-context="${defaultContext}"]`);
        if (defaultBtn) {
            defaultBtn.classList.add('active');
        }
        
        console.log(`AI context awareness reset to default: ${defaultContext}`);
        return;
    }
    
    // Save to localStorage
    localStorage.setItem('aiContextAwareness', context);
    
    // Update UI - remove active class from all buttons
    document.querySelectorAll('.tone-option[data-context]').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Add active class to selected button
    const selectedBtn = document.querySelector(`.tone-option[data-context="${context}"]`);
    if (selectedBtn) {
        selectedBtn.classList.add('active');
    }
    
    // Show confirmation (optional - you can remove this if you want)
    console.log(`AI context awareness set to: ${context}`);
}

// Make function globally accessible
window.setAIContextAwareness = setAIContextAwareness;

// Function to save AI signature
function saveAISignature() {
    const signatureTextarea = document.getElementById('ai-signature');
    if (!signatureTextarea) return;
    
    const signature = signatureTextarea.value.trim();
    localStorage.setItem('aiSignature', signature);
    
    // Show confirmation
    const saveBtn = document.querySelector('.save-signature-btn');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = 'Saved!';
    saveBtn.style.background = '#34a853';
    
    setTimeout(() => {
        saveBtn.textContent = originalText;
        saveBtn.style.background = '';
    }, 2000);
    
    console.log('AI signature saved');
}

// Make function globally accessible
window.saveAISignature = saveAISignature;

function closeProfileSettings() {
    // Hide profile settings container
    const settingsContainer = document.getElementById('profile-settings-container');
    if (settingsContainer) {
        settingsContainer.style.display = 'none';
    }
    
    // Show email list container
    const emailListContainer = document.querySelector('.email-list-container');
    if (emailListContainer) {
        emailListContainer.style.display = 'flex';
    }
    
    // Show email list, tabs, and search bar
    document.getElementById('emailList').style.display = 'block';
    document.getElementById('email-tabs').style.display = 'flex';
    document.querySelector('.search-bar').style.display = 'flex';
    
    // Clear ALL active states from sidebar items first
    document.querySelectorAll('.nav-item, .sub-nav-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Activate only the main Inbox nav-item
    const inboxNavItem = document.querySelector('.nav-item[onclick*="switchSection"]');
    if (inboxNavItem) {
        inboxNavItem.classList.add('active');
    }
}

function closeAISettings() {
    // Hide settings container
    const settingsContainer = document.getElementById('ai-settings-container');
    if (settingsContainer) {
        settingsContainer.style.display = 'none';
    }
    
    // Show email list, tabs, and search bar
    document.getElementById('emailList').style.display = 'block';
    document.getElementById('email-tabs').style.display = 'flex';
    document.querySelector('.search-bar').style.display = 'flex';
    
    // Clear ALL active states from sidebar items first
    document.querySelectorAll('.nav-item, .sub-nav-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Activate only the main Inbox nav-item
    const inboxNavItem = document.querySelector('.nav-item[onclick*="switchSection"]');
    if (inboxNavItem) {
        inboxNavItem.classList.add('active');
    }
}

function isEmailContent(text) {
    // Check for common email patterns
    const emailPatterns = [
        /subject:/i,                   // Subject line
        /dear\s+/i,                   // Greeting with "Dear"
        /best regards/i,              // Common closing
        /sincerely/i,                 // Common closing
        /thank(s| you)/i,             // Thanks/Thank you
        /\[.*?\]/i,                   // Text in square brackets like [Boss's Name]
        /hope this (email|message|note) finds you well/i  // Common email opening
    ];

    // Return true if at least 2 email patterns are found
    return emailPatterns.filter(pattern => pattern.test(text)).length >= 2;
}

// Add function to mark email as read
async function markAsRead(emailId) {
    try {
        console.log(`Marking email ${emailId} as read...`);
        
        // Send request to Gmail API to mark as read
        await gapi.client.gmail.users.messages.modify({
            userId: 'me',
            id: emailId,
            resource: {
                removeLabelIds: ['UNREAD']
            }
        });
        
        console.log(`Email ${emailId} marked as read in Gmail`);
        
        // If we're currently displaying the email list, update the UI immediately
        const emailItem = document.querySelector(`.email-item[data-id="${emailId}"]`);
        if (emailItem) {
            console.log("Found email item in the DOM, updating class");
            emailItem.classList.add('email-read');
            // Remove the unread visual indicator (blue left border)
            emailItem.style.borderLeft = "none";
            
            // Update any other visual indicators of unread status
            const subjectEl = emailItem.querySelector('.email-subject');
            if (subjectEl) {
                subjectEl.style.fontWeight = 'normal';
                subjectEl.style.color = '#5f6368';
            }
            
            const snippetEl = emailItem.querySelector('.email-snippet');
            if (snippetEl) {
                snippetEl.style.color = '#5f6368';
            }
        } else {
            console.log("Email item not found in the DOM, it will be updated on next refresh");
        }
    } catch (error) {
        console.error('Error marking email as read:', error);
    }
}

// Update the clearAllSelections function
function clearAllSelections() {
    // Clear all checkboxes
    document.querySelectorAll('.email-checkbox').forEach(checkbox => {
        checkbox.checked = false;
    });
    
    // Remove selected styling from all emails
    document.querySelectorAll('.email-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    // Hide the toolbar
    const toolbar = document.getElementById('selection-toolbar');
    if (toolbar) {
        toolbar.style.display = 'none';
    }
    
    // Clear the selected emails set
    selectedEmails.clear();
}

// Update the handleEmailSelection function
function handleEmailSelection(emailId, checkbox) {
    console.log('Email selection changed:', emailId, checkbox.checked);
    if (checkbox.checked) {
        selectedEmails.add(emailId);
        document.querySelector(`[data-id="${emailId}"]`).classList.add('selected');
    } else {
        selectedEmails.delete(emailId);
        document.querySelector(`[data-id="${emailId}"]`).classList.remove('selected');
    }
    
    console.log('Selected emails after change:', selectedEmails);
    updateToolbarPosition();
}

// Function to update the toolbar position
function updateToolbarPosition() {
    const toolbar = document.getElementById('selection-toolbar');
    if (selectedEmails.size > 0) {
        const firstSelectedId = Array.from(selectedEmails)[0];
        const firstSelectedEmail = document.querySelector(`[data-id="${firstSelectedId}"]`);
        const rect = firstSelectedEmail.getBoundingClientRect();
        
        toolbar.style.display = 'block';
        toolbar.style.position = 'fixed';
        
        // Calculate position relative to the viewport
        let topPosition = rect.top; // Use viewport-relative position
        const toolbarHeight = toolbar.offsetHeight;
        const viewportHeight = window.innerHeight;
        
        // Ensure the toolbar stays within the viewport
        if (topPosition < 0) {
            topPosition = 10; // 10px from top if email is above viewport
        } else if (topPosition + toolbarHeight > viewportHeight) {
            topPosition = viewportHeight - toolbarHeight - 10; // 10px from bottom
        }
        
        // Set the position
        toolbar.style.top = `${topPosition}px`;
        toolbar.style.left = `${rect.left - 140}px`; // Keep the same left position
        toolbar.style.zIndex = '1000';
    } else {
        toolbar.style.display = 'none';
    }
}

// Make sure to update position on scroll
window.addEventListener('scroll', () => {
    if (selectedEmails.size > 0) {
        requestAnimationFrame(updateToolbarPosition);
    }
});

// Update position on window resize
window.addEventListener('resize', () => {
    if (selectedEmails.size > 0) {
        requestAnimationFrame(updateToolbarPosition);
    }
});

// Function to handle starring multiple selected emails
async function handleStarSelected(event) {
    if (selectedEmails.size === 0) {
        console.log('No emails selected');
        return;
    }
    console.log('Star button clicked', event);
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    try {
        const firstSelectedId = Array.from(selectedEmails)[0];
        const firstSelectedEmail = document.querySelector(`[data-id="${firstSelectedId}"]`);
        const isCurrentlyStarred = firstSelectedEmail.querySelector('.gold-star') !== null;
        const labelAction = isCurrentlyStarred ? 'remove' : 'add';
        
        for (const emailId of selectedEmails) {
            await gapi.client.gmail.users.messages.modify({
                'userId': 'me',
                'id': emailId,
                'resource': {
                    [`${labelAction}LabelIds`]: ['STARRED']
                }
            });

            // Update UI without refreshing
            const starElement = document.querySelector(`.email-item[data-id="${emailId}"] .email-star`);
            if (starElement) {
                starElement.innerHTML = isCurrentlyStarred ? '☆' : '<span class="gold-star">⭐</span>';
            }
        }
        updateToolbarPosition();
    } catch (error) {
        console.error('Error updating star status:', error);
        alert('Error updating star status. Please try again.');
    }
}

// Function to handle marking multiple selected emails as important
async function handleImportantSelected(event) {
    if (selectedEmails.size === 0) {
        console.log('No emails selected');
        return;
    }
    console.log('Important button clicked', event);
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    try {
        const firstSelectedId = Array.from(selectedEmails)[0];
        const firstSelectedEmail = document.querySelector(`[data-id="${firstSelectedId}"]`);
        const isCurrentlyImportant = firstSelectedEmail.querySelector('.email-important').textContent === '❗';
        const labelAction = isCurrentlyImportant ? 'remove' : 'add';

        for (const emailId of selectedEmails) {
            await gapi.client.gmail.users.messages.modify({
                'userId': 'me',
                'id': emailId,
                'resource': {
                    [`${labelAction}LabelIds`]: ['IMPORTANT']
                }
            });

            // Update UI without refreshing
            const importantElement = document.querySelector(`.email-item[data-id="${emailId}"] .email-important`);
            if (importantElement) {
                importantElement.innerHTML = isCurrentlyImportant ? '❕' : '❗';
                importantElement.onclick = () => toggleImportant(emailId, !isCurrentlyImportant);
            }
        }
        updateToolbarPosition();
    } catch (error) {
        console.error('Error updating important status:', error);
        alert('Error updating important status. Please try again.');
    }
}

// Function to handle deleting multiple selected emails
async function handleDeleteSelected(event) {
    if (selectedEmails.size === 0) {
        console.log('No emails selected');
        return;
    }
    console.log('Delete button clicked', event);
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    if (!confirm('Are you sure you want to delete the selected emails?')) {
        return;
    }

    try {
        for (const emailId of selectedEmails) {
            await gapi.client.gmail.users.messages.trash({
                'userId': 'me',
                'id': emailId
            });
            
            // Remove the email from the UI
            const emailElement = document.querySelector(`.email-item[data-id="${emailId}"]`);
            if (emailElement) {
                emailElement.remove();
            }
        }
        
        // Clear selections and hide toolbar
        selectedEmails.clear();
        const toolbar = document.getElementById('selection-toolbar');
        if (toolbar) {
            toolbar.style.display = 'none';
        }
    } catch (error) {
        console.error('Error deleting emails:', error);
        alert('Error deleting emails. Please try again.');
    }
}

/**
 * Improved consolidated formatEmailContent function that combines both implementations
 * This is now the single source of truth for email formatting
 */
function formatEmailContent(emailContent) {
    // Safety check
    if (!emailContent) return '';
    
    try {
        // Convert line breaks to HTML breaks
        let formatted = emailContent.replace(/\n/g, '<br>');
        
        // Try to identify and highlight the subject line
        const subjectMatch = formatted.match(/Subject:(.+?)<br>/i);
        if (subjectMatch) {
            formatted = formatted.replace(
                subjectMatch[0], 
                `<strong class="email-subject">Subject:${subjectMatch[1]}</strong><br>`
            );
        }
        
        // Add any additional formatting here
        
        return formatted;
    } catch (error) {
        DEBUG("Error formatting email content", error);
        // Fallback to just returning the original content
        return emailContent;
    }
}

async function toggleImportant(emailId, isCurrentlyImportant) {
    try {
        const labelAction = isCurrentlyImportant ? 'add' : 'remove';
        
        await gapi.client.gmail.users.messages.modify({
            'userId': 'me',
            'id': emailId,
            'resource': {
                [`${labelAction}LabelIds`]: ['IMPORTANT']
            }
        });

        // Update UI immediately without refresh
        const importantElement = document.querySelector(`.email-item[data-id="${emailId}"] .email-important`);
        if (importantElement) {
            importantElement.innerHTML = isCurrentlyImportant ? '❗' : '❕';
            importantElement.onclick = () => toggleImportant(emailId, !isCurrentlyImportant);
        }

        console.log(`Email ${emailId} ${labelAction === 'add' ? 'marked as important' : 'unmarked as important'}`);
    } catch (error) {
        console.error('Error toggling important status:', error);
        alert('Error updating important status. Please try again.');
    }
}

// Add a debug function to test both compose and reply
window.testComposeWindows = function() {
    // Test compose (new message)
    console.log('Testing new message compose window:');
    openComposeModal(null);
    
    // Wait 3 seconds and then test reply
    setTimeout(() => {
        console.log('Testing reply window:');
        openComposeModal({
            from: 'test@example.com',
            subject: 'Test Subject',
            date: new Date().toLocaleString(),
            body: 'This is a test email body.\nWith multiple lines.'
        });
    }, 3000);
};

// Create an alias for moveToComposeSimple to fix any remaining references
// This ensures that any code that still refers to the old moveToCompose function
// will instead call our fixed moveToComposeSimple function
window.moveToCompose = window.moveToComposeSimple;

/**
 * Moves generated email content to the compose form, extracting subject if possible
 */
function moveEmailToCompose(emailContent) {
    try {
        DEBUG("Moving email to compose form", { 
            contentType: typeof emailContent,
            preview: typeof emailContent === 'string' ? emailContent.substring(0, 50) + '...' : 'not a string' 
        });
        
        // First open the compose modal
        openComposeModal();
        
        // Look for subject line pattern in the text
        let subject = '';
        let body = emailContent;
        
        // Check common subject line patterns
        const subjectPatterns = [
            /Subject:(.+?)(?:\n|$)/i,
            /Subject line:(.+?)(?:\n|$)/i,
            /^(?:.*?)Subject:(.+?)(?:\n|$)/im,
            /^RE:(.+?)(?:\n|$)/i,
            /^Re:(.+?)(?:\n|$)/i,
            /^FWD:(.+?)(?:\n|$)/i,
            /^Fwd:(.+?)(?:\n|$)/i
        ];
        
        // Try each pattern to extract subject
        for (const pattern of subjectPatterns) {
            const match = emailContent.match(pattern);
            if (match && match[1]) {
                subject = match[1].trim();
                DEBUG("Subject extracted:", subject);
                // Remove the subject line from the body
                body = body.replace(pattern, '').trim();
                break;
            }
        }
        
        // If we still don't have a subject, look for the first line that might be a subject
        if (!subject && body.includes('\n')) {
            const firstLine = body.split('\n')[0].trim();
            // If the first line is short and doesn't look like a greeting, it might be a subject
            if (firstLine.length < 80 && 
                !firstLine.match(/^(hi|hello|hey|dear|to whom)/i)) {
                subject = firstLine;
                DEBUG("First line as subject:", subject);
                body = body.substring(firstLine.length).trim();
            }
        }
        
        // Set subject and body in compose form
        const subjectField = document.getElementById('compose-subject');
        const bodyField = document.getElementById('compose-body');
        
        DEBUG("Setting compose fields", { 
            subject,
            bodyPreview: body.substring(0, 50) + '...',
            isContentEditable: bodyField ? bodyField.getAttribute('contenteditable') === 'true' : false
        });
        
        if (subjectField) subjectField.value = subject;
        
        if (bodyField) {
            if (bodyField.getAttribute('contenteditable') === 'true') {
                // For contenteditable, we use innerHTML
                bodyField.innerHTML = body;
                
                // Also update the hidden textarea if it exists
                const hiddenBody = document.getElementById('compose-body-hidden');
                if (hiddenBody) hiddenBody.value = body;
            } else {
                // For regular textarea, use value
                bodyField.value = body;
            }
        }
        
        DEBUG("Email moved to compose form", { 
            subjectFound: !!subject,
            bodyLength: body.length
        });
        
        return true;
    } catch (error) {
        DEBUG("Error moving email to compose", error);
        console.error("Error moving email to compose:", error);
        return false;
    }
}