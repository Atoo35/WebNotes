// Popup Script
// Handles UI interactions and OAuth authentication

let redirectUri = null;

document.addEventListener('DOMContentLoaded', async () => {
  // Get redirect URI from background
  redirectUri = await getRedirectUri();
  if (redirectUri) {
    const display = document.getElementById('redirect-uri-display');
    if (display) {
      display.textContent = redirectUri;
    }
  }

  await checkAuthStatus();
  setupEventListeners();
});

async function getRedirectUri () {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getRedirectUri' }, (response) => {
      if (chrome.runtime.lastError || !response?.redirectUri) {
        // Fallback: get it directly (synchronous in MV3)
        const url = chrome.identity.getRedirectURL();
        resolve(url);
      } else {
        resolve(response.redirectUri);
      }
    });
  });
}

async function checkAuthStatus () {
  const result = await chrome.storage.local.get([
    'notionAccessToken',
    'notionDatabaseId',
    'notionWorkspaceName'
  ]);
  const hasToken = !!result.notionAccessToken;
  const hasDatabase = !!result.notionDatabaseId;
  const isAuthenticated = hasToken && hasDatabase;

  const statusIndicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');
  const notAuthSection = document.getElementById('not-authenticated');
  const authSection = document.getElementById('authenticated');
  const mainConnect = document.getElementById('main-connect');
  const oauthSetup = document.getElementById('oauth-setup');
  const databaseSelection = document.getElementById('database-selection');
  const workspaceInfo = document.getElementById('workspace-info');

  // Check if OAuth credentials are configured
  const credentialsResult = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getOAuthCredentials' }, resolve);
  });

  if (isAuthenticated) {
    statusIndicator.className = 'status-indicator connected';
    statusText.textContent = 'Connected to Notion';
    notAuthSection.style.display = 'none';
    authSection.style.display = 'block';

    if (result.notionWorkspaceName) {
      workspaceInfo.textContent = `Workspace: ${result.notionWorkspaceName}`;
    }
  } else {
    statusIndicator.className = 'status-indicator disconnected';

    if (!credentialsResult.hasCredentials) {
      // Show OAuth setup by default if no credentials
      statusText.textContent = 'Set up Notion connection';
      mainConnect.style.display = 'none';
      oauthSetup.style.display = 'block';
      databaseSelection.style.display = 'none';
    } else if (!hasToken) {
      // Show main connect button
      statusText.textContent = 'Ready to connect';
      mainConnect.style.display = 'block';
      oauthSetup.style.display = 'none';
      databaseSelection.style.display = 'none';
    } else if (!hasDatabase) {
      // Show database selection
      statusText.textContent = 'Select your database';
      mainConnect.style.display = 'none';
      oauthSetup.style.display = 'none';
      databaseSelection.style.display = 'block';
      await loadDatabases();
    }

    notAuthSection.style.display = 'block';
    authSection.style.display = 'none';
  }
}

async function loadDatabases () {
  const select = document.getElementById('database-select');
  select.innerHTML = '<option value="">Loading databases...</option>';
  select.disabled = true;

  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'listDatabases' }, (result) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(result);
        }
      });
    });

    if (response.success && response.databases && response.databases.length > 0) {
      select.innerHTML = '<option value="">Select a database...</option>';
      response.databases.forEach(db => {
        const option = document.createElement('option');
        option.value = db.id;
        // Get database title - could be in title array or object
        let title = 'Untitled Database';
        if (db.title) {
          if (Array.isArray(db.title) && db.title.length > 0) {
            title = db.title[0].plain_text || db.title[0].text?.content || title;
          } else if (typeof db.title === 'string') {
            title = db.title;
          }
        }
        option.textContent = title;
        select.appendChild(option);
      });
      select.disabled = false;
    } else {
      const errorMsg = response.error || 'No databases found';
      select.innerHTML = `<option value="">${errorMsg}</option>`;
      select.disabled = true;
    }
  } catch (error) {
    console.error('Error loading databases:', error);
    select.innerHTML = `<option value="">Error: ${error.message || 'Failed to load databases'}</option>`;
    select.disabled = true;
  }
}

function setupEventListeners () {
  // Toggle setup visibility
  const setupLink = document.getElementById('setup-link');
  const hideSetupLink = document.getElementById('hide-setup-link');

  if (setupLink) {
    setupLink.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('main-connect').style.display = 'none';
      document.getElementById('oauth-setup').style.display = 'block';
    });
  }

  if (hideSetupLink) {
    hideSetupLink.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('oauth-setup').style.display = 'none';
      document.getElementById('main-connect').style.display = 'block';
    });
  }

  // Copy redirect URI button
  const copyRedirectBtn = document.getElementById('copy-redirect-uri-btn');
  if (copyRedirectBtn) {
    copyRedirectBtn.addEventListener('click', async () => {
      const redirectUriDisplay = document.getElementById('redirect-uri-display');
      if (redirectUriDisplay && redirectUriDisplay.textContent) {
        try {
          await navigator.clipboard.writeText(redirectUriDisplay.textContent);
          copyRedirectBtn.textContent = 'Copied!';
          copyRedirectBtn.style.background = '#4CAF50';
          setTimeout(() => {
            copyRedirectBtn.textContent = 'Copy';
            copyRedirectBtn.style.background = '#007AFF';
          }, 2000);
        } catch (err) {
          // Fallback for older browsers
          const textArea = document.createElement('textarea');
          textArea.value = redirectUriDisplay.textContent;
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
          copyRedirectBtn.textContent = 'Copied!';
          setTimeout(() => {
            copyRedirectBtn.textContent = 'Copy';
          }, 2000);
        }
      }
    });
  }

  // Save OAuth credentials button
  const saveCredentialsBtn = document.getElementById('save-oauth-credentials-btn');
  if (saveCredentialsBtn) {
    saveCredentialsBtn.addEventListener('click', async () => {
      const clientId = document.getElementById('notion-client-id').value.trim();
      const clientSecret = document.getElementById('notion-client-secret').value.trim();

      if (!clientId || !clientSecret) {
        alert('Please enter both Client ID and Client Secret');
        return;
      }

      // Basic validation
      if (clientId.length < 10) {
        alert('Client ID seems too short. Please check that you copied the full OAuth Client ID from Notion.');
        return;
      }

      if (clientSecret.length < 10) {
        alert('Client Secret seems too short. Please check that you copied the full OAuth Client Secret from Notion.');
        return;
      }

      saveCredentialsBtn.disabled = true;
      saveCredentialsBtn.textContent = 'Saving...';

      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'setOAuthCredentials',
          clientId: clientId,
          clientSecret: clientSecret
        }, resolve);
      });

      if (response.success) {
        saveCredentialsBtn.textContent = '✓ Saved!';
        saveCredentialsBtn.style.background = '#4CAF50';

        // Clear inputs
        document.getElementById('notion-client-id').value = '';
        document.getElementById('notion-client-secret').value = '';

        // Show connect button after a brief delay
        setTimeout(async () => {
          await checkAuthStatus();
        }, 1000);
      } else {
        alert('Failed to save credentials: ' + (response.error || 'Unknown error'));
        saveCredentialsBtn.disabled = false;
        saveCredentialsBtn.textContent = 'Save & Continue';
        saveCredentialsBtn.style.background = '';
      }
    });
  }

  // Toggle secret visibility
  const toggleSecretBtn = document.getElementById('toggle-secret-visibility');
  const secretInput = document.getElementById('notion-client-secret');
  const clientIdInput = document.getElementById('notion-client-id');
  const debugDiv = document.getElementById('credentials-debug');

  if (toggleSecretBtn && secretInput) {
    toggleSecretBtn.addEventListener('click', () => {
      const isPassword = secretInput.type === 'password';
      secretInput.type = isPassword ? 'text' : 'password';
      document.getElementById('visibility-icon').textContent = isPassword ? '🙈' : '👁️';
    });
  }

  // Show debug info when typing credentials
  if (clientIdInput && secretInput && debugDiv) {
    const updateDebugInfo = async () => {
      const clientId = clientIdInput.value.trim();
      const clientSecret = secretInput.value.trim();
      const redirectUri = await getRedirectUri();

      if (clientId || clientSecret) {
        debugDiv.style.display = 'block';
        document.getElementById('client-id-preview').textContent =
          `Client ID: ${clientId ? clientId.substring(0, 20) + '... (length: ' + clientId.length + ')' : 'not entered'}`;
        document.getElementById('client-secret-preview').textContent =
          `Client Secret: ${clientSecret ? '***' + clientSecret.substring(clientSecret.length - 4) + ' (length: ' + clientSecret.length + ')' : 'not entered'}`;
        document.getElementById('redirect-uri-preview').textContent =
          `Redirect URI: ${redirectUri}`;
      } else {
        debugDiv.style.display = 'none';
      }
    };

    clientIdInput.addEventListener('input', updateDebugInfo);
    secretInput.addEventListener('input', updateDebugInfo);
  }

  // Connect to Notion button
  const connectBtn = document.getElementById('connect-notion-btn');
  const oauthProgress = document.getElementById('oauth-progress');
  const oauthStep = document.getElementById('oauth-step');
  const oauthDetails = document.getElementById('oauth-details');

  if (connectBtn) {
    connectBtn.addEventListener('click', async () => {
      connectBtn.disabled = true;
      connectBtn.innerHTML = '<span>Connecting...</span>';
      oauthProgress.style.display = 'block';
      oauthStep.textContent = 'Step 1: Opening Notion authorization...';
      oauthDetails.textContent = 'Please authorize the extension in the popup window';

      try {
        // Get redirect URI for display
        const redirectUri = await getRedirectUri();

        const response = await new Promise((resolve) => {
          // Listen for progress updates
          const progressListener = (request, sender, sendResponse) => {
            if (request.action === 'oauthProgress') {
              oauthStep.textContent = request.step || oauthStep.textContent;
              oauthDetails.textContent = request.details || oauthDetails.textContent;
              sendResponse({});
            }
          };

          chrome.runtime.onMessage.addListener(progressListener);

          chrome.runtime.sendMessage({ action: 'startOAuthFlow' }, (result) => {
            chrome.runtime.onMessage.removeListener(progressListener);
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(result);
            }
          });
        });

        if (response.success) {
          oauthStep.textContent = '✓ Authorization successful!';
          oauthDetails.textContent = 'Exchanging code for access token...';

          // Store workspace info if available
          if (response.workspaceName) {
            await chrome.storage.local.set({
              notionWorkspaceName: response.workspaceName
            });
          }

          oauthStep.textContent = '✓ Connected!';
          oauthDetails.textContent = `Workspace: ${response.workspaceName || 'Connected'}`;

          // Update button to show success briefly
          connectBtn.innerHTML = '<span>✓ Connected!</span>';
          connectBtn.style.background = '#4CAF50';

          // Show database selection after a brief delay
          setTimeout(async () => {
            oauthProgress.style.display = 'none';
            await checkAuthStatus();
          }, 1500);
        } else {
          oauthStep.textContent = '✗ Connection failed';
          oauthDetails.innerHTML = `<span style="color: #d32f2f;">${response.error || 'Unknown error'}</span><br><br>Redirect URI: <code style="font-size: 10px;">${redirectUri}</code>`;
          connectBtn.disabled = false;
          connectBtn.innerHTML = '<span>🔗 Connect your Notion account</span>';
          connectBtn.style.background = '';
        }
      } catch (error) {
        console.error('OAuth error:', error);
        oauthStep.textContent = '✗ Error occurred';
        oauthDetails.textContent = error.message || 'An error occurred during authentication';
        connectBtn.disabled = false;
        connectBtn.innerHTML = '<span>🔗 Connect your Notion account</span>';
        connectBtn.style.background = '';
      }
    });
  }

  // Save database button
  const saveDatabaseBtn = document.getElementById('save-database-btn');
  if (saveDatabaseBtn) {
    saveDatabaseBtn.addEventListener('click', async () => {
      const databaseId = document.getElementById('database-select').value;

      if (!databaseId) {
        alert('Please select a database');
        return;
      }

      saveDatabaseBtn.disabled = true;
      saveDatabaseBtn.innerHTML = 'Saving...';

      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'setDatabaseId',
          databaseId: databaseId
        }, resolve);
      });

      if (response.success) {
        saveDatabaseBtn.innerHTML = '✓ Saved!';
        saveDatabaseBtn.style.background = '#4CAF50';
        setTimeout(async () => {
          await checkAuthStatus();
        }, 800);
      } else {
        alert('Failed to save database: ' + (response.error || 'Unknown error'));
        saveDatabaseBtn.disabled = false;
        saveDatabaseBtn.innerHTML = 'Save Database';
        saveDatabaseBtn.style.background = '';
      }
    });
  }

  // Disconnect button
  const disconnectBtn = document.getElementById('disconnect-btn');
  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to disconnect from Notion?')) {
        await chrome.storage.local.remove([
          'notionAccessToken',
          'notionDatabaseId',
          'notionWorkspaceName'
        ]);
        await checkAuthStatus();
      }
    });
  }

  // Toggle highlight button
  const toggleBtn = document.getElementById('toggle-highlight-btn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // Check if content script can be injected (some pages like chrome:// don't allow it)
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://')) {
          alert('Highlighting is not available on this page. Please navigate to a regular website.');
          return;
        }

        // Check if content script is already loaded by trying to ping it
        let contentScriptReady = false;
        try {
          chrome.tabs.sendMessage(tab.id, { action: 'ping' }, (response) => {
            if (!chrome.runtime.lastError) {
              contentScriptReady = true;
            }
          });
        } catch (e) {
          // Content script not ready
        }

        // Only inject if not already loaded (content_scripts in manifest should handle it)
        // But some pages might need programmatic injection
        if (!contentScriptReady) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content.js']
            });
            // Wait for initialization
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (injectError) {
            // Content script might already be injected, or page might not allow it
            console.log('Content script injection result:', injectError.message);
          }
        } else {
          // Content script already loaded, just wait a moment
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Send message to content script
        chrome.tabs.sendMessage(tab.id, { action: 'toggleHighlight' }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('Error sending message:', chrome.runtime.lastError);
            alert('Could not enable highlighting. Please refresh the page and try again.');
            return;
          }

          const btnText = document.getElementById('highlight-btn-text');
          if (btnText) {
            btnText.textContent = btnText.textContent === 'Enable Highlighting'
              ? 'Disable Highlighting'
              : 'Enable Highlighting';
          }
        });
      } catch (error) {
        console.error('Error toggling highlight:', error);
        alert('An error occurred. Please refresh the page and try again.');
      }
    });
  }
}
