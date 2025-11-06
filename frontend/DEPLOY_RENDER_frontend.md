# Deploying Frontend to Render (Static Site)

This guide covers deploying the frontend as a static site on Render.

## Option 1: Render Static Site (Recommended)

1. Log in to [Render Dashboard](https://dashboard.render.com)
2. Click **"New +"** → **"Static Site"**
3. Connect your GitHub repository
4. Configure:
   - **Name**: `votingapp-frontend`
   - **Branch**: `main`
   - **Root Directory**: `frontend` ⚠️ **IMPORTANT**
   - **Build Command**: (leave empty - no build needed for plain HTML/JS)
   - **Publish Directory**: `.` (or leave empty)
5. Click **"Create Static Site"**
6. Once deployed, update `window.API_BASE` in all HTML files to point to your backend URL

## Option 2: GitHub Pages (Current Setup)

If using GitHub Pages:

1. Ensure `frontend/` folder contains all HTML/CSS/JS files
2. Set GitHub Pages to serve from `/frontend` directory
3. Update `window.API_BASE` in all HTML files:
   ```html
   <script>
       window.API_BASE = "https://your-backend-onrender.com";
   </script>
   ```
4. Commit and push changes
5. GitHub Pages will auto-deploy

## Setting API_BASE

After deployment, you need to set the backend URL in all HTML files:

### Files to Update:
- `frontend/index.html`
- `frontend/Auth/login.html`
- `frontend/Vote/index.html`
- `frontend/Chart/index.html`
- `frontend/admin/login.html`
- `frontend/admin/dashboard.html`

### Update Pattern:
Replace:
```html
<script>
    window.API_BASE = window.API_BASE || window.location.origin;
</script>
```

With:
```html
<script>
    window.API_BASE = "https://your-backend-service.onrender.com";
</script>
```

## Testing

1. Open your deployed frontend URL
2. Open browser DevTools (F12)
3. Go to **Network** tab
4. Try logging in
5. Verify API requests go to your backend URL (not localhost)
6. Check for CORS errors in console

## Troubleshooting

### CORS Errors
- Verify backend `FRONTEND_URL` matches your frontend URL exactly
- Check backend logs for CORS configuration
- Ensure backend allows your frontend origin

### API Not Found
- Verify `window.API_BASE` is set correctly
- Check browser console for API calls
- Verify backend is running and accessible

### Static Assets Not Loading
- Verify `Root Directory` is set to `frontend`
- Check file paths are relative (use `../` for parent directories)
- Verify all assets are committed to repository

