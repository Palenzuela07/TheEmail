# Google Analytics Troubleshooting Guide

## Issue: "Data collection isn't active for your website"

If you're seeing this message, follow these steps:

### Step 1: Verify the Code is in the HTML

1. Open your website in a browser
2. Right-click → "View Page Source" (or press Ctrl+U / Cmd+Option+U)
3. Search for "G-ESLSG5GVJQ" - you should see the Google Analytics code
4. Verify it's in the `<head>` section

### Step 2: Check Browser Console for Errors

1. Open Developer Tools (F12 or Cmd+Option+I)
2. Go to the Console tab
3. Look for any errors related to:
   - Content Security Policy (CSP)
   - Google Analytics
   - Script loading

### Step 3: Check Network Tab

1. Open Developer Tools → Network tab
2. Reload the page
3. Filter by "gtag" or "analytics"
4. You should see requests to:
   - `https://www.googletagmanager.com/gtag/js?id=G-ESLSG5GVJQ`
   - `https://www.google-analytics.com/g/collect` or similar

If you see blocked requests, it's a CSP issue.

### Step 4: Test with Browser Extension

Install the "Google Tag Assistant" Chrome extension:
- https://chrome.google.com/webstore/detail/tag-assistant-legacy-by-g/kejbdjndbnbjgmefkgdddjlbokphdefk

This will show you if the tag is firing correctly.

### Step 5: Verify Server is Running

Make sure your server is running and serving the updated files:
```bash
npm start
```

### Step 6: Clear Browser Cache

Sometimes cached versions don't have the analytics code:
- Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
- Or clear browser cache completely

### Step 7: Check Real-Time Reports

1. Go to Google Analytics dashboard
2. Navigate to Reports → Realtime
3. Visit your website
4. You should see yourself appear in real-time (may take 30-60 seconds)

### Common Issues and Fixes

#### Issue: CSP Blocking Scripts
**Symptom**: Console shows CSP violation errors
**Fix**: Already updated in server.js - restart your server

#### Issue: Script Not Loading
**Symptom**: Network tab shows failed/blocked requests
**Fix**: 
- Check if you're using HTTPS (required for production)
- Verify firewall isn't blocking Google domains
- Check if ad blockers are interfering (try incognito mode)

#### Issue: Wrong Measurement ID
**Symptom**: Code is there but no data
**Fix**: Double-check the ID is `G-ESLSG5GVJQ` in both HTML files

#### Issue: EJS Template Not Rendering
**Symptom**: You see `<%= GOOGLE_CLIENT_ID %>` in page source
**Fix**: The server uses `res.sendFile` which serves static files. The Google Analytics code doesn't use EJS, so this shouldn't be an issue, but if you see template syntax, you need to use `res.render` instead.

### Quick Test Script

Add this to your browser console to test if gtag is loaded:
```javascript
if (typeof gtag !== 'undefined') {
    console.log('✅ Google Analytics is loaded!');
    gtag('event', 'test_event', {
        'event_category': 'Test',
        'event_label': 'Manual Test'
    });
} else {
    console.error('❌ Google Analytics is NOT loaded');
}
```

### Still Not Working?

1. **Wait 24-48 hours**: Sometimes Google Analytics takes time to show data
2. **Check property settings**: Make sure the property is active in Google Analytics
3. **Verify domain**: Make sure the domain in GA matches your actual domain
4. **Check filters**: Make sure you're not filtering out your own traffic

### Alternative: Use Google Tag Manager

If direct gtag.js isn't working, consider using Google Tag Manager instead, which is more flexible and easier to debug.

