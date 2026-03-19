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
        if (!this.databaseId) {
            return;
        }

        try {
            const updateResponse = await fetch(`${this.rooturl}/notion/databases/ensure-properties`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    database_id: this.databaseId
                })
            });

            if (updateResponse.ok) {
                console.log('Successfully ensured properties in database');
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
        try {
            const response = await fetch(`${this.rooturl}/notion/databases/list`, {
                method: 'GET'
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
            return data.databases || [];

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
                let parsedSelector = highlight.selector;
                try {
                    if (typeof parsedSelector === 'string') {
                        parsedSelector = JSON.parse(parsedSelector);
                    }
                    if (typeof parsedSelector === 'string') {
                        parsedSelector = JSON.parse(parsedSelector);
                    }
                } catch (e) {
                    console.error('Failed to deep parse selector, using as is', e);
                }

                highlights.push({
                    id: highlight.id,
                    text: highlight.text,
                    url: highlight.url,
                    title: highlight.title,
                    domain: highlight.domain,
                    selector: parsedSelector,
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

            // Filter by URL and return (ignoring URL hash that might change on older pages)
            const cleanUrl = (u) => { 
                try { 
                    const p = new URL(u); 
                    return (p.origin + p.pathname + p.search).replace(/\/$/, ''); 
                } catch { 
                    return u ? u.split('#')[0].replace(/\/$/, '') : ''; 
                } 
            };
            const currentCleanUrl = cleanUrl(url);
            
            console.log(`Matching target URL: ${currentCleanUrl} against ${allDomainHighlights.length} highlights`);
            const filtered = allDomainHighlights.filter(h => {
                const highlightUrl = cleanUrl(h.url);
                const matches = highlightUrl === currentCleanUrl;
                if (!matches) {
                    console.log(`URL mismatch. Highlight URL: ${highlightUrl} !== ${currentCleanUrl}`);
                }
                return matches;
            });
            console.log(`Returning ${filtered.length} matched highlights`);
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
        try {
            const response = await fetch(`${this.rooturl}/notion/databases/create-auto`, {
                method: 'POST'
            });

            if (!response.ok) {
                throw new Error('Database creation failed');
            }

            const data = await response.json();
            if (data.success && data.databaseId) {
                await this.setDatabaseId(data.databaseId);
                return { success: true, databaseId: data.databaseId, created: data.created };
            }

            throw new Error('Database creation failed');
        } catch (error) {
            console.error('Error in createDatabaseAuto:', error);
            throw error;
        }
    }

    async createDatabase (parentPageId) {
        try {
            const response = await fetch(`${this.rooturl}/notion/databases/create`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    parent_page_id: parentPageId
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
        if (!this.databaseId) {
            console.warn('Database not set up');
            return [];
        }
        try {
            const resp = await fetch(`${this.rooturl}/notion/highlights/all?database_id=${this.databaseId}`, {
                method: 'GET'
            });
            if (!resp.ok) {
                throw new Error(await resp.text());
            }
            const json = await resp.json();
            return json.highlights || [];
        } catch (err) {
            console.error('Failed to load all highlights from Notion:', err);
            throw err;
        }
    }
}

// Initialize Notion integration
const notionIntegration = new NotionIntegration();

