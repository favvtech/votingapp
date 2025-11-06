# Deploying to Render - Backend

This guide walks you through deploying the voting app backend to Render with PostgreSQL.

## Prerequisites

- A Render account (free tier works)
- A GitHub repository with your code
- Basic familiarity with Render dashboard

## Step 1: Create PostgreSQL Database

1. Log in to [Render Dashboard](https://dashboard.render.com)
2. Click **"New +"** → **"PostgreSQL"**
3. Configure:
   - **Name**: `votingapp-db` (or your preferred name)
   - **Database**: `votingapp` (or your preferred name)
   - **User**: Auto-generated (or customize)
   - **Region**: Choose closest to your users
   - **PostgreSQL Version**: Latest stable (recommended)
   - **Instance Type**: **Free** (for testing) or **Starter** (for production)
4. Click **"Create Database"**
5. Wait for database to be provisioned (1-2 minutes)

## Step 2: Copy Database URL

1. Once the database is ready, click on it in your dashboard
2. Find the **"Internal Database URL"** section
3. Click **"Copy"** to copy the connection string
   - Format: `postgresql://user:password@host:port/dbname`
   - **Important**: Use the **Internal Database URL** (not External) for Render services
4. Save this URL - you'll need it in the next step

## Step 3: Create Web Service (Backend)

1. In Render Dashboard, click **"New +"** → **"Web Service"**
2. Connect your GitHub repository:
   - Click **"Connect account"** if not already connected
   - Select your repository
   - Click **"Connect"**
3. Configure the service:

   ### Basic Settings
   - **Name**: `votingapp-backend` (or your preferred name)
   - **Region**: Same as database (recommended)
   - **Branch**: `main` (or your deployment branch)
   - **Root Directory**: `server` ⚠️ **IMPORTANT**
   - **Runtime**: `Python 3`
   - **Instance Type**: **Free** (for testing)

   ### Build & Deploy
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --threads 8 --timeout 120`

   ### Environment Variables
   Click **"Add Environment Variable"** and add:

   ```
   DATABASE_URL = <paste the Internal Database URL from Step 2>
   SECRET_KEY = <generate a long random string>
   FRONTEND_URL = https://your-frontend-url.com
   FORCE_HTTPS = 1
   FLASK_ENV = production
   ```

   **To generate SECRET_KEY:**
   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

4. Click **"Create Web Service"**
5. Wait for first deployment (2-5 minutes)

## Step 4: Initialize Database Tables

1. Once the service is deployed, go to the service dashboard
2. Click **"Shell"** tab (or use **"Render Shell"** from the service menu)
3. Run:
   ```bash
   python manage_db.py
   ```
4. You should see: `✓ PostgreSQL tables created successfully using SQLAlchemy`

## Step 5: Verify Deployment

1. Check service logs:
   - Go to **"Logs"** tab
   - Look for: `SQLAlchemy configured with PostgreSQL`
   - Look for: `CORS configured for frontend: <your-frontend-url>`
2. Test the API:
   - Your service URL will be: `https://your-service-name.onrender.com`
   - Test endpoint: `https://your-service-name.onrender.com/api/check-session`
   - Should return: `{"logged_in": false}`

## Step 6: Update Frontend

1. In your frontend code, set `window.API_BASE` to your backend URL:
   ```javascript
   window.API_BASE = "https://your-service-name.onrender.com";
   ```
2. Deploy frontend (GitHub Pages, Render Static Site, or your preferred host)
3. Update `FRONTEND_URL` in backend environment variables to match your frontend URL

## Troubleshooting

### Service won't start
- Check **Logs** tab for errors
- Verify `Root Directory` is set to `server`
- Verify `Start Command` uses `gunicorn app:app`
- Check that all environment variables are set

### Database connection errors
- Verify `DATABASE_URL` uses **Internal Database URL** (not External)
- Check that database and service are in the same region
- Verify database is not paused (free tier pauses after inactivity)

### CORS errors
- Verify `FRONTEND_URL` matches your actual frontend URL exactly
- Check browser console for CORS error details
- Ensure `FORCE_HTTPS=1` if using HTTPS frontend

### Tables not created
- Run `python manage_db.py` in Render Shell
- Check logs for SQLAlchemy errors
- Verify `DATABASE_URL` is correct

## Free Tier Notes

- **Cold starts**: Free tier services spin down after 15 minutes of inactivity. First request may take 30-60 seconds
- **Database**: Free PostgreSQL pauses after 90 days of inactivity
- **Limits**: 750 hours/month for free tier services

## Production Recommendations

For production, consider:
- Upgrade to **Starter** instance type ($7/month) for better performance
- Use **Starter** PostgreSQL ($7/month) for better reliability
- Set up **Auto-Deploy** from main branch
- Configure **Health Checks** in Render
- Set up monitoring and alerts

## Support

- Render Docs: https://render.com/docs
- Render Community: https://community.render.com

