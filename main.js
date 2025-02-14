// Google API credentials
const CLIENT_ID = '226672443169-6sjeu8f2l6j1du0njr00eatcem6hk9p9.apps.googleusercontent.com';
const API_KEY = 'REDACTED_GOOGLE_API_KEY';

// Discovery doc URL for APIs used by the quickstart
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest';
const SCOPES = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose';

// Add this at the top with other constants
const OPENAI_API_KEY = 'REDACTED_OPENAI_API_KEY';

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

// Define a maximum number of retry attempts
const MAX_RETRY_ATTEMPTS = 3;

document.addEventListener('DOMContentLoaded', initializeAPI);

function initializeAPI() {
    gapi.load('client', async () => {
        try {
            await gapi.client.init({
                apiKey: API_KEY,
                discoveryDocs: [DISCOVERY_DOC],
            });
            gapiInited = true;

            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID,
                scope: 'https://www.googleapis.com/auth/gmail.modify',
                callback: handleAuthResponse,
                ux_mode: 'redirect',
                include_granted_scopes: true
            });
            gisInited = true;

            console.log('Google API initialized successfully');
        } catch (error) {
            console.error('Error initializing API:', error);
        }
    });
}

function handleAuthClick() {
    if (!gapiInited || !gisInited) {
        console.log('API not initialized yet');
        return;
    }

    tokenClient.requestAccessToken({
        prompt: 'consent' // Force re-consent to ensure all scopes are granted
    });
}

async function handleAuthResponse(response) {
    if (response.error !== undefined) {
        console.error('Auth error:', response.error);
        return;
    }
    
    try {
        const profile = await gapi.client.gmail.users.getProfile({
            'userId': 'me'
        });
        
        userEmail = profile.result.emailAddress;
        localStorage.setItem('isAuthenticated', 'true');
        localStorage.setItem('userEmail', userEmail);
        
        document.getElementById('user-greeting').textContent = `Hi, ${userEmail}`;
        document.getElementById('login-container').style.display = 'none';
        document.getElementById('app').style.display = 'block';
        
        // Show email tabs
        document.querySelector('.email-tabs').style.display = 'flex';
        
        // Switch to primary tab immediately after login
        await switchTab('primary');
        
        // Automatically refresh emails after login
        refreshEmails();
        
        // Simulate a click on the refresh button
        document.querySelector('.refresh-btn').click();
        
    } catch (error) {
        console.error('Error:', error);
    }
}

function isOnline() {
    return window.navigator.onLine;
}

async function listEmails(page = 1, filter = 'primary', retryCount = 0) {
    if (!isOnline()) {
        document.getElementById('emailList').innerHTML = `
            <div style="text-align: center; padding: 20px; color: #d93025;">
                <p>No internet connection. Please check your network and try again.</p>
            </div>
        `;
        return [];
    }

    const MAX_RETRIES = 3; // Maximum number of retry attempts

    try {
        document.getElementById('emailList').innerHTML = `
            <div style="text-align: center; padding: 20px;">
                <p>Loading emails...</p>
            </div>
        `;

        const response = await withTimeout(
            gapi.client.gmail.users.messages.list({
                'userId': 'me',
                'maxResults': EMAILS_PER_PAGE,
                'q': `category:${filter}`,
                'pageToken': pageTokens[page] || undefined,
                'orderBy': 'date'
            }),
            10000 // 10-second timeout
        );

        if (!response.result.messages) {
            throw new Error('No emails found.');
        }

        // Store next page token
        if (response.result.nextPageToken) {
            pageTokens[page + 1] = response.result.nextPageToken;
            console.log(`Stored nextPageToken for page ${page + 1}`);
        } else {
            // Clear the next page token if it doesn't exist
            delete pageTokens[page + 1];
            console.log(`No nextPageToken for page ${page + 1}`);
        }

        const emails = await Promise.all(response.result.messages.map(async message => {
            const emailDetails = await gapi.client.gmail.users.messages.get({
                'userId': 'me',
                'id': message.id,
                'format': 'metadata',
                'metadataHeaders': ['Subject', 'From', 'Date']
            });
            
            const headers = emailDetails.result.payload.headers;
            const isStarred = emailDetails.result.labelIds.includes('STARRED');
            const isImportant = emailDetails.result.labelIds.includes('IMPORTANT');

            return {
                id: message.id,
                subject: headers.find(header => header.name === 'Subject')?.value || '(no subject)',
                from: headers.find(header => header.name === 'From')?.value || '(no sender)',
                date: headers.find(header => header.name === 'Date')?.value || '',
                snippet: emailDetails.result.snippet || 'No preview available',
                isStarred,
                isImportant
            };
        }));

        return emails;

    } catch (error) {
        console.error('Error fetching emails:', error);

        if (retryCount < MAX_RETRIES) {
            console.log(`Retrying... (${retryCount + 1}/${MAX_RETRIES})`);
            return listEmails(page, filter, retryCount + 1);
        }

        document.getElementById('emailList').innerHTML = `
            <div style="text-align: center; padding: 20px; color: #d93025;">
                <p>Error loading emails. Please try again later.</p>
            </div>
        `;
        return [];
    }
}

function displayEmails(emails) {
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    
    const emailList = document.getElementById('emailList');
    
    if (!emails || emails.length === 0) {
        emailList.innerHTML = `
            <div style="padding: 20px; text-align: center;">
                <p>No emails found.</p>
            </div>
        `;
        return;
    }
    
    const totalPages = Math.ceil(totalEmails / EMAILS_PER_PAGE);
    const startIndex = ((currentPage - 1) * EMAILS_PER_PAGE) + 1;
    const endIndex = startIndex + emails.length - 1;
    
    emailList.innerHTML = `
        <div class="email-list-header">
            <div class="email-count">
                Showing ${startIndex}-${endIndex} 
                of ${totalEmails}
                <button onclick="changePage(${currentPage - 1})" 
                        class="nav-btn" 
                        ${currentPage === 1 ? 'disabled' : ''}>
                    ←
                </button>
                <button onclick="changePage(${currentPage + 1})" 
                        class="nav-btn" 
                        ${currentPage === totalPages ? 'disabled' : ''}>
                    →
                </button>
            </div>
        </div>
        ${emails.map(email => `
            <div class="email-item" data-id="${email.id}" onclick="openEmail('${email.id}')" style="cursor: pointer;">
                <input type="checkbox" class="email-checkbox" onclick="event.stopPropagation()">
                <span class="email-star" onclick="event.stopPropagation(); toggleStar('${email.id}', this.classList.contains('gold-star'))">
                    ${email.isStarred ? '<span class="gold-star">★</span>' : '☆'}
                </span>
                ${email.isImportant ? '<span class="email-important" style="color: red;">❗</span>' : ''}
                <div class="email-content">
                    <div class="email-sender">${formatSender(email.from)}</div>
                    <div class="email-subject">${email.subject}</div>
                    <div class="email-snippet">${email.snippet}</div>
                </div>
                <div class="email-date">${formatDate(new Date(email.date))}</div>
            </div>
        `).join('')}
        <div class="pagination">
            ${generatePaginationControls(currentPage, totalPages)}
        </div>
    `;
}

function formatSender(from) {
    const match = from.match(/^"?([^"]*)"?\s*(?:<.*>)?$/);
    return match ? match[1] : from;
}

function formatDate(date) {
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
    let controls = [];
    
    controls.push(`
        <button 
            onclick="changePage(${currentPage - 1})" 
            class="page-button" 
            ${currentPage === 1 ? 'disabled' : ''}>
            Previous
        </button>
    `);

    // First page
    if (currentPage > 3) {
        controls.push(`
            <button onclick="changePage(1)" class="page-button">1</button>
            ${currentPage > 4 ? '<span class="page-info">...</span>' : ''}
        `);
    }

    // Pages around current page
    for (let i = Math.max(1, currentPage - 2); i <= Math.min(totalPages, currentPage + 2); i++) {
        controls.push(`
            <button 
                onclick="changePage(${i})" 
                class="page-button ${i === currentPage ? 'active' : ''}">
                ${i}
            </button>
        `);
    }

    // Last page
    if (currentPage < totalPages - 2) {
        controls.push(`
            ${currentPage < totalPages - 3 ? '<span class="page-info">...</span>' : ''}
            <button onclick="changePage(${totalPages})" class="page-button">${totalPages}</button>
        `);
    }

    controls.push(`
        <button 
            onclick="changePage(${currentPage + 1})" 
            class="page-button" 
            ${currentPage === totalPages ? 'disabled' : ''}>
            Next
        </button>
    `);

    return controls.join('');
}

async function changePage(newPage) {
    if (newPage < 1) return;

    try {
        // Attempt to fetch emails for the new page
        const emails = await listEmails(newPage, currentFilter);
        if (emails.length > 0) {
            currentPage = newPage; // Only update currentPage if emails are successfully fetched
            displayEmails(emails);
            document.getElementById('emailList').scrollTop = 0;
        } else {
            console.error('No emails returned for page:', newPage);
            alert('No emails found for this page.');
        }
    } catch (error) {
        console.error('Error changing page:', error);
        alert('Error loading emails. Please try again.');
    }
}

async function openEmail(emailId) {
    try {
        currentEmail = emailId;
        
        // Hide email tabs when viewing an email
        document.getElementById('email-tabs').style.display = 'none';

        // Get full email content
        const response = await gapi.client.gmail.users.messages.get({
            'userId': 'me',
            'id': emailId,
            'format': 'full'
        });

        const email = response.result;
        const headers = email.payload.headers;
        
        // Extract email metadata
        const subject = headers.find(header => header.name === 'Subject')?.value || '(no subject)';
        const from = headers.find(header => header.name === 'From')?.value || '';
        const date = headers.find(header => header.name === 'Date')?.value || '';

        // Get email body content
        let content = '';
        
        function getBody(payload) {
            if (payload.parts) {
                // Handle multipart message
                for (let part of payload.parts) {
                    if (part.mimeType === 'text/html') {
                        return decodeURIComponent(escape(atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'))));
                    }
                    if (part.mimeType === 'text/plain' && !content) {
                        content = decodeURIComponent(escape(atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'))));
                    }
                    if (part.parts) {
                        const nestedContent = getBody(part);
                        if (nestedContent) return nestedContent;
                    }
                }
                return content;
            } else if (payload.body.data) {
                // Handle single part message
                return decodeURIComponent(escape(atob(payload.body.data.replace(/-/g, '+').replace(/_/g, '/'))));
            }
            return '';
        }

        content = getBody(email.payload);

        // Display the email
        const emailViewer = document.getElementById('email-viewer');
        const emailContent = document.getElementById('email-viewer-content');
        
        emailContent.innerHTML = `
            <div class="email-full-header">
                <h1 class="email-full-subject">${subject}</h1>
                <div class="email-full-metadata">
                    <div>From: ${from}</div>
                    <div>Date: ${formatDate(new Date(date))}</div>
                </div>
            </div>
            <div class="email-full-body">${content}</div>
        `;

        emailViewer.style.display = 'block';
        document.getElementById('emailList').style.display = 'none';

    } catch (error) {
        console.error('Error opening email:', error);
        alert('Error opening email. Please try again.');
    }
}

function closeEmail() {
    document.getElementById('email-viewer').style.display = 'none';
    document.getElementById('emailList').style.display = 'block';
    document.getElementById('email-viewer-content').innerHTML = ''; // Clear content

    // Show email tabs when closing an email
    document.getElementById('email-tabs').style.display = 'flex';
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
    
    // Switch to primary tab immediately
    await switchTab('primary');
}

function deleteEmail(emailId) {
    console.log('Delete functionality coming soon');
}

// Function to open the compose modal
function openComposeModal(replyTo = null) {
    const modal = document.getElementById('compose-modal');
    const toField = document.getElementById('compose-to');
    const subjectField = document.getElementById('compose-subject');
    const bodyField = document.getElementById('compose-body');
    const modalTitle = modal.querySelector('.modal-header h2');
    
    if (replyTo) {
        modalTitle.textContent = 'Reply';
        toField.value = replyTo.from;
        subjectField.value = replyTo.subject;
        bodyField.value = ''; // Keep the compose body empty for replies
    } else {
        modalTitle.textContent = 'New Message';
        toField.value = '';
        subjectField.value = '';
        bodyField.value = '';
    }
    
    modal.style.display = 'block';
    setTimeout(() => modal.classList.add('show'), 10);
}

// Function to close the compose modal
function closeComposeModal() {
    const modal = document.getElementById('compose-modal');
    modal.classList.remove('show');
    // Wait for animation to finish before hiding
    setTimeout(() => modal.style.display = 'none', 300);
}

// Function to send an email
async function sendEmail() {
    try {
        const to = document.getElementById('compose-to').value;
        const subject = document.getElementById('compose-subject').value;
        const body = document.getElementById('compose-body').value;

        if (!to || !subject || !body) {
            alert('Please fill in all fields');
            return;
        }

        console.log('Sending email to:', to);
        console.log('Subject:', subject);

        // Create email content
        const emailContent = [
            `From: ${userEmail}`,
            `To: ${to}`,
            'Content-Type: text/plain; charset=utf-8',
            'MIME-Version: 1.0',
            `Subject: ${subject}`,
            '',
            body
        ].join('\r\n');

        console.log('Email content:', emailContent);

        // Base64 encode the email
        const encodedEmail = btoa(unescape(encodeURIComponent(emailContent)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

        console.log('Making API call...');

        const response = await gapi.client.gmail.users.messages.send({
            'userId': 'me',
            'resource': {
                'raw': encodedEmail
            }
        });

        console.log('API Response:', response);

        closeComposeModal();
        alert('Email sent successfully!');

    } catch (error) {
        console.error('Detailed error:', error);
        alert(`Error sending email: ${error.message || 'Unknown error'}`);
    }
}

// Ensure the compose button is correctly set up
document.querySelector('.compose-btn').onclick = () => openComposeModal();

// Helper function to add a timeout to a promise
function withTimeout(promise, timeout) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Request timed out')), timeout)
        )
    ]);
}

// Function to refresh emails with retry logic
async function refreshEmails(retryCount = 0) {
    try {
        // Show loading indicator
        document.getElementById('emailList').innerHTML = `
            <div style="text-align: center; padding: 20px;">
                <p>Loading emails...</p>
            </div>
        `;

        // Use the current filter to refresh emails with a timeout
        const emails = await withTimeout(listEmails(currentPage, currentFilter), 5000); // 5-second timeout
        if (emails.length > 0) {
            displayEmails(emails);
        } else {
            console.error('No emails returned during refresh.');
            document.getElementById('emailList').innerHTML = `
                <div style="text-align: center; padding: 20px; color: #d93025;">
                    <p>No emails found. Please try again.</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error refreshing emails:', error);

        // Retry logic
        if (retryCount < MAX_RETRY_ATTEMPTS) {
            console.log(`Retrying... (${retryCount + 1}/${MAX_RETRY_ATTEMPTS})`);
            setTimeout(() => refreshEmails(retryCount + 1), 2000); // Retry after 2 seconds
        } else {
            document.getElementById('emailList').innerHTML = `
                <div style="text-align: center; padding: 20px; color: #d93025;">
                    <p>Error refreshing emails. Please try again later.</p>
                </div>
            `;
        }
    }
}

// Add this new function for AI help with new messages
async function checkForAIHelp() {
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
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENAI_API_KEY}`
                },
                body: JSON.stringify({
                    model: "gpt-3.5-turbo",
                    messages: [{
                        role: "user",
                        content: `Help me write an email: ${prompt}`
                    }],
                    temperature: 0.7
                })
            });

            const data = await response.json();
            document.getElementById('ai-suggestion-1').textContent = 
                data.choices[0].message.content;
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
    const prompt = document.getElementById('ai-prompt').value;
    if (!prompt) {
        alert('Please describe the email you want to write');
        return;
    }

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-3.5-turbo",
                messages: [{
                    role: "system",
                    content: "You are an email writing assistant. Generate a complete email including a proper greeting at the start and a polite closing/signature at the end. Make it professional but friendly."
                }, {
                    role: "user",
                    content: prompt
                }],
                temperature: 0.7
            })
        });

        const data = await response.json();
        document.getElementById('compose-body').value = data.choices[0].message.content;
    } catch (error) {
        console.error('Error generating email:', error);
        alert('Error generating email. Please try again.');
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

function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const messages = document.getElementById('chat-messages');
    const userMessage = input.value.trim();
    
    if (!userMessage) return;
    
    // Add user message
    messages.innerHTML += `
        <div class="chat-message user">
            ${userMessage}
        </div>
    `;
    input.value = ''; // Clear input field

    // Simulate AI response
    setTimeout(() => {
        messages.innerHTML += `
            <div class="chat-message ai">
                I'm here to help! What would you like to know?
            </div>
        `;
        messages.scrollTop = messages.scrollHeight; // Scroll to the bottom
    }, 1000);
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
            'userId': 'me',
            'maxResults': EMAILS_PER_PAGE,
            'q': searchQuery
        });

        if (!response.result.messages) {
            displayEmails([]);
            return;
        }

        const emails = await Promise.all(response.result.messages.map(async message => {
            const emailDetails = await gapi.client.gmail.users.messages.get({
                'userId': 'me',
                'id': message.id,
                'format': 'metadata',
                'metadataHeaders': ['Subject', 'From', 'Date']
            });
            
            const headers = emailDetails.result.payload.headers;
            const isStarred = emailDetails.result.labelIds.includes('STARRED');
            const isImportant = emailDetails.result.labelIds.includes('IMPORTANT');

            return {
                id: message.id,
                subject: headers.find(header => header.name === 'Subject')?.value || '(no subject)',
                from: headers.find(header => header.name === 'From')?.value || '(no sender)',
                date: headers.find(header => header.name === 'Date')?.value || '',
                snippet: emailDetails.result.snippet || 'No preview available',
                isStarred,
                isImportant
            };
        }));

        displayEmails(emails);

    } catch (error) {
        console.error('Error performing search:', error);
        document.getElementById('emailList').innerHTML = `
            <div style="text-align: center; padding: 20px; color: #d93025;">
                <p>Error searching emails. Please try again.</p>
            </div>
        `;
    }
}

async function toggleStar(emailId, isCurrentlyStarred) {
    try {
        const labelAction = isCurrentlyStarred ? 'remove' : 'add';
        const labelId = 'STARRED';

        // Update the email's labels
        await gapi.client.gmail.users.messages.modify({
            'userId': 'me',
            'id': emailId,
            'resource': {
                [`${labelAction}LabelIds`]: [labelId]
            }
        });

        // Update the UI
        const starElement = document.querySelector(`.email-item[data-id="${emailId}"] .email-star`);
        if (starElement) {
            if (isCurrentlyStarred) {
                starElement.classList.remove('gold-star');
                starElement.innerHTML = '☆';
            } else {
                starElement.classList.add('gold-star');
                starElement.innerHTML = '<span class="gold-star">★</span>';
            }
        }

        console.log(`Email ${emailId} ${labelAction}ed to starred.`);
    } catch (error) {
        console.error('Error toggling star:', error);
    }
}

async function replyEmail(emailId) {
    try {
        const response = await gapi.client.gmail.users.messages.get({
            'userId': 'me',
            'id': emailId,
            'format': 'full'
        });

        const email = response.result;
        const headers = email.payload.headers;

        // Extract email details
        const fromHeader = headers.find(header => header.name === 'From')?.value || '';
        const emailMatch = fromHeader.match(/<(.+?)>/) || fromHeader.match(/[\w.-]+@[\w.-]+\.\w+/);
        const replyToEmail = emailMatch ? emailMatch[1] || emailMatch[0] : '';

        const subject = headers.find(header => header.name === 'Subject')?.value || '(no subject)';

        // Open compose modal with reply details
        openComposeModal({
            from: replyToEmail,
            subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`
        });

    } catch (error) {
        console.error('Error preparing reply:', error);
        alert('Error preparing reply. Please try again.');
    }
}

function ensureTabsVisible() {
    const emailTabs = document.querySelector('.email-tabs');
    if (emailTabs) {
        emailTabs.style.display = 'flex'; // Ensure tabs are visible
    }
}

async function switchTab(category) {
    console.log(`Switching to ${category} tab`);
    currentFilter = category;

    // Ensure tabs are visible
    ensureTabsVisible();

    // Update the search input placeholder based on the current tab
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.value = ''; // Clear the search input
        switch (category) {
            case 'starred':
            case 'important':
            case 'sent':
                searchInput.placeholder = `Search ${category} emails...`;
                // Hide category tabs when in sub-tabs
                document.querySelector('.email-tabs').style.display = 'none';
                break;
            default:
                searchInput.placeholder = 'Search emails...';
                // Show category tabs for main categories
                document.querySelector('.email-tabs').style.display = 'flex';
        }
    } else {
        console.error('Search input element not found');
    }

    try {
        // Update active tab
        document.querySelectorAll('.email-tab, .sub-nav-item').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelector(`.email-tab[onclick*="${category}"], .sub-nav-item[onclick*="${category}"]`).classList.add('active');

        // Show loading state
        document.getElementById('emailList').innerHTML = `
            <div style="text-align: center; padding: 20px;">
                <p>Loading ${category} emails...</p>
            </div>
        `;

        // Reset page and get initial count
        currentPage = 1;

        // Use Gmail's native category filter
        let query;
        switch (category) {
            case 'primary':
                query = 'category:primary';
                break;
            case 'promotions':
                query = 'category:promotions';
                break;
            case 'social':
                query = 'category:social';
                break;
            case 'updates':
                query = 'category:updates';
                break;
            case 'starred':
                query = 'is:starred';
                break;
            case 'important':
                query = 'is:important';
                break;
            case 'sent':
                query = 'in:sent';
                break;
            default:
                query = '';
        }

        console.log(`Querying emails with: ${query}`);

        // Get initial count of emails
        const countResponse = await gapi.client.gmail.users.messages.list({
            'userId': 'me',
            'maxResults': 500,
            'q': query
        });

        if (!countResponse.result.messages) {
            console.warn('No messages found for the query:', query);
            displayEmails([]);
            return;
        }

        totalEmails = countResponse.result.resultSizeEstimate || 0;

        // Get emails for the current page
        const response = await gapi.client.gmail.users.messages.list({
            'userId': 'me',
            'maxResults': EMAILS_PER_PAGE,
            'q': query,
            'orderBy': 'date'
        });

        if (!response.result.messages) {
            console.warn('No messages returned for the current page:', currentPage);
            displayEmails([]);
            return;
        }

        const emails = await Promise.all(response.result.messages.map(async message => {
            const emailDetails = await gapi.client.gmail.users.messages.get({
                'userId': 'me',
                'id': message.id,
                'format': 'metadata',
                'metadataHeaders': ['Subject', 'From', 'Date']
            });
            
            const headers = emailDetails.result.payload.headers;
            const isStarred = emailDetails.result.labelIds.includes('STARRED');
            const isImportant = emailDetails.result.labelIds.includes('IMPORTANT');

            return {
                id: message.id,
                subject: headers.find(header => header.name === 'Subject')?.value || '(no subject)',
                from: headers.find(header => header.name === 'From')?.value || '(no sender)',
                date: headers.find(header => header.name === 'Date')?.value || '',
                snippet: emailDetails.result.snippet || 'No preview available',
                isStarred,
                isImportant
            };
        }));

        displayEmails(emails);

    } catch (error) {
        console.error('Error switching tab:', error);
        document.getElementById('emailList').innerHTML = `
            <div style="text-align: center; padding: 20px; color: #d93025;">
                <p>Error loading emails. Please try again later.</p>
            </div>
        `;
    }
}

function getLabelId(category) {
    switch (category.toLowerCase()) {
        case 'primary':
            return 'CATEGORY_PERSONAL';
        case 'social':
            return 'CATEGORY_SOCIAL';
        case 'promotions':
            return 'CATEGORY_PROMOTIONS';
        case 'updates':
            return 'CATEGORY_UPDATES';
        default:
            return 'INBOX';
    }
}