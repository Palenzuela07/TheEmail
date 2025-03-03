const express = require('express');
const app = express();
const path = require('path');

// Add Content Security Policy and cache control middleware
app.use((req, res, next) => {
    // Set Content Security Policy headers
    res.set({
        'Content-Security-Policy': "default-src 'self' https://apis.google.com https://accounts.google.com https://www.googleapis.com https://www.gstatic.com; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://accounts.google.com https://www.gstatic.com; style-src 'self' 'unsafe-inline' https://www.gstatic.com; img-src 'self' data: https: blob:; connect-src 'self' https://apis.google.com https://accounts.google.com https://www.googleapis.com https://www.gstatic.com; frame-src https://accounts.google.com https://content.googleapis.com;",
        // Cache control headers
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Surrogate-Control': 'no-store'
    });
    next();
});

// Serve static files from the current directory
app.use(express.static(__dirname));

// Serve index.html for the root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 