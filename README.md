# WebNotes - Chrome Extension

This repository contains the Chrome Extension frontend for **WebNotes**, a tool that allows you to highlight text on any website and save it to your personal Notion database.

> **Note:** The major logic, including Notion API integration and OAuth, is handled by the backend. Please refer to the [**WebNotes-backend**](https://github.com/Atoo35/WebNotes-backend) repository for the core project setup, backend API documentation, and database configuration.

## Setup Instructions

Since the backend handles all external communication, setting up the extension locally is very straightforward:

1. Clone or download this repository.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **"Developer mode"** (toggle in the top right).
4. Click **"Load unpacked"**.
5. Select the `WebNotes` folder.
6. Make sure your **WebNotes-backend** server is running so the extension can communicate with it.

## Features

- ✨ Highlight text on any webpage
- 💾 Send highlights to the WebNotes backend (which syncs them to Notion)
- 🔄 Persistent highlights that appear when you revisit pages
- 🎨 Visual highlighting with hover effects
- 🗑️ Delete highlights directly from the page

## Development Structure

```text
WebNotes/
├── manifest.json         # Extension manifest
├── background.js         # Service worker for backend API communication
├── content.js            # Content script for highlighting
├── content.css           # Styles for highlights
├── popup.html            # Extension popup UI
├── popup.js              # Popup logic
├── popup.css             # Popup styles
└── icons/                # Extension icons
```

## License

MIT License - feel free to use and modify as needed!
