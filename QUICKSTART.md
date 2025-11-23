# Quick Start Guide

## 1. Generate Icons (Optional but Recommended)

```bash
cd icons
python3 generate_icons.py
```

Or manually create 16x16, 48x48, and 128x128 pixel images named `icon16.png`, `icon48.png`, and `icon128.png`.

## 2. Load Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select the `WebNotes` folder

## 3. Set Up Notion OAuth (One-Time)

1. Go to https://www.notion.so/my-integrations
2. Click "New integration" → Select **"Public integration"** (OAuth)
3. Name it "WebNotes" and fill in the details
4. Copy the **Redirect URI** shown in the extension popup
5. Add this Redirect URI to your Notion integration settings
6. Copy your **OAuth Client ID** and **OAuth Client Secret**

## 4. Configure Extension

1. Click the WebNotes icon in Chrome
2. Paste your OAuth Client ID and Client Secret
3. Click "Save Credentials"

## 5. Connect to Notion

1. Click "🔗 Connect to Notion" button
2. Authorize the extension in Notion
3. Select your database from the dropdown
4. Click "Save Database"

**Note**: Create a database in Notion first if you don't have one. It should have these properties:
- Title (Title), URL (URL), Page Title (Text), Domain (Text), Date (Date), Highlight ID (Text)

## 6. Start Highlighting!

1. Click the extension icon
2. Click "Enable Highlighting"
3. Select text on any webpage
4. Click "Save to Notion"

Highlights will persist when you revisit pages!

