// Background Service Worker
// Handles OAuth, Notion API calls, and data synchronization

class NotionIntegration {
    constructor () {
        this.notionApiUrl = 'https://api.notion.com/v1';
        this.notionOAuthUrl = 'https://api.notion.com/v1/oauth/authorize';
        this.notionTokenUrl = 'https://api.notion.com/v1/oauth/token';
        this.databaseId = null;
        this.clientId = null;
        this.clientSecret = null;
        this.rooturl = 'http://localhost:8080/v1'
        this.init();
    }

    async init () {
        // Check if user is authenticated
        const auth = await chrome.storage.local.get([
            'notionAccessToken',
            'notionDatabaseId',
            'notionClientId',
            'notionClientSecret'
        ]);

        if (auth.notionAccessToken) {
            this.databaseId = auth.notionDatabaseId;
        }

        // Listen for messages from content scripts and popup
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            this.handleMessage(request, sender, sendResponse);
            return true; // Keep channel open for async response
        });
    }

    getRedirectUri () {
        // Get the extension ID and construct redirect URI
        // Note: We'll use the exact URI from the callback, so this is just for display
        // The actual redirect URI used will be extracted from the OAuth callback
        const redirectUri = chrome.identity.getRedirectURL();
        // Return with trailing slash removed for display/initial auth request
        // But we'll use the exact callback URI for token exchange
        return redirectUri.replace(/\/$/, '');
    }

    async handleMessage (request, sender, sendResponse) {
        try {
            switch (request.action) {
                case 'saveToNotion':
                    await this.saveHighlightToNotion(request.highlight);
                    sendResponse({ success: true });
                    break;

                case 'deleteFromNotion':
                    await this.deleteHighlightFromNotion(request.highlightId);
                    sendResponse({ success: true });
                    break;

                case 'checkAuth':
                    const isAuthenticated = !!this.accessToken;
                    sendResponse({ authenticated: isAuthenticated });
                    break;

                case 'getDatabaseId':
                    sendResponse({ databaseId: this.databaseId });
                    break;

                case 'setDatabaseId':
                    await this.setDatabaseId(request.databaseId);
                    sendResponse({ success: true });
                    break;

                case 'startOAuthFlow':
                    const oauthResult = await this.startOAuthFlow();
                    sendResponse(oauthResult);
                    break;

                case 'setOAuthCredentials':
                    await this.setOAuthCredentials(request.clientId, request.clientSecret);
                    sendResponse({ success: true });
                    break;

                case 'getOAuthCredentials':
                    sendResponse({
                        hasCredentials: !!(this.clientId && this.clientSecret),
                        hasClientId: !!this.clientId
                    });
                    break;

                case 'listDatabases':
                    try {
                        const databases = await this.listDatabases();
                        sendResponse({ success: true, databases });
                    } catch (error) {
                        sendResponse({ success: false, error: error.message || 'Failed to list databases' });
                    }
                    break;

                case 'createDatabase':
                    try {
                        const database = await this.createDatabase(request.parentPageId);
                        sendResponse({ success: true, database });
                    } catch (error) {
                        sendResponse({ success: false, error: error.message || 'Failed to create database' });
                    }
                    break;

                case 'createDatabaseAuto':
                    try {
                        const result = await this.createDatabaseAuto();
                        sendResponse(result);
                    } catch (error) {
                        sendResponse({ success: false, error: error.message || 'Failed to create database' });
                    }
                    break;

                case 'loadHighlightsFromNotion':
                    try {
                        const highlights = await this.loadHighlightsFromNotion(request.url, request.domain);
                        sendResponse({ success: true, highlights });
                    } catch (error) {
                        sendResponse({ success: false, error: error.message || 'Failed to load highlights' });
                    }
                    break;

                case 'loadHighlightsByDomain':
                    try {
                        const highlights = await this.loadHighlightsByDomain(request.domain);
                        sendResponse({ success: true, highlights });
                    } catch (error) {
                        sendResponse({ success: false, error: error.message || 'Failed to load highlights' });
                    }
                    break;

                case 'loadAllHighlightsFromNotion':
                    try {
                        const highlights = await this.loadAllHighlightsFromNotion();
                        sendResponse({ success: true, highlights });
                    } catch (error) {
                        sendResponse({ success: false, error: error.message || 'Failed to load all highlights' });
                    }
                    break;

                default:
                    sendResponse({ success: false, error: 'Unknown action' });
            }
        } catch (error) {
            console.error('Error handling message:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    async ensureDatabaseProperties () {
        if (!this.accessToken || !this.databaseId) {
            return;
        }

        try {
            // Get current database schema
            const dbResponse = await fetch(`${this.notionApiUrl}/databases/${this.databaseId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Notion-Version': '2022-06-28'
                }
            });

            if (!dbResponse.ok) {
                console.warn('Could not fetch database schema');
                return;
            }

            const database = await dbResponse.json();
            const existingProperties = database.properties || {};

            // Define required properties with their types
            const requiredProperties = {
                'Title': { type: 'title' },
                'URL': { type: 'url' },
                'Page Title': { type: 'rich_text' },
                'Domain': { type: 'rich_text' },
                'Date': { type: 'date' },
                'Highlight ID': { type: 'rich_text' },
                'Selector': { type: 'rich_text' }
            };

            // Check which properties are missing
            const missingProperties = {};
            for (const [propName, propConfig] of Object.entries(requiredProperties)) {
                if (!existingProperties[propName]) {
                    missingProperties[propName] = propConfig;
                }
            }

            // If no properties are missing, we're done
            if (Object.keys(missingProperties).length === 0) {
                return;
            }

            // Update database to add missing properties
            const updatePayload = {};
            for (const [propName, propConfig] of Object.entries(missingProperties)) {
                if (propConfig.type === 'title') {
                    updatePayload[propName] = { title: {} };
                } else if (propConfig.type === 'url') {
                    updatePayload[propName] = { url: {} };
                } else if (propConfig.type === 'rich_text') {
                    updatePayload[propName] = { rich_text: {} };
                } else if (propConfig.type === 'date') {
                    updatePayload[propName] = { date: {} };
                }
            }

            const updateResponse = await fetch(`${this.notionApiUrl}/databases/${this.databaseId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                    'Notion-Version': '2022-06-28'
                },
                body: JSON.stringify({
                    properties: updatePayload
                })
            });

            if (updateResponse.ok) {
                console.log('Successfully added missing properties to database:', Object.keys(missingProperties));
            } else {
                const errorText = await updateResponse.text();
                console.warn('Could not update database properties:', errorText);
            }
        } catch (error) {
            console.error('Error ensuring database properties:', error);
        }
    }

    async saveHighlightToNotion (highlight) {

        try {
            const response = await fetch(`${this.rooturl}/notion/save-highlight`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain'
                },
                body: JSON.stringify({
                    database_id: this.databaseId,
                    title: highlight.text || 'Untitled Highlight',
                    page_title: highlight.title,
                    url: highlight.url,
                    domain: highlight.domain || '',
                    date: highlight.timestamp,
                    highlight_id: highlight.id,
                    selector: JSON.stringify(highlight.selector || {}),
                })
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`Notion API error: ${error}`);
            }

            const data = await response.json();

            // Invalidate cache for this domain so it refreshes on next load
            if (highlight.domain) {
                const cacheKey = `highlights_cache_${highlight.domain}`;
                chrome.storage.local.remove([cacheKey], () => {
                    console.log(`Invalidated cache for domain: ${highlight.domain}`);
                });
            }

            return data;
        } catch (error) {
            console.error('Error saving to Notion:', error);
            throw error;
        }
    }

    async deleteHighlightFromNotion (highlightId) {
        // if (!this.accessToken || !this.databaseId) {
        //     return;
        // }

        // First, find the page with this highlight ID
        try {
            const highlight = await this.searchPagesByHighlightId(highlightId);
            await fetch(`${this.rooturl}/notion/delete-highlight?notion_page_id=${highlight.notion_page_id}`, {
                method: 'DELETE',
            });
        } catch (error) {
            console.error('Error deleting from Notion:', error);
        }
    }

    async searchPagesByHighlightId (highlightId) {
        const response = await fetch(`${this.rooturl}/notion/get-highlight-by-id?database_id=${this.databaseId}&highlight_id=${highlightId}`);

        if (!response.ok) {
            throw new Error('Failed to search pages');
        }

        const data = await response.json();
        return data.highlight;
    }

    async setAccessToken (token) {
        this.accessToken = token;
        await chrome.storage.local.set({ notionAccessToken: token });
    }

    async setDatabaseId (id) {
        this.databaseId = id;
        await chrome.storage.local.set({ notionDatabaseId: id });
    }

    async setOAuthCredentials (clientId, clientSecret) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        await chrome.storage.local.set({
            notionClientId: clientId,
            notionClientSecret: clientSecret
        });
    }

    async startOAuthFlow () {
        try {

            const resp = await fetch(`${this.rooturl}/notion/start-oauth`)

            if (!resp.ok) {
                console.warn('Could not fetch');
                return;
            }

            const res = await resp.json();
            const authUrl = res.RootURL

            console.log('Authorization URL (sanitized):', authUrl);

            // Launch OAuth flow
            const responseUrl = await chrome.identity.launchWebAuthFlow({
                url: authUrl,
                interactive: true
            });

            if (!responseUrl) {
                return { success: false, error: 'OAuth flow was cancelled' };
            }

            console.log('OAuth redirect URL received (full):', responseUrl);

            // Extract authorization code from redirect URL
            const url = new URL(responseUrl);
            const code = url.searchParams.get('code');

            // Exchange code for access token - use the same normalized redirect URI as auth request
            const tokenResult = await this.exchangeCodeForToken(code);
            return tokenResult;

        } catch (error) {
            console.error('OAuth flow error:', error);
            return { success: false, error: error.message || 'OAuth flow failed' };
        }
    }

    async exchangeCodeForToken (code, redirectUri) {
        try {

            const response = await fetch(`${this.rooturl}/notion/get-token?code=${code}`);

            if (!response.ok) {
                const errorText = await response.text();
                const responseHeaders = {};
                response.headers.forEach((value, key) => {
                    responseHeaders[key] = value;
                });

                console.error('Token exchange failed - Full details:', {
                    status: response.status,
                    statusText: response.statusText,
                    errorText: errorText,
                    requestBody: {
                        grant_type: requestBody.grant_type,
                    },
                    responseHeaders: responseHeaders,
                    requestUrl: this.notionTokenUrl
                });

                // Try to parse the error for more details
                try {
                    const errorJson = JSON.parse(errorText);
                    console.error('Parsed error response:', errorJson);
                } catch (e) {
                    console.error('Could not parse error as JSON');
                }

                let errorMessage = 'Token exchange failed';

                try {
                    const errorJson = JSON.parse(errorText);
                    if (errorJson.error === 'invalid_client') {
                        errorMessage = 'Invalid OAuth credentials. The Client ID, Client Secret, or Redirect URI don\'t match your Notion integration.\n\n' +
                            '🔍 Debug Info:\n' +
                            '• Redirect URI used: ' + redirectUriForError + '\n' +
                            '• Redirect URI length: ' + redirectUriForError.length + ' chars\n' +
                            '• Redirect URI has trailing slash: ' + redirectUriForError.endsWith('/') + '\n\n' +
                            '✅ Please verify in Notion:\n' +
                            '1. Client ID matches exactly (no extra spaces)\n' +
                            '2. Client Secret matches exactly (no extra spaces)\n' +
                            '3. Redirect URI in Notion settings EXACTLY matches: ' + redirectUriForError + '\n' +
                            '4. Integration is "Public integration" (OAuth), not "Internal integration"\n' +
                            '5. The redirect URI in Notion must match EXACTLY (including trailing slash if present)\n\n' +
                            '💡 Common issues:\n' +
                            '• Extra spaces when copying credentials\n' +
                            '• Trailing slash mismatch in redirect URI\n' +
                            '• Using Internal integration instead of Public integration';
                    } else {
                        errorMessage = errorJson.error_description || errorJson.error || errorMessage;
                    }
                } catch (e) {
                    // If parsing fails, use the raw error text
                    if (errorText.includes('invalid_client')) {
                        errorMessage = 'Invalid OAuth credentials. Please verify:\n\n' +
                            '• Client ID and Secret are correct\n' +
                            '• Redirect URI matches exactly: ' + redirectUri + '\n' +
                            '• Integration is "Public integration"';
                    } else {
                        errorMessage = errorText;
                    }
                }

                throw new Error(errorMessage);
            }

            const data = await response.json();

            if (data.access_token) {
                await this.setAccessToken(data.access_token);
                return {
                    success: true,
                    accessToken: data.access_token,
                    workspaceName: data.workspace_name,
                    workspaceIcon: data.workspace_icon
                };
            } else {
                return { success: false, error: 'No access token in response' };
            }

        } catch (error) {
            console.error('Token exchange error:', error);
            return { success: false, error: error.message || 'Token exchange failed' };
        }
    }

    async listDatabases () {
        if (!this.accessToken) {
            throw new Error('Not authenticated');
        }

        try {
            const response = await fetch(`${this.notionApiUrl}/search`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                    'Notion-Version': '2022-06-28'
                },
                body: JSON.stringify({
                    filter: {
                        property: 'object',
                        value: 'database'
                    },
                    sort: {
                        direction: 'descending',
                        timestamp: 'last_edited_time'
                    }
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                let errorMessage = 'Failed to list databases';
                try {
                    const errorJson = JSON.parse(errorText);
                    errorMessage = errorJson.message || errorMessage;
                } catch (e) {
                    errorMessage = errorText || errorMessage;
                }
                throw new Error(errorMessage);
            }

            const data = await response.json();
            return data.results || [];

        } catch (error) {
            console.error('Error listing databases:', error);
            throw error;
        }
    }

    async loadHighlightsByDomain (domain) {

        try {
            const response = await fetch(`${this.rooturl}/notion/load-highlights-by-domain?database_id=${this.databaseId}&domain=${domain}`)

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to load highlights: ${errorText}`);
            }

            const data = await response.json();
            return this.parseHighlightsFromNotion(data || []);

        } catch (error) {
            console.error('Error loading highlights by domain:', error);
            throw error;
        }
    }

    parseHighlightsFromNotion (data) {
        const highlights = [];
        for (const highlight of data.highlights) {
            try {
                const timestamp = highlight.timestamp * 1000 || new Date().toISOString();
                const parsed = JSON.parse(highlight.selector)
                highlights.push({
                    id: highlight.id,
                    text: highlight.text,
                    url: highlight.url,
                    title: highlight.title,
                    domain: highlight.domain,
                    selector: JSON.parse(parsed),
                    timestamp: timestamp,
                    notionPageId: highlight.notion_page_id // Store for later full text fetch
                });
            } catch (error) {
                console.error('Error parsing highlight from Notion:', error);
            }
        }

        return highlights;
    }

    async loadHighlightsFromNotion (url, domain) {

        try {
            // First try to get from cache
            const cacheKey = `highlights_cache_${domain}`;
            const cacheResult = await chrome.storage.local.get([cacheKey]);
            const cached = cacheResult[cacheKey];

            if (cached && cached.timestamp && (Date.now() - cached.timestamp < 30000)) {
                // Cache is less than 5 minutes old, filter by URL and return
                const filtered = cached.highlights.filter(h => h.url === url);
                console.log(`Using cached highlights for domain ${domain}, filtered to ${filtered.length} for URL`);
                return filtered;
            }

            // Cache miss or expired, fetch from Notion by domain
            console.log(`Fetching highlights from Notion for domain: ${domain}`);
            const allDomainHighlights = await this.loadHighlightsByDomain(domain);

            // Cache all domain highlights
            await chrome.storage.local.set({
                [cacheKey]: {
                    highlights: allDomainHighlights,
                    timestamp: Date.now()
                }
            });

            // Filter by URL and return
            const filtered = allDomainHighlights.filter(h => h.url === url);
            return filtered;

        } catch (error) {
            console.error('Error loading highlights from Notion:', error);
            // Try to use cache even if expired
            const cacheKey = `highlights_cache_${domain}`;
            const cacheResult = await chrome.storage.local.get([cacheKey]);
            if (cacheResult[cacheKey] && cacheResult[cacheKey].highlights) {
                console.log('Using expired cache due to error');
                return cacheResult[cacheKey].highlights.filter(h => h.url === url);
            }
            throw error;
        }
    }

    async createDatabaseAuto () {
        if (!this.accessToken) {
            throw new Error('Not authenticated');
        }

        try {
            // First, try to find an existing WebNotes database
            const databases = await this.listDatabases();
            const existingDb = databases.find(db => {
                const title = db.title?.[0]?.plain_text || db.title?.[0]?.text?.content || '';
                return title.toLowerCase().includes('webnotes') || title.toLowerCase().includes('highlights');
            });

            if (existingDb) {
                console.log('Found existing WebNotes database:', existingDb.id);
                await this.setDatabaseId(existingDb.id);
                return { success: true, databaseId: existingDb.id, created: false };
            }

            // If no existing database, create a new page first, then database
            // Try to create a page in the user's workspace
            let parentPageId = null;

            try {
                const pageResponse = await fetch(`${this.notionApiUrl}/pages`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json',
                        'Notion-Version': '2022-06-28'
                    },
                    body: JSON.stringify({
                        parent: {
                            type: 'workspace',
                            workspace: true
                        },
                        properties: {
                            title: {
                                title: [
                                    {
                                        text: {
                                            content: 'WebNotes - My Highlights'
                                        }
                                    }
                                ]
                            }
                        }
                    })
                });

                if (pageResponse.ok) {
                    const page = await pageResponse.json();
                    parentPageId = page.id;
                } else {
                    // If workspace creation fails, try to find an existing page to use as parent
                    console.log('Workspace page creation failed, searching for existing pages...');
                    const searchResponse = await fetch(`${this.notionApiUrl}/search`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${this.accessToken}`,
                            'Content-Type': 'application/json',
                            'Notion-Version': '2022-06-28'
                        },
                        body: JSON.stringify({
                            filter: {
                                property: 'object',
                                value: 'page'
                            },
                            page_size: 1
                        })
                    });

                    if (searchResponse.ok) {
                        const searchData = await searchResponse.json();
                        if (searchData.results && searchData.results.length > 0) {
                            parentPageId = searchData.results[0].id;
                            console.log('Using existing page as parent:', parentPageId);
                        }
                    }
                }
            } catch (pageError) {
                console.error('Error creating or finding parent page:', pageError);
            }

            if (!parentPageId) {
                throw new Error('Could not create or find a parent page for the database. Please create a database manually or ensure your integration has access to create pages.');
            }

            // Now create the database as a child of this page
            const database = await this.createDatabase(parentPageId);

            if (database && database.id) {
                await this.setDatabaseId(database.id);
                return { success: true, databaseId: database.id, created: true };
            }

            throw new Error('Database creation failed');

        } catch (error) {
            console.error('Error in createDatabaseAuto:', error);
            throw error;
        }
    }

    async createDatabase (parentPageId) {
        if (!this.accessToken) {
            throw new Error('Not authenticated');
        }

        try {
            const response = await fetch(`${this.notionApiUrl}/databases`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                    'Notion-Version': '2022-06-28'
                },
                body: JSON.stringify({
                    parent: {
                        type: 'page_id',
                        page_id: parentPageId
                    },
                    title: [
                        {
                            text: {
                                content: 'WebNotes Highlights'
                            }
                        }
                    ],
                    properties: {
                        'Title': {
                            title: {}
                        },
                        'URL': {
                            url: {}
                        },
                        'Page Title': {
                            rich_text: {}
                        },
                        'Domain': {
                            rich_text: {}
                        },
                        'Date': {
                            date: {}
                        },
                        'Highlight ID': {
                            rich_text: {}
                        },
                        'Selector': {
                            rich_text: {}
                        }
                    }
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to create database: ${errorText}`);
            }

            const database = await response.json();
            return database;

        } catch (error) {
            console.error('Error creating database:', error);
            throw error;
        }
    }

    async loadAllHighlightsFromNotion () {
        if (!this.accessToken || !this.databaseId) {
            console.warn('Not authenticated or database not set up');
            return [];
        }
        try {
            // Fetch all highlights from the Notion DB (no domain filter)
            const highlights = [];
            let start_cursor = undefined;
            let has_more = true;
            while (has_more) {
                const resp = await fetch(`${this.notionApiUrl}/databases/${this.databaseId}/query`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json',
                        'Notion-Version': '2022-06-28'
                    },
                    body: JSON.stringify({
                        sorts: [
                            { property: 'Date', direction: 'descending' }
                        ],
                        page_size: 100,
                        ...(start_cursor !== undefined ? { start_cursor } : {})
                    })
                });
                if (!resp.ok) {
                    throw new Error(await resp.text());
                }
                const json = await resp.json();
                const parsed = this.parseHighlightsFromNotion(json.results || []);
                highlights.push(...parsed);
                has_more = json.has_more;
                start_cursor = json.next_cursor;
            }
            return highlights;
        } catch (err) {
            console.error('Failed to load all highlights from Notion:', err);
            throw err;
        }
    }
}

// Initialize Notion integration
const notionIntegration = new NotionIntegration();

