# WebNotes - Chrome Extension

A Chrome extension that allows you to highlight text on any website and save it to your personal Notion database. Highlights persist across page visits.

## Features

- ✨ Highlight text on any webpage
- 💾 Save highlights to your Notion database
- 🔄 Persistent highlights that appear when you revisit pages
- 🎨 Visual highlighting with hover effects
- 🗑️ Delete highlights directly from the page

## Setup Instructions

### 1. Install the Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in the top right)
3. Click "Load unpacked"
4. Select the `WebNotes` folder

### 2. Create a Notion OAuth Integration (One-Time Setup)

1. Go to [Notion Integrations](https://www.notion.so/my-integrations)
2. Click "New integration" → Select **"Public integration"** (OAuth)
3. Fill in the details:
   - **Name**: "WebNotes" (or any name you prefer)
   - **Logo**: Optional
   - **Associated workspace**: Select your workspace
   - **Redirect URIs**: You'll get this from the extension (see step 3)
4. Click "Submit"
5. **Copy your OAuth Client ID and OAuth Client Secret** (you'll need these in the next step)

### 3. Configure OAuth in the Extension

1. Click the WebNotes extension icon in your Chrome toolbar
2. The extension will show you a **Redirect URI** - copy this
3. Go back to your Notion integration settings and add this Redirect URI to the "Redirect URIs" field
4. In the extension popup, paste your **OAuth Client ID** and **OAuth Client Secret**
5. Click "Save Credentials"

### 4. Connect Your Notion Account

1. Click the **"🔗 Connect to Notion"** button in the extension popup
2. You'll be redirected to Notion to authorize the extension
3. Click "Allow" to grant access
4. You'll be redirected back to the extension

### 5. Select Your Database

1. After connecting, you'll see a list of your Notion databases
2. Select the database where you want to save highlights
3. Click "Save Database"

**Note**: If you don't have a database yet, create one in Notion with these properties:
   - **Title** (Title type) - This will store the highlighted text preview
   - **URL** (URL type) - The source URL of the highlight
   - **Page Title** (Text type) - The title of the webpage
   - **Domain** (Text type) - The domain of the website
   - **Date** (Date type) - When the highlight was created
   - **Highlight ID** (Text type) - Unique identifier for the highlight

You should see a green checkmark indicating you're connected!

## Usage

1. **Enable Highlighting Mode:**
   - Click the extension icon
   - Click "Enable Highlighting"
   - The cursor will change to indicate highlighting mode is active

2. **Highlight Text:**
   - Select any text on a webpage
   - A menu will appear with "Save to Notion" option
   - Click "Save to Notion" to save the highlight

3. **View Highlights:**
   - Highlights appear with a yellow background
   - Hover over highlights to see when they were saved
   - Click a highlight to see options (delete)

4. **Disable Highlighting:**
   - Click the extension icon again
   - Click "Disable Highlighting" (or the button will toggle)

## Database Schema

Your Notion database should have these properties:

| Property Name | Type | Description |
|--------------|------|-------------|
| Title | Title | Preview of highlighted text |
| URL | URL | Source URL |
| Page Title | Text | Webpage title |
| Domain | Text | Website domain |
| Date | Date | Creation timestamp |
| Highlight ID | Text | Unique identifier |

## Troubleshooting

### Highlights not saving to Notion
- Verify your integration token is correct
- Ensure your database ID is correct (32 characters, no hyphens)
- Check that your integration has access to the database
- Open Chrome DevTools (F12) and check the Console for errors

### Highlights not persisting
- Make sure you've saved the highlight (clicked "Save to Notion")
- Check that the page URL hasn't changed
- Some dynamic websites may not preserve highlights if content changes

### Can't find text to highlight
- Some websites use iframes or shadow DOM which may prevent highlighting
- Try refreshing the page and highlighting again

## Development

### File Structure

```
WebNotes/
├── manifest.json          # Extension manifest
├── background.js          # Service worker for API calls
├── content.js            # Content script for highlighting
├── content.css           # Styles for highlights
├── popup.html            # Extension popup UI
├── popup.js              # Popup logic
├── popup.css             # Popup styles
└── icons/                # Extension icons
```

### Building

No build process required. The extension uses vanilla JavaScript and can be loaded directly into Chrome.

## Privacy

- All data is stored locally in Chrome's storage
- Highlights are only sent to your personal Notion database
- No data is sent to third-party servers
- The extension only accesses pages you explicitly visit

## License

MIT License - feel free to use and modify as needed!

