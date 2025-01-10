// Google API credentials
const CLIENT_ID = '226672443169-6sjeu8f2l6j1du0njr00eatcem6hk9p9.apps.googleusercontent.com';
const API_KEY = 'REDACTED_GOOGLE_API_KEY';

// Discovery doc URL for APIs used by the quickstart
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest';
const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly';

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
                scope: SCOPES,
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

    tokenClient.requestAccessToken();
}

async function handleAuthResponse(response) {
    if (response.error !== undefined) {
        console.error('Auth error:', response.error);
        return;
    }
    
    document.querySelector('.welcome-text').textContent = 'Loading your emails...';
    try {
        const emails = await listEmails();
        displayEmails(emails);
    } catch (error) {
        console.error('Error:', error);
        document.querySelector('.welcome-text').textContent = 'Error loading emails. Please try again.';
    }
}

async function listEmails(page = 1) {
    try {
        // Show loading state
        document.getElementById('emailList').innerHTML = `
            <div style="text-align: center; padding: 20px;">
                <p>Loading emails...</p>
            </div>
        `;

        // Get initial page token if needed
        if (page === 1) {
            const countResponse = await gapi.client.gmail.users.messages.list({
                'userId': 'me',
                'maxResults': 500,
                'labelIds': ['INBOX']
            });
            totalEmails = countResponse.result.resultSizeEstimate || 0;
            pageTokens[1] = ''; // First page has no token
            pageTokens[2] = countResponse.result.nextPageToken; // Store token for page 2
        }

        // Get emails for current page
        const response = await gapi.client.gmail.users.messages.list({
            'userId': 'me',
            'maxResults': EMAILS_PER_PAGE,
            'labelIds': ['INBOX'],
            'pageToken': page === 1 ? undefined : pageTokens[page]
        });

        // Store next page token
        if (response.result.nextPageToken) {
            pageTokens[page + 1] = response.result.nextPageToken;
        }

        if (!response.result.messages) {
            return [];
        }

        const emails = await Promise.all(response.result.messages.map(async message => {
            const emailDetails = await gapi.client.gmail.users.messages.get({
                'userId': 'me',
                'id': message.id,
                'format': 'metadata',
                'metadataHeaders': ['Subject', 'From', 'Date']
            });
            
            const headers = emailDetails.result.payload.headers;
            return {
                id: message.id,
                subject: headers.find(header => header.name === 'Subject')?.value || '(no subject)',
                from: headers.find(header => header.name === 'From')?.value || '(no sender)',
                date: headers.find(header => header.name === 'Date')?.value || '',
                snippet: emailDetails.result.snippet || 'No preview available'
            };
        }));
        
        return emails;
    } catch (error) {
        console.error('Error fetching emails:', error);
        document.getElementById('emailList').innerHTML = `
            <div style="text-align: center; padding: 20px; color: #d93025;">
                <p>Error loading emails. Please try again.</p>
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
    
    emailList.innerHTML = `
        <div class="email-list-header">
            <div class="email-count">
                Showing ${((currentPage - 1) * EMAILS_PER_PAGE) + 1}-${Math.min(currentPage * EMAILS_PER_PAGE, totalEmails)} 
                of ${totalEmails}
            </div>
        </div>
        ${emails.map(email => `
            <div class="email-item" onclick="openEmail('${email.id}')" style="cursor: pointer;">
                <input type="checkbox" class="email-checkbox" onclick="event.stopPropagation()">
                <span class="email-star" onclick="event.stopPropagation()">☆</span>
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
        currentPage = newPage;
        const emails = await listEmails(currentPage);
        if (emails.length > 0) {
            displayEmails(emails);
        } else {
            console.error('No emails returned for page:', newPage);
        }
    } catch (error) {
        console.error('Error changing page:', error);
    }
}

async function openEmail(emailId) {
    try {
        currentEmail = emailId;
        
        // Show loading state
        document.getElementById('email-viewer-content').innerHTML = `
            <div style="text-align: center; padding: 20px;">
                <p>Loading email...</p>
            </div>
        `;
        
        document.getElementById('emailList').style.display = 'none';
        const viewer = document.getElementById('email-viewer');
        viewer.style.display = 'block';

        const emailDetails = await gapi.client.gmail.users.messages.get({
            'userId': 'me',
            'id': emailId,
            'format': 'full'
        });
        
        const headers = emailDetails.result.payload.headers;
        let subject = headers.find(h => h.name === 'Subject')?.value || '';
        let from = headers.find(h => h.name === 'From')?.value || '';
        const date = headers.find(h => h.name === 'Date')?.value;
        
        // Safer decoding
        try {
            subject = decodeURIComponent(escape(subject));
            from = decodeURIComponent(escape(from));
        } catch (e) {
            console.log('Decode error:', e);
            // Use original values if decoding fails
        }

        let emailContent = '';
        const payload = emailDetails.result.payload;

        // Function to decode content safely
        const safeDecodeContent = (data) => {
            try {
                return decodeURIComponent(escape(atob(data.replace(/-/g, '+').replace(/_/g, '/'))));
            } catch (e) {
                console.log('Content decode error:', e);
                return atob(data.replace(/-/g, '+').replace(/_/g, '/'));
            }
        };

        // Handle different email formats
        if (payload.parts) {
            // Try to find HTML part first
            const htmlPart = payload.parts.find(part => 
                part.mimeType === 'text/html'
            );
            
            // Fallback to plain text
            const textPart = payload.parts.find(part => 
                part.mimeType === 'text/plain'
            );
            
            if (htmlPart && htmlPart.body.data) {
                emailContent = safeDecodeContent(htmlPart.body.data);
            } else if (textPart && textPart.body.data) {
                emailContent = safeDecodeContent(textPart.body.data);
                emailContent = emailContent.replace(/\n/g, '<br>');
            }

            // Handle nested parts (multipart emails)
            if (!emailContent) {
                for (const part of payload.parts) {
                    if (part.parts) {
                        const nestedHtmlPart = part.parts.find(p => p.mimeType === 'text/html');
                        const nestedTextPart = part.parts.find(p => p.mimeType === 'text/plain');
                        
                        if (nestedHtmlPart && nestedHtmlPart.body.data) {
                            emailContent = safeDecodeContent(nestedHtmlPart.body.data);
                            break;
                        } else if (nestedTextPart && nestedTextPart.body.data) {
                            emailContent = safeDecodeContent(nestedTextPart.body.data);
                            emailContent = emailContent.replace(/\n/g, '<br>');
                            break;
                        }
                    }
                }
            }
        } else if (payload.body.data) {
            emailContent = safeDecodeContent(payload.body.data);
        }

        // If still no content, show a message
        if (!emailContent) {
            emailContent = '<p>No readable content found in this email.</p>';
        }

        document.getElementById('email-viewer-content').innerHTML = `
            <div class="email-full-content">
                <div class="email-full-header">
                    <div class="email-full-subject">${subject}</div>
                    <div class="email-full-metadata">
                        <div>From: ${formatSender(from)}</div>
                        <div>Date: ${formatDate(new Date(date))}</div>
                    </div>
                </div>
                <div class="email-content-wrapper">
                    <div class="email-full-body">
                        ${emailContent}
                    </div>
                </div>
            </div>
        `;

        // Add this style to force white background
        const emailBody = document.querySelector('.email-full-body');
        if (emailBody) {
            emailBody.style.backgroundColor = 'white';
            emailBody.style.position = 'relative';
            emailBody.style.zIndex = '1';
        }
    } catch (error) {
        console.error('Error opening email:', error);
        document.getElementById('email-viewer-content').innerHTML = `
            <div style="text-align: center; padding: 20px; color: #d93025;">
                <p>Error loading email. Please try again.</p>
                <p style="font-size: 0.8em; color: #666;">Error details: ${error.message}</p>
            </div>
        `;
    }
}

function closeEmail() {
    // Clear current email
    currentEmail = null;
    
    // Clear content
    document.getElementById('email-viewer-content').innerHTML = '';
    
    // Switch views
    document.getElementById('email-viewer').style.display = 'none';
    document.getElementById('emailList').style.display = 'block';
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
    // First, close any open email
    closeEmail();
    
    if (section === 'home') {
        document.querySelector('.nav-item.active').classList.remove('active');
        document.querySelector('[onclick="switchSection(\'home\')"]').classList.add('active');
        
        // Show loading state
        document.getElementById('emailList').style.display = 'block'; // Make sure email list is visible
        document.getElementById('emailList').innerHTML = `
            <div style="text-align: center; padding: 20px;">
                <p>Analyzing your recent emails...</p>
            </div>
        `;

        try {
            // Get emails from last 7 days
            const response = await gapi.client.gmail.users.messages.list({
                'userId': 'me',
                'maxResults': 50,
                'labelIds': ['INBOX'],
                'q': 'newer_than:7d'
            });

            if (!response.result.messages) {
                displayHomeDashboard({ 
                    urgent: [], 
                    nonUrgent: [], 
                    summary: 'No emails found in the last 7 days.',
                    actionItems: []
                });
                return;
            }

            // Get full details of each email
            const emails = await Promise.all(response.result.messages.map(async message => {
                const emailDetails = await gapi.client.gmail.users.messages.get({
                    'userId': 'me',
                    'id': message.id,
                    'format': 'full'
                });
                
                const headers = emailDetails.result.payload.headers;
                return {
                    id: message.id,
                    subject: headers.find(h => h.name === 'Subject')?.value || '(no subject)',
                    from: headers.find(h => h.name === 'From')?.value || '(no sender)',
                    date: headers.find(h => h.name === 'Date')?.value || '',
                    snippet: emailDetails.result.snippet || ''
                };
            }));

            // Analyze emails with OpenAI
            const analysis = await analyzeEmails(emails);
            displayHomeDashboard(analysis);

        } catch (error) {
            console.error('Error loading home dashboard:', error);
            document.getElementById('emailList').innerHTML = `
                <div style="text-align: center; padding: 20px; color: #d93025;">
                    <p>Error analyzing emails. Please try again.</p>
                </div>
            `;
        }
    } else if (section === 'email') {
        document.querySelector('.nav-item.active').classList.remove('active');
        document.querySelector('[onclick="switchSection(\'email\')"]').classList.add('active');
        const emails = await listEmails();
        displayEmails(emails);
    }
}

function deleteEmail(emailId) {
    console.log('Delete functionality coming soon');
}

function replyEmail(emailId) {
    console.log('Reply functionality coming soon');
}

async function analyzeEmails(emails) {
    try {
        // Prepare email data for analysis
        const emailData = emails.map(email => ({
            subject: email.subject,
            from: email.from,
            snippet: email.snippet,
            date: email.date
        }));

        // Create prompt for OpenAI
        const prompt = `Analyze these recent emails and categorize them:
        ${JSON.stringify(emailData)}
        
        Provide a response in this JSON format:
        {
            "urgent": [{"subject": "...", "reason": "..."}],
            "nonUrgent": [{"subject": "...", "category": "..."}],
            "summary": "Brief overview of key patterns and important items",
            "actionItems": ["Action 1", "Action 2"]
        }`;

        // Call OpenAI API
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
                    content: prompt
                }],
                temperature: 0.7
            })
        });

        const data = await response.json();
        return JSON.parse(data.choices[0].message.content);
    } catch (error) {
        console.error('Error analyzing emails:', error);
        throw error;
    }
}

function displayHomeDashboard(analysis) {
    document.getElementById('emailList').innerHTML = `
        <div class="home-dashboard">
            <div class="dashboard-section">
                <h2>📊 Email Summary</h2>
                <p>${analysis.summary}</p>
            </div>
            
            <div class="dashboard-section">
                <h2>⚠️ Urgent Attention</h2>
                ${analysis.urgent.length > 0 ? `
                    <ul class="urgent-list">
                        ${analysis.urgent.map(item => `
                            <li>
                                <strong>${item.subject}</strong>
                                <span class="reason">${item.reason}</span>
                            </li>
                        `).join('')}
                    </ul>
                ` : '<p>No urgent emails</p>'}
            </div>

            <div class="dashboard-section">
                <h2>📥 Other Emails</h2>
                ${analysis.nonUrgent.length > 0 ? `
                    <ul class="non-urgent-list">
                        ${analysis.nonUrgent.map(item => `
                            <li>
                                <span class="category">${item.category}</span>
                                <span class="subject">${item.subject}</span>
                            </li>
                        `).join('')}
                    </ul>
                ` : '<p>No other emails</p>'}
            </div>

            <div class="dashboard-section">
                <h2>✅ Suggested Actions</h2>
                ${analysis.actionItems.length > 0 ? `
                    <ul class="action-list">
                        ${analysis.actionItems.map(item => `
                            <li>${item}</li>
                        `).join('')}
                    </ul>
                ` : '<p>No action items</p>'}
            </div>
        </div>
    `;
}
 