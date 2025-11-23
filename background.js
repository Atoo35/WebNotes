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

                default:
                    sendResponse({ success: false, error: 'Unknown action' });
            }
        } catch (error) {
            console.error('Error handling message:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    async saveHighlightToNotion (highlight) {
        if (!this.accessToken || !this.databaseId) {
            console.warn('Not authenticated or database not set up');
            return;
        }

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
}

// Initialize Notion integration
const notionIntegration = new NotionIntegration();

