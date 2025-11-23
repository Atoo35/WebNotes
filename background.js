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
            this.accessToken = auth.notionAccessToken;
            this.databaseId = auth.notionDatabaseId;
        }

        if (auth.notionClientId) {
            this.clientId = auth.notionClientId;
        }

        if (auth.notionClientSecret) {
            this.clientSecret = auth.notionClientSecret;
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

                case 'setAccessToken':
                    await this.setAccessToken(request.token);
                    sendResponse({ success: true });
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

                case 'getRedirectUri':
                    sendResponse({ redirectUri: this.getRedirectUri() });
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
        if (!this.accessToken || !this.databaseId) {
            console.warn('Not authenticated or database not set up');
            return;
        }

        // Ensure all required properties exist before saving
        await this.ensureDatabaseProperties();

        try {
            const response = await fetch(`${this.notionApiUrl}/pages`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                    'Notion-Version': '2022-06-28'
                },
                body: JSON.stringify({
                    parent: {
                        database_id: this.databaseId
                    },
                    properties: {
                        'Title': {
                            title: [
                                {
                                    text: {
                                        content: highlight.text.substring(0, 100) || 'Untitled Highlight'
                                    }
                                }
                            ]
                        },
                        'URL': {
                            url: highlight.url
                        },
                        'Page Title': {
                            rich_text: [
                                {
                                    text: {
                                        content: highlight.title || 'Untitled Page'
                                    }
                                }
                            ]
                        },
                        'Domain': {
                            rich_text: [
                                {
                                    text: {
                                        content: highlight.domain || ''
                                    }
                                }
                            ]
                        },
                        'Date': {
                            date: {
                                start: highlight.timestamp
                            }
                        },
                        'Highlight ID': {
                            rich_text: [
                                {
                                    text: {
                                        content: highlight.id
                                    }
                                }
                            ]
                        },
                        'Selector': {
                            rich_text: [
                                {
                                    text: {
                                        content: JSON.stringify(highlight.selector || {})
                                    }
                                }
                            ]
                        }
                    },
                    children: [
                        {
                            object: 'block',
                            type: 'paragraph',
                            paragraph: {
                                rich_text: [
                                    {
                                        type: 'text',
                                        text: {
                                            content: highlight.text
                                        }
                                    }
                                ]
                            }
                        },
                        {
                            object: 'block',
                            type: 'paragraph',
                            paragraph: {
                                rich_text: [
                                    {
                                        type: 'text',
                                        text: {
                                            content: `Source: ${highlight.url}`
                                        }
                                    }
                                ]
                            }
                        }
                    ]
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
        if (!this.accessToken || !this.databaseId) {
            return;
        }

        // First, find the page with this highlight ID
        try {
            const pages = await this.searchPagesByHighlightId(highlightId);
            for (const page of pages) {
                await fetch(`${this.notionApiUrl}/pages/${page.id}`, {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json',
                        'Notion-Version': '2022-06-28'
                    },
                    body: JSON.stringify({
                        archived: true
                    })
                });
            }
        } catch (error) {
            console.error('Error deleting from Notion:', error);
        }
    }

    async searchPagesByHighlightId (highlightId) {
        const response = await fetch(`${this.notionApiUrl}/databases/${this.databaseId}/query`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json',
                'Notion-Version': '2022-06-28'
            },
            body: JSON.stringify({
                filter: {
                    property: 'Highlight ID',
                    rich_text: {
                        equals: highlightId
                    }
                }
            })
        });

        if (!response.ok) {
            throw new Error('Failed to search pages');
        }

        const data = await response.json();
        return data.results;
    }

    async createDatabase (accessToken) {
        // This will be called after OAuth to create the database
        // For now, we'll use a manual setup approach
        // Users will need to create a database manually and provide the ID
        return null;
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
        if (!this.clientId || !this.clientSecret) {
            return { success: false, error: 'OAuth credentials not configured. Please set up your Client ID and Client Secret first.' };
        }

        try {
            const redirectUri = this.getRedirectUri();
            // Normalize redirect URI (remove trailing slash if present)
            const normalizedRedirectUri = redirectUri.replace(/\/$/, '');

            // Trim credentials to remove any whitespace
            const trimmedClientId = this.clientId.trim();
            const trimmedClientSecret = this.clientSecret.trim();

            // Log for debugging
            console.log('Starting OAuth flow with:', {
                clientId: trimmedClientId ? trimmedClientId.substring(0, 20) + '...' : 'missing',
                clientIdLength: trimmedClientId?.length,
                clientSecret: trimmedClientSecret ? trimmedClientSecret.substring(0, 4) + '...' + trimmedClientSecret.substring(trimmedClientSecret.length - 4) : 'missing',
                clientSecretLength: trimmedClientSecret?.length,
                redirectUri: normalizedRedirectUri,
                redirectUriLength: normalizedRedirectUri.length
            });

            const authUrl = `${this.notionOAuthUrl}?` +
                `client_id=${encodeURIComponent(trimmedClientId)}&` +
                `response_type=code&` +
                `owner=user&` +
                `redirect_uri=${encodeURIComponent(normalizedRedirectUri)}`;

            console.log('Authorization URL (sanitized):', authUrl.replace(trimmedClientId, 'CLIENT_ID_HIDDEN'));

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
            const error = url.searchParams.get('error');
            const errorDescription = url.searchParams.get('error_description');

            // Extract the redirect_uri from the callback to see what Notion actually used
            const callbackRedirectUri = url.origin + url.pathname;
            // Normalize to remove trailing slash to match what we sent in the authorization request
            const normalizedCallbackUri = callbackRedirectUri.replace(/\/$/, '');

            console.log('=== REDIRECT URI COMPARISON ===');
            console.log('Callback redirect URI from Notion (raw):', callbackRedirectUri);
            console.log('Normalized callback URI:', normalizedCallbackUri);
            console.log('Expected redirect URI (from auth request):', redirectUri);
            console.log('URIs match after normalization:', normalizedCallbackUri === redirectUri);
            console.log('Callback has trailing slash:', callbackRedirectUri.endsWith('/'));
            console.log('Expected has trailing slash:', redirectUri.endsWith('/'));

            if (normalizedCallbackUri !== redirectUri) {
                console.warn('⚠️ WARNING: Redirect URIs do not match after normalization!');
            }

            if (error) {
                return { success: false, error: `OAuth error: ${error}${errorDescription ? ' - ' + errorDescription : ''}` };
            }

            if (!code) {
                return { success: false, error: 'No authorization code received' };
            }

            console.log('Authorization code received, exchanging for token...');
            console.log('Code length:', code.length, 'Code preview:', code.substring(0, 20) + '...');

            // CRITICAL: Use the SAME redirect URI format as the authorization request (no trailing slash)
            // This must match exactly what we sent in the authorization request
            const redirectUriToUse = normalizedCallbackUri; // Use normalized version to match auth request
            console.log('Using redirect URI for token exchange (normalized):', redirectUriToUse);
            console.log('=== END REDIRECT URI COMPARISON ===');

            // Exchange code for access token - use the same normalized redirect URI as auth request
            const tokenResult = await this.exchangeCodeForToken(code, redirectUriToUse);
            return tokenResult;

        } catch (error) {
            console.error('OAuth flow error:', error);
            return { success: false, error: error.message || 'OAuth flow failed' };
        }
    }

    async exchangeCodeForToken (code, redirectUri) {
        try {
            // Validate credentials are present
            if (!this.clientId || !this.clientSecret) {
                return {
                    success: false,
                    error: 'OAuth credentials are missing. Please set them up again in the extension popup.'
                };
            }

            // Use the redirect URI as-is from the callback (don't normalize - must match exactly what Notion used)
            // If Notion sent it with a trailing slash, we must use it with the trailing slash
            const redirectUriToUse = redirectUri; // Use exactly as received from callback

            // Trim credentials to ensure no whitespace
            const trimmedClientId = this.clientId.trim();
            const trimmedClientSecret = this.clientSecret.trim();

            console.log('=== TOKEN EXCHANGE REQUEST ===');
            console.log('Redirect URI being sent (exact from callback):', redirectUriToUse);
            console.log('Redirect URI has trailing slash:', redirectUriToUse.endsWith('/'));

            // Store redirectUriToUse for error messages
            const redirectUriForError = redirectUriToUse;

            // Notion requires Basic Authentication with client_id as username and client_secret as password
            // Base64 encode: client_id:client_secret
            const basicAuth = btoa(`${trimmedClientId}:${trimmedClientSecret}`);

            const requestBody = {
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: redirectUriToUse // Use exact URI from callback
            };

            console.log('Token exchange request details:', {
                grant_type: requestBody.grant_type,
                code_length: code.length,
                code_preview: code.substring(0, 20) + '...',
                redirect_uri: redirectUriToUse,
                redirect_uri_length: redirectUriToUse.length,
                redirect_uri_has_trailing_slash: redirectUriToUse.endsWith('/'),
                redirect_uri_encoded: encodeURIComponent(redirectUriToUse),
                auth_method: 'Basic Authentication',
                client_id_length: trimmedClientId.length,
                client_id_preview: trimmedClientId.substring(0, 20) + '...',
                client_secret_length: trimmedClientSecret.length
            });

            // Log the full request body (sanitized) for debugging
            const sanitizedBody = {
                grant_type: requestBody.grant_type,
                code: code.substring(0, 10) + '...',
                redirect_uri: redirectUriToUse
            };
            console.log('Full request body (sanitized):', JSON.stringify(sanitizedBody, null, 2));
            console.log('Using Basic Auth (client_id:client_secret base64 encoded)');

            // Log the actual URL being called
            console.log('Token exchange URL:', this.notionTokenUrl);

            const requestOptions = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${basicAuth}`
                },
                body: JSON.stringify(requestBody)
            };

            console.log('Making token exchange request:', {
                url: this.notionTokenUrl,
                method: requestOptions.method,
                headers: requestOptions.headers,
                bodyLength: requestOptions.body.length
            });

            const response = await fetch(this.notionTokenUrl, requestOptions);

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
                        redirect_uri: redirectUriToUse,
                        redirect_uri_length: redirectUriToUse.length,
                        client_id_length: trimmedClientId.length,
                        client_id_first_30: trimmedClientId.substring(0, 30),
                        client_secret_length: trimmedClientSecret.length
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
                            '• Client ID length: ' + trimmedClientId.length + ' chars (starts with: ' + trimmedClientId.substring(0, 15) + '...)\n' +
                            '• Client Secret length: ' + trimmedClientSecret.length + ' chars\n' +
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
        if (!this.accessToken || !this.databaseId) {
            console.warn('Not authenticated or database not set up');
            return [];
        }

        try {
            // Query all highlights for this domain
            const response = await fetch(`${this.notionApiUrl}/databases/${this.databaseId}/query`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                    'Notion-Version': '2022-06-28'
                },
                body: JSON.stringify({
                    filter: {
                        property: 'Domain',
                        rich_text: {
                            equals: domain
                        }
                    },
                    sorts: [
                        {
                            property: 'Date',
                            direction: 'descending'
                        }
                    ],
                    page_size: 100
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to load highlights: ${errorText}`);
            }

            const data = await response.json();
            return this.parseHighlightsFromNotion(data.results || []);

        } catch (error) {
            console.error('Error loading highlights by domain:', error);
            throw error;
        }
    }

    parseHighlightsFromNotion (pages) {
        const highlights = [];

        for (const page of pages) {
            try {
                const props = page.properties;

                // Extract selector
                let selector = {};
                if (props.Selector && props.Selector.rich_text && props.Selector.rich_text.length > 0) {
                    const selectorText = props.Selector.rich_text[0].text.content;
                    try {
                        selector = JSON.parse(selectorText);
                    } catch (e) {
                        console.warn('Failed to parse selector:', e);
                    }
                }

                // Extract highlight ID
                let highlightId = '';
                if (props['Highlight ID'] && props['Highlight ID'].rich_text && props['Highlight ID'].rich_text.length > 0) {
                    highlightId = props['Highlight ID'].rich_text[0].text.content;
                }

                // Extract text - try to get from page content blocks first
                let text = '';
                // Note: We'll fetch full text when needed, for now use title
                if (props.Title && props.Title.title && props.Title.title.length > 0) {
                    text = props.Title.title[0].text.content;
                }

                // Extract other properties
                const pageUrl = props.URL?.url || '';
                const pageTitle = props['Page Title']?.rich_text?.[0]?.text?.content || '';
                const domain = props.Domain?.rich_text?.[0]?.text?.content || '';
                const timestamp = props.Date?.date?.start || new Date().toISOString();

                highlights.push({
                    id: highlightId,
                    text: text,
                    url: pageUrl,
                    title: pageTitle,
                    domain: domain,
                    selector: selector,
                    timestamp: timestamp,
                    notionPageId: page.id // Store for later full text fetch
                });
            } catch (error) {
                console.error('Error parsing highlight from Notion:', error, page);
            }
        }

        return highlights;
    }

    async loadHighlightsFromNotion (url, domain) {
        if (!this.accessToken || !this.databaseId) {
            console.warn('Not authenticated or database not set up');
            return [];
        }

        try {
            // First try to get from cache
            const cacheKey = `highlights_cache_${domain}`;
            const cacheResult = await chrome.storage.local.get([cacheKey]);
            const cached = cacheResult[cacheKey];

            if (cached && cached.timestamp && (Date.now() - cached.timestamp < 5 * 60 * 1000)) {
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
}

// Initialize Notion integration
const notionIntegration = new NotionIntegration();

