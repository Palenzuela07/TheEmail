// Google API credentials
const CLIENT_ID = '226672443169-6sjeu8f2l6j1du0njr00eatcem6hk9p9.apps.googleusercontent.com';
const API_KEY = 'REDACTED_GOOGLE_API_KEY';

// Discovery doc URL for APIs used by the quickstart
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest';
const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly';

let tokenClient;
let gapiInited = false;
let gisInited = false;
let currentPage = 1;
const EMAILS_PER_PAGE = 50;
let totalEmails = 0;
let pageTokens = {};
let nextPageToken = null;

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

        // First request to get total emails
        if (page === 1) {
            const countResponse = await gapi.client.gmail.users.messages.list({
                'userId': 'me',
                'maxResults': 500,
                'labelIds': ['INBOX']
            });
            totalEmails = countResponse.result.resultSizeEstimate || 0;
            nextPageToken = countResponse.result.nextPageToken;
        }

        // Get emails for the requested page
        const response = await gapi.client.gmail.users.messages.list({
            'userId': 'me',
            'maxResults': EMAILS_PER_PAGE,
            'labelIds': ['INBOX'],
            'pageToken': page === 1 ? undefined : pageTokens[page]
        });

        // Store the next page token
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
        const emailDetails = await gapi.client.gmail.users.messages.get({
            'userId': 'me',
            'id': emailId,
            'format': 'full'
        });
        
        document.getElementById('emailList').style.display = 'none';
        const viewer = document.getElementById('email-viewer');
        viewer.style.display = 'block';
        
        const headers = emailDetails.result.payload.headers;
        const subject = decodeEmailText(headers.find(h => h.name === 'Subject')?.value);
        const from = decodeEmailText(headers.find(h => h.name === 'From')?.value);
        const date = headers.find(h => h.name === 'Date')?.value;
        
        let emailContent = '';
        if (emailDetails.result.payload.parts) {
            const htmlPart = emailDetails.result.payload.parts.find(part => 
                part.mimeType === 'text/html'
            );
            const textPart = emailDetails.result.payload.parts.find(part => 
                part.mimeType === 'text/plain'
            );
            
            if (htmlPart && htmlPart.body.data) {
                emailContent = decodeEmailText(atob(htmlPart.body.data.replace(/-/g, '+').replace(/_/g, '/')));
            } else if (textPart && textPart.body.data) {
                emailContent = decodeEmailText(atob(textPart.body.data.replace(/-/g, '+').replace(/_/g, '/')));
                emailContent = emailContent.replace(/\n/g, '<br>');
            }

            // Handle inline images
            if (emailDetails.result.payload.parts) {
                for (const part of emailDetails.result.payload.parts) {
                    if (part.mimeType && part.mimeType.startsWith('image/')) {
                        if (part.body.attachmentId) {
                            try {
                                const attachment = await gapi.client.gmail.users.messages.attachments.get({
                                    'userId': 'me',
                                    'messageId': emailId,
                                    'id': part.body.attachmentId
                                });
                                const imageData = attachment.result.data;
                                // Replace inline image references
                                emailContent = emailContent.replace(
                                    new RegExp(`cid:${part.contentId || part.partId}`, 'g'),
                                    `data:${part.mimeType};base64,${imageData}`
                                );
                            } catch (error) {
                                console.error('Error loading image:', error);
                            }
                        }
                    }
                }
            }
        } else if (emailDetails.result.payload.body.data) {
            emailContent = decodeEmailText(atob(emailDetails.result.payload.body.data.replace(/-/g, '+').replace(/_/g, '/')));
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
                <div class="email-full-body">
                    ${emailContent}
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Error opening email:', error);
    }
}

function closeEmail() {
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
 