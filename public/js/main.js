// Add at the very top of the file
let selectedEmails = new Set();

document.addEventListener('DOMContentLoaded', () => {
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
        const composeButton = document.querySelector('.compose-btn');
        if (composeButton) {
            composeButton.addEventListener('click', openComposeModal);
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

// OpenAI API key from environment variables
let OPENAI_API_KEY;
let conversationHistory = [{
    role: "system",
    content: "You are a helpful email assistant. Help users compose professional emails. Remember previous parts of the conversation and maintain context. Be concise but thorough in your responses."
}];

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
        
        document.getElementById('user-greeting').textContent = `Hi, ${userEmail}`;
        document.getElementById('login-container').style.display = 'none';
        document.getElementById('app').style.display = 'block';
        
        // Show email tabs
        document.querySelector('.email-tabs').style.display = 'flex';
        
        // Switch to primary tab immediately after login
        console.log('Switching to primary tab...');
        await switchTab('primary');
        
        // After successful login, clear any previous email drafts and chat history
        localStorage.removeItem('chatHistory');
        
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
            content: "You are a helpful email assistant. Help users compose professional emails. Remember previous parts of the conversation and maintain context. Be concise but thorough in your responses."
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

            // Fetch full details for each message
            const messages = await Promise.all(
                response.result.messages.map(async (message) => {
                    const fullMessage = await gapi.client.gmail.users.messages.get({
                        userId: 'me',
                        id: message.id,
                        format: 'full'
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

function getQueryForFilter(filter) {
    switch (filter) {
        case 'starred':
            return 'is:starred';
        case 'important':
            return 'is:important';
        case 'sent':
            return 'in:sent';
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
            const isRead = !email.labelIds.includes('UNREAD');
            if (isRead) {
                emailItem.classList.add('email-read');
            }
            
            // Check if email is starred
            const isStarred = email.labelIds.includes('STARRED');
            
            // Safely get headers
            const fromHeader = email.payload.headers ? email.payload.headers.find(h => h.name === 'From') : null;
            const subjectHeader = email.payload.headers ? email.payload.headers.find(h => h.name === 'Subject') : null;
            const dateHeader = email.payload.headers ? email.payload.headers.find(h => h.name === 'Date') : null;
            
            const from = fromHeader ? fromHeader.value : 'Unknown';
            const subject = subjectHeader ? subjectHeader.value : 'No Subject';
            const date = dateHeader ? dateHeader.value : '';
            
            emailItem.innerHTML = `
                <input type="checkbox" class="email-checkbox" onchange="handleEmailSelection('${email.id}', this)">
                <div class="email-star" onclick="event.stopPropagation(); toggleStar('${email.id}', ${isStarred})" style="cursor: pointer;">
                    ${isStarred ? '<span class="gold-star">⭐</span>' : '☆'}
                </div>
                <div class="email-important" onclick="event.stopPropagation(); toggleImportant('${email.id}', ${email.labelIds.includes('IMPORTANT')})" style="cursor: pointer;">
                    ${email.labelIds.includes('IMPORTANT') ? '❗' : '❕'}
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
        currentEmail = emailId;
        
        // Hide email tabs when viewing an email
        document.getElementById('email-tabs').style.display = 'none';

        // Mark the email as read when opened
        await markAsRead(emailId);
        
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
    console.log("Closing email and returning to list view");
    document.getElementById('email-viewer').style.display = 'none';
    document.getElementById('emailList').style.display = 'block';
    document.getElementById('email-viewer-content').innerHTML = ''; // Clear content
    
    // Show email tabs again
    document.getElementById('email-tabs').style.display = 'flex';
    
    // Refresh the email list to reflect read status changes - use force refresh
    console.log("Triggering force refresh to update read status");
    refreshEmails(0, true);
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
    const settingsContainer = document.getElementById('ai-settings-container');
    if (settingsContainer) {
        settingsContainer.style.display = 'none';
    }
    
    // Update active states
    document.querySelectorAll('.nav-item, .sub-nav-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector('.nav-item[onclick*="switchSection"]').classList.add('active');
    
    // Switch to primary tab immediately
    await switchTab('primary');
}

function deleteEmail(emailId) {
    console.log('Delete functionality coming soon');
}

// Function to reset AI chat
function resetAIChat() {
    const chatMessages = document.getElementById('chat-messages');
    
    // Try to load previous conversation history
    const savedHistory = localStorage.getItem('chatHistory');
    
    if (savedHistory) {
        try {
            // Limit history to last 10 messages for performance
            conversationHistory = JSON.parse(savedHistory);
            
            // If history is too long, keep system prompt and last 10 exchanges
            if (conversationHistory.length > 21) {
                const systemPrompt = conversationHistory[0];
                conversationHistory = [
                    systemPrompt,
                    ...conversationHistory.slice(conversationHistory.length - 20)
                ];
            }
            
            // Rebuild UI from history (last 6 messages for UI clarity)
            const displayMessages = conversationHistory.slice(Math.max(0, conversationHistory.length - 6));
            
            chatMessages.innerHTML = '';
            displayMessages.forEach(msg => {
                if (msg.role === 'user') {
                    chatMessages.innerHTML += `
                        <div class="chat-message user">${msg.content}</div>
                    `;
                } else if (msg.role === 'assistant') {
                    chatMessages.innerHTML += `
                        <div class="chat-message ai">${msg.content}</div>
                    `;
                }
            });
            
            // If no visible messages (only system prompt), add welcome message
            if (displayMessages.length <= 1) {
                chatMessages.innerHTML = `
                    <div class="chat-message ai">
                        How can I help you with your emails today?
                    </div>
                `;
            }
        } catch (e) {
            console.error('Error loading chat history:', e);
            // Fallback to default welcome message
            chatMessages.innerHTML = `
                <div class="chat-message ai">
                    How can I help you with your emails today?
                </div>
            `;
            // Reset conversation history to just system prompt
            conversationHistory = [{
                role: "system",
                content: "You are a helpful email assistant. Help users compose professional emails. Remember previous parts of the conversation and maintain context. Be concise but thorough in your responses."
            }];
        }
    } else {
        // No history found, set default welcome message
        chatMessages.innerHTML = `
            <div class="chat-message ai">
                How can I help you with your emails today?
            </div>
        `;
        // Initialize conversation history with welcome message
        conversationHistory = [
            {
                role: "system",
                content: "You are a helpful email assistant. Help users compose professional emails. Remember previous parts of the conversation and maintain context. Be concise but thorough in your responses."
            },
            {
                role: "assistant",
                content: "How can I help you with your emails today?"
            }
        ];
    }

    // Add this at the end of resetAIChat function
    const chatInput = document.getElementById('chat-input');
    chatInput.addEventListener('keypress', handleChatKeyPress);
}

// Update sendChatMessage function to add confirmation handling
async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const messages = document.getElementById('chat-messages');
    const userMessage = input.value.trim();
    
    if (!userMessage) return;
    
    try {
        // Add user message to UI
        messages.innerHTML += `
            <div class="chat-message user">
                ${userMessage}
            </div>
        `;
        input.value = ''; // Clear input field
        
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
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                message: userMessage,
                history: conversationHistory,
                timestamp: new Date().toISOString() // Add current timestamp
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

        // Check if response contains an email
        if (containsEmailFormat(aiResponse)) {
            console.log("Email detected in response");
            // Store email content globally
            window.lastGeneratedEmail = aiResponse;
            window.awaitingEmailConfirmation = true;
            
            // Add a visible confirmation question
            messages.innerHTML += `
                <div class="chat-message ai confirmation-prompt" style="margin-top: 10px; color: #1a73e8; font-weight: bold;">
                    Would you like me to move this email to the compose area? (Yes/No)
                </div>
            `;
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
    // Check for common email components - make more lenient
    return (
        // Check for subject line
        (text.includes("Subject:") || text.includes("SUBJECT:")) &&
        
        // Check for greeting - more options
        (text.includes("Dear") || text.includes("Hello") || text.includes("Hi") || 
         text.includes("Hey") || text.includes("Greetings")) &&
        
        // Check for closing - more options
        (text.includes("Sincerely") || text.includes("Best") || text.includes("Regards") || 
         text.includes("Thank you") || text.includes("Thanks") || text.includes("Cheers") ||
         text.includes("Yours") || text.includes("Warm") || text.includes("See you"))
    );
}

// Simplify handleChatKeyPress to focus on confirmation
function handleChatKeyPress(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        
        const input = document.getElementById('chat-input');
        const userMessage = input.value.trim();
        
        if (!userMessage) return;
        
        // If awaiting confirmation for email
        if (window.awaitingEmailConfirmation === true) {
            console.log("Processing confirmation response:", userMessage);
            
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
            
            if (isConfirmation) {
                console.log("Confirmation received, moving to compose");
                // Move content to compose area
                moveEmailToCompose(window.lastGeneratedEmail);
                
                // Show confirmation message
                messages.innerHTML += `
                    <div class="chat-message ai">
                        I've moved the email to the compose area for you.
                    </div>
                `;
            } else {
                console.log("Non-confirmation received, continuing chat");
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

// Function to move the email to the compose area
function moveEmailToCompose(emailContent) {
    // Extract subject if present
    let subject = '';
    const subjectMatch = emailContent.match(/Subject: (.*?)(?:\n|$)/);
    if (subjectMatch) {
        subject = subjectMatch[1].trim();
    }
    
    // Remove the Subject line from the email body
    let bodyContent = emailContent;
    if (subjectMatch) {
        bodyContent = bodyContent.replace(/Subject:.*?\n/, '');
    }
    
    // Set the values
    document.getElementById('compose-subject').value = subject;
    document.getElementById('compose-body').value = bodyContent;
}

// Update the openComposeModal function to add the event listener
function openComposeModal(replyTo = null) {
    const modal = document.getElementById('compose-modal');
    const toField = document.getElementById('compose-to');
    const subjectField = document.getElementById('compose-subject');
    const bodyField = document.getElementById('compose-body');
    const modalTitle = modal.querySelector('.modal-header h2');
    
    // Reset AI chat
    resetAIChat();
    
    // Add event listener for Enter key in chat input
    const chatInput = document.getElementById('chat-input');
    chatInput.addEventListener('keypress', handleChatKeyPress);
    
    if (replyTo) {
        modalTitle.textContent = 'Reply';
        toField.value = replyTo.from || ''; // Ensure it's an empty string if undefined
        subjectField.value = replyTo.subject || ''; // Ensure it's an empty string if undefined
        bodyField.value = '';
    } else {
        modalTitle.textContent = 'New Message';
        toField.value = ''; // Set to empty string
        subjectField.value = ''; // Set to empty string
        bodyField.value = '';
    }
    
    modal.style.display = 'block';
    setTimeout(() => modal.classList.add('show'), 10);
}

// Update closeComposeModal to remove the event listener
function closeComposeModal() {
    const modal = document.getElementById('compose-modal');
    const chatInput = document.getElementById('chat-input');
    chatInput.removeEventListener('keypress', handleChatKeyPress);
    
    // Clear chat history when compose window is closed
    localStorage.removeItem('chatHistory');
    conversationHistory = [{
        role: "system",
        content: "You are a helpful email assistant. Help users compose professional emails. Remember previous parts of the conversation and maintain context. Be concise but thorough in your responses."
    }];
    
    modal.classList.remove('show');
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
});

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

function moveLastAIMessageToCompose(messages) {
    // Find the last AI message that looks like an email
    let emailContent = null;
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message.role === 'assistant' && 
            message.content.includes('Subject:') && 
            !message.content.includes('Would you like me to') &&
            !message.content.includes('I\'ve moved')) {
            emailContent = message.content;
            break;
        }
    }

    if (!emailContent) {
        console.log('No email content found in messages');
        return false;
    }

    // Extract subject and body
    const subjectMatch = emailContent.match(/Subject: (.*?)(?:\n|$)/);
    const subject = subjectMatch ? subjectMatch[1].trim() : '';

    // Get everything after "Subject: " line
    const bodyStartIndex = emailContent.indexOf('\n', emailContent.indexOf('Subject:'));
    const body = bodyStartIndex !== -1 ? emailContent.substring(bodyStartIndex).trim() : emailContent;

    // Set the values in the compose modal
    document.getElementById('compose-subject').value = subject;
    document.getElementById('compose-body').value = body;

    console.log('Email content moved to compose area:', { subject, body });
    return true;
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
        const emailBody = getBody(email.payload);

        // Update the compose modal with email details
        document.getElementById('compose-to').value = replyToEmail;
        document.getElementById('compose-subject').value = `Re: ${subject}`;

        // Generate AI response
        const aiResponse = await generateAIReply(emailBody);

        // Replace loading message with AI response and new question
        messages.innerHTML = `
            <div class="chat-message ai">
                ${formatEmailContent(aiResponse)}
            </div>
            <div class="chat-message ai">
                Is this reply good to move to compose, or would you like me to make more changes?
            </div>
        `;
        messages.scrollTop = messages.scrollHeight;

        // Listen for user input
        const chatInput = document.getElementById('chat-input');
        chatInput.addEventListener('keypress', function handleUserResponse(event) {
            if (event.key === 'Enter') {
                const userResponse = chatInput.value.trim().toLowerCase();
                console.log('User response:', userResponse); // Debugging log
                chatInput.value = ''; // Clear input field

                if (userResponse.includes('yes') || userResponse.includes('good') || userResponse.includes('move')) {
                    console.log('Moving AI response to compose window'); // Debugging log
                    moveToCompose(aiResponse);
                    messages.innerHTML += `
                        <div class="chat-message ai">
                            Great! I've moved the reply to the compose window.
                        </div>
                    `;
                } else {
                    messages.innerHTML += `
                        <div class="chat-message ai">
                            Okay, let me know if you need any changes.
                        </div>
                    `;
                }
                messages.scrollTop = messages.scrollHeight;
                chatInput.removeEventListener('keypress', handleUserResponse); // Remove listener after handling
            }
        });

    } catch (error) {
        console.error('Error preparing reply:', error);
        alert('Error preparing reply. Please try again.');
    }
}

function getBody(payload) {
    let content = '';
    if (payload.parts) {
        for (let part of payload.parts) {
            if (part.mimeType === 'text/plain' && part.body.data) {
                content += decodeURIComponent(escape(atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'))));
            }
            if (part.parts) {
                content += getBody(part);
            }
        }
    } else if (payload.body.data) {
        content = decodeURIComponent(escape(atob(payload.body.data.replace(/-/g, '+').replace(/_/g, '/'))));
    }
    return content;
}

async function generateAIReply(emailBody) {
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
                    content: "You are an email assistant. Generate a polite and professional reply."
                }, {
                    role: "user",
                    content: `Reply to this email: ${emailBody}`
                }],
                temperature: 0.7
            })
        });

        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        console.error('Error generating AI reply:', error);
        return 'Error generating reply. Please try again.';
    }
}

function moveToCompose(aiResponse) {
    console.log('Setting compose body with AI response'); // Debugging log
    document.getElementById('compose-body').value = aiResponse;
    // Ensure the compose modal is open
    const modal = document.getElementById('compose-modal');
    if (!modal.classList.contains('show')) {
        openComposeModal();
    }
}

// Utility function to escape HTML
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
        
        // ENHANCED: Clear active class from all tabs first
        const allTabs = document.querySelectorAll('.email-tab, .sub-nav-item');
        allTabs.forEach(tab => tab.classList.remove('active'));
        
        // ENHANCED: Set active class on the correct email category tab
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
        
        // ENHANCED: Set active class on sidebar items
        const sidebarItems = document.querySelectorAll('.sub-nav-item');
        sidebarItems.forEach(item => {
            const itemText = item.textContent.trim().toLowerCase();
            
            if (itemText.includes(category.toLowerCase())) {
                item.classList.add('active');
                console.log("Set active class on sidebar item:", itemText);
            }
        });
        
        // Hide AI settings if visible
        const aiSettingsContainer = document.getElementById('ai-settings-container');
        if (aiSettingsContainer) {
            aiSettingsContainer.style.display = 'none';
        }
        
        // Show email list and tabs
        document.getElementById('emailList').style.display = 'block';
        
        // Hide category tabs for sub-tabs
        const emailTabsContainer = document.getElementById('email-tabs');
        if (['starred', 'important', 'sent'].includes(category)) {
            emailTabsContainer.style.display = 'none';
        } else {
            emailTabsContainer.style.display = 'flex';
        }
        
        document.querySelector('.search-bar').style.display = 'flex';
        
        // Hide email viewer if open
        document.getElementById('email-viewer').style.display = 'none';
        
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

// Add this function to handle AI settings click
function openAISettings() {
    // Hide email list, viewer, tabs, and search bar
    document.getElementById('emailList').style.display = 'none';
    document.getElementById('email-viewer').style.display = 'none';
    document.getElementById('email-tabs').style.display = 'none';
    document.querySelector('.search-bar').style.display = 'none';
    
    // Get or create settings container
    let settingsContainer = document.getElementById('ai-settings-container');
    if (!settingsContainer) {
        settingsContainer = document.createElement('div');
        settingsContainer.id = 'ai-settings-container';
        document.querySelector('.main-content').appendChild(settingsContainer);
    }
    
    // Update settings content without back button
    settingsContainer.innerHTML = `
        <div class="settings-header">
            <h2>AI Settings</h2>
        </div>
        <div class="settings-content">
            <p>AI Settings page - Coming soon</p>
        </div>
    `;
    
    settingsContainer.style.display = 'block';
    
    // Update active state in navigation - include both nav-item and sub-nav-item
    document.querySelectorAll('.nav-item, .sub-nav-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector('.nav-item[onclick*="openAISettings"]').classList.add('active');
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
    
    // Reset active state in navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector('.nav-item[onclick*="switchSection"]').classList.add('active');
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

// Replace the formatEmailContent function with this simplified version
function formatEmailContent(content) {
  // Simply return the content without any formatting
  return content;
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