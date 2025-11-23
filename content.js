// WebNotes Content Script
// Handles text highlighting, selection, and persistence

class WebNotesHighlighter {
  constructor () {
    this.highlights = new Map();
    this.isHighlightMode = false;
    this.currentSelection = null;
    this.isRestoring = false;
    this.init();
  }

  async init () {
    // Load saved highlights for this page
    await this.loadHighlights();

    // Listen for messages from popup/background
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'ping') {
        sendResponse({ ready: true });
      } else if (request.action === 'toggleHighlight') {
        this.toggleHighlightMode();
        sendResponse({ success: true, isHighlightMode: this.isHighlightMode });
      } else if (request.action === 'getHighlightState') {
        sendResponse({ isHighlightMode: this.isHighlightMode });
      } else if (request.action === 'getHighlights') {
        sendResponse({ highlights: Array.from(this.highlights.values()) });
      }
      return true;
    });

    // Enable highlighting by default on all tabs
    // Check if user has explicitly disabled it (stored preference)
    chrome.storage.local.get(['highlightingEnabled'], (result) => {
      const enabled = result.highlightingEnabled !== false; // Default to true if not set
      if (enabled && !this.isHighlightMode) {
        // Enable highlighting mode automatically
        this.isHighlightMode = true;
        document.addEventListener('mouseup', this.handleSelection.bind(this));
        document.body.style.cursor = 'text';
      }
    });

    // Restore highlights when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => this.restoreHighlights(), 500);
      });
    } else {
      setTimeout(() => this.restoreHighlights(), 500);
    }

    // Also restore on dynamic content changes (for SPAs)
    const observer = new MutationObserver(() => {
      if (!this.isRestoring) {
        this.restoreHighlights();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  toggleHighlightMode () {
    this.isHighlightMode = !this.isHighlightMode;

    // Store global preference (applies to all tabs)
    chrome.storage.local.set({ highlightingEnabled: this.isHighlightMode });

    // Store state for current tab (for popup display)
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
        chrome.storage.local.set({ [`highlightMode_${tabs[0].id}`]: this.isHighlightMode });
      }
    });

    if (this.isHighlightMode) {

      let selectionTimer = null
      document.addEventListener('selectionchange', () => {
        // Clear any previous timer
        if (selectionTimer) {
          clearTimeout(selectionTimer);
        }

        // Set a short timeout. If it fires, the selection is likely stable.
        selectionTimer = setTimeout(() => {
          const selection = window.getSelection();
          if (selection.toString().length > 0) {
            console.log("Selection is likely complete (timeout reached).");
            // Call your function here to show a popover or menu
            this.handleSelection();
          }
        }, 200); // 200ms delay is usually sufficient

      }, true);
      document.body.style.cursor = 'text';
    } else {
      document.removeEventListener('mouseup', this.handleSelection.bind(this));
      document.body.style.cursor = '';
      this.clearSelectionIndicator();
    }
  }

  handleSelection () {
    if (!this.isHighlightMode) return;

    const selection = window.getSelection();
    if (selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const selectedText = selection.toString().trim();

    if (selectedText.length === 0) return;

    this.currentSelection = {
      text: selectedText,
      range: range.cloneRange(),
      timestamp: new Date().toISOString()
    };

    this.showHighlightMenu();
  }

  showHighlightMenu () {
    // Remove existing menu
    const existingMenu = document.querySelector('.webnotes-highlight-menu');
    if (existingMenu) {
      existingMenu.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'webnotes-highlight-menu';
    menu.innerHTML = `
      <button class="save-highlight" title="Save highlight to Notion">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/>
        </svg>
      </button>
    `;

    // Get selection range for better positioning
    const selection = window.getSelection();

    if (selection.rangeCount === 0) {
      console.warn('No selection range available');
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // getBoundingClientRect() returns viewport-relative coordinates
    // For position: fixed, we use viewport coordinates (no scroll offset needed)
    let menuX = 0;
    let menuY = 0;

    // Calculate menu width (approximate, will adjust after rendering)
    const estimatedMenuWidth = 40; // Smaller since it's just an icon button
    const menuHeight = 40;

    // Center horizontally on selection
    menuX = rect.left + (rect.width / 2) - (estimatedMenuWidth / 2);

    // Position menu above or below selection based on available space
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    if (spaceBelow >= menuHeight + 10) {
      // Enough space below, position below selection
      menuY = rect.bottom + 5;
    } else if (spaceAbove >= menuHeight + 10) {
      // Not enough space below, position above selection
      menuY = rect.top - menuHeight - 5;
    } else {
      // Not enough space either way, position at selection center
      menuY = rect.top + (rect.height / 2) - (menuHeight / 2);
    }

    // Ensure menu stays within viewport bounds
    menuX = Math.max(10, Math.min(menuX, window.innerWidth - estimatedMenuWidth - 10));
    menuY = Math.max(10, Math.min(menuY, window.innerHeight - menuHeight - 10));

    // Position menu using fixed positioning (viewport coordinates)
    menu.style.position = 'fixed';
    menu.style.left = `${menuX}px`;
    menu.style.top = `${menuY}px`;
    menu.style.zIndex = '2147483647'; // Maximum z-index

    // Add click handler BEFORE appending to DOM
    const saveButton = menu.querySelector('.save-highlight');

    // Store reference to 'this' for use in handlers
    const self = this;

    const handleSave = (e) => {
      console.log('Save button clicked!', e);
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (!self.currentSelection) {
        console.error('No current selection when button clicked');
        return;
      }

      console.log('Calling saveHighlight...');
      self.saveHighlight();
      menu.remove();
      window.getSelection().removeAllRanges();
    };

    // Add multiple event handlers to ensure we catch the click
    saveButton.addEventListener('click', handleSave, true);
    saveButton.addEventListener('mousedown', (e) => {
      console.log('Save button mousedown!');
      e.preventDefault();
      handleSave(e);
    }, true);

    // Also add to the menu itself as a fallback
    menu.addEventListener('click', (e) => {
      if (e.target.closest('.save-highlight') || e.target === saveButton) {
        console.log('Menu click handler triggered');
        handleSave(e);
      }
    }, true);

    document.body.appendChild(menu);

    console.log('Highlight menu shown at:', menuX, menuY);
    console.log('Current selection exists:', !!this.currentSelection);
    console.log('Save button element:', saveButton);
    console.log('Button clickable:', saveButton ? 'YES' : 'NO');



  }

  async saveHighlight () {
    if (!this.currentSelection) {
      console.error('No current selection to save');
      return;
    }

    try {
      console.log('Saving highlight, currentSelection:', this.currentSelection);
      const highlightId = this.generateId();
      const pageUrl = window.location.href;
      const pageTitle = document.title;
      const selector = this.getSelector(this.currentSelection.range);

      const highlight = {
        id: highlightId,
        text: this.currentSelection.text,
        url: pageUrl,
        title: pageTitle,
        selector: selector,
        timestamp: this.currentSelection.timestamp,
        domain: new URL(pageUrl).hostname
      };

      console.log('Created highlight object:', highlight);

      // Store in memory
      this.highlights.set(highlightId, highlight);

      // Save to Notion (primary storage)
      chrome.runtime.sendMessage({
        action: 'saveToNotion',
        highlight: highlight
      }, async (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error saving to Notion:', chrome.runtime.lastError);
          // Fallback: save to local storage if Notion fails
          await this.saveToStorage(highlight);
        } else {
          console.log('Highlight saved to Notion:', response);
          // Invalidate cache for this domain so it refreshes on next load
          const cacheKey = `highlights_cache_${highlight.domain}`;
          await chrome.storage.local.remove([cacheKey]);
          // Also save to local storage as backup
          await this.saveToStorage(highlight);
        }
      });

      // Apply visual highlight immediately
      this.applyHighlight(highlight);

      this.currentSelection = null;
      console.log('Highlight saved successfully');
    } catch (error) {
      console.error('Error saving highlight:', error);
      alert('Error saving highlight: ' + error.message);
    }
  }

  getSelector (range) {
    // Use a simpler approach: store the text with context
    const selectedText = range.toString();
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;

    // Get context (text before and after)
    const startNode = startContainer.nodeType === Node.TEXT_NODE
      ? startContainer
      : startContainer.childNodes[0];
    const endNode = endContainer.nodeType === Node.TEXT_NODE
      ? endContainer
      : endContainer.childNodes[endContainer.childNodes.length - 1];

    const beforeText = startNode ? startNode.textContent.substring(0, range.startOffset) : '';
    const afterText = endNode ? endNode.textContent.substring(range.endOffset) : '';

    // Get parent element info for better matching
    const parentElement = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer;

    return {
      text: selectedText,
      beforeContext: beforeText.substring(Math.max(0, beforeText.length - 50)),
      afterContext: afterText.substring(0, 50),
      parentTag: parentElement ? parentElement.tagName : '',
      parentId: parentElement ? parentElement.id : '',
      parentClass: parentElement ? parentElement.className : ''
    };
  }

  applyHighlight (highlight) {
    // Find the text using the selector
    try {
      const range = this.findTextRange(highlight.selector);
      if (!range) {
        console.warn('Could not find text to highlight:', highlight.text);
        return;
      }

      const span = document.createElement('span');
      span.className = 'webnotes-highlight';
      span.dataset.highlightId = highlight.id;
      span.title = `Saved: ${new Date(highlight.timestamp).toLocaleString()}`;

      try {
        range.surroundContents(span);
      } catch (e) {
        // If surroundContents fails, try a different approach
        const contents = range.extractContents();
        span.appendChild(contents);
        range.insertNode(span);
      }

      // Add click handler to show menu
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showHighlightActionsMenu(highlight, e);
      });
    } catch (error) {
      console.error('Error applying highlight:', error);
    }
  }

  findTextRange (selector) {
    try {
      const searchText = selector.text.trim();
      if (!searchText || searchText.length < 3) return null;

      // Try to find the text in the document
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            // Skip if node is inside an existing highlight
            if (node.parentElement?.closest('.webnotes-highlight')) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

      let node;
      while (node = walker.nextNode()) {
        const text = node.textContent;
        const index = text.indexOf(searchText);

        if (index !== -1) {
          // Verify context matches if available (relaxed matching)
          if (selector.beforeContext && selector.beforeContext.length > 0) {
            const beforeText = text.substring(Math.max(0, index - 100), index);
            const contextSnippet = selector.beforeContext.substring(Math.max(0, selector.beforeContext.length - 30));
            if (contextSnippet.length > 5 && !beforeText.includes(contextSnippet)) {
              continue;
            }
          }

          if (selector.afterContext && selector.afterContext.length > 0) {
            const afterText = text.substring(index + searchText.length, index + searchText.length + 100);
            const contextSnippet = selector.afterContext.substring(0, Math.min(30, selector.afterContext.length));
            if (contextSnippet.length > 5 && !afterText.includes(contextSnippet)) {
              continue;
            }
          }

          // Found a match, create range
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + searchText.length);

          // Double-check if this range is already highlighted
          const container = range.commonAncestorContainer;
          const parent = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
          if (parent?.closest('.webnotes-highlight')) {
            continue; // Skip if already highlighted
          }

          return range;
        }
      }
    } catch (error) {
      console.error('Error finding text range:', error);
    }
    return null;
  }

  showHighlightActionsMenu (highlight, event) {
    const existingMenu = document.querySelector('.webnotes-highlight-menu');
    if (existingMenu) {
      existingMenu.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'webnotes-highlight-menu';
    menu.innerHTML = `
      <button class="delete-highlight">Delete</button>
    `;

    menu.style.position = 'fixed';
    menu.style.left = `${event.pageX}px`;
    menu.style.top = `${event.pageY - 50}px`;

    menu.querySelector('.delete-highlight').addEventListener('click', async () => {
      await this.deleteHighlight(highlight.id);
      menu.remove();
    });

    document.body.appendChild(menu);

    setTimeout(() => {
      document.addEventListener('click', function removeMenu (e) {
        if (!menu.contains(e.target)) {
          menu.remove();
          document.removeEventListener('click', removeMenu);
        }
      }, { once: true });
    }, 100);
  }

  async deleteHighlight (highlightId) {
    this.highlights.delete(highlightId);
    await this.removeFromStorage(highlightId);

    const highlightElement = document.querySelector(`[data-highlight-id="${highlightId}"]`);
    if (highlightElement) {
      const parent = highlightElement.parentNode;
      parent.replaceChild(document.createTextNode(highlightElement.textContent), highlightElement);
      parent.normalize();
    }

    chrome.runtime.sendMessage({
      action: 'deleteFromNotion',
      highlightId: highlightId
    }, async (response) => {
      console.dir(response);
      if (response.success) {
        console.log('Highlight deleted from Notion');
      } else {
        console.error('Failed to delete highlight from Notion:', response.error);
      }
    });
  }

  async loadHighlights () {
    const url = window.location.href;
    const domain = new URL(url).hostname;

    // Try to load from Notion first (primary source)
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'loadHighlightsFromNotion',
          url: url,
          domain: domain
        }, (result) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(result);
          }
        });
      });

      if (response.success && response.highlights) {
        console.dir(response.highlights);
        console.log(`Loaded ${response.highlights.length} highlights from Notion for ${domain}`);
        response.highlights.forEach(highlight => {
          this.highlights.set(highlight.id, highlight);
        });
        return; // Successfully loaded from Notion
      }
    } catch (error) {
      console.warn('Failed to load highlights from Notion, falling back to local storage:', error);
    }

    // Fallback to local storage if Notion fails or is not available
    const result = await chrome.storage.local.get([`highlights_${url}`]);
    const savedHighlights = result[`highlights_${url}`] || [];

    console.log(`Loaded ${savedHighlights.length} highlights from local storage (fallback)`);
    savedHighlights.forEach(highlight => {
      this.highlights.set(highlight.id, highlight);
    });
  }

  async saveToStorage (highlight) {
    const url = window.location.href;
    const key = `highlights_${url}`;
    const result = await chrome.storage.local.get([key]);
    const highlights = result[key] || [];
    highlights.push(highlight);
    await chrome.storage.local.set({ [key]: highlights });
  }

  async removeFromStorage (highlightId) {
    const url = window.location.href;
    const key = `highlights_${url}`;
    const result = await chrome.storage.local.get([key]);
    const highlights = (result[key] || []).filter(h => h.id !== highlightId);
    await chrome.storage.local.set({ [key]: highlights });
  }

  restoreHighlights () {
    this.isRestoring = true;
    this.highlights.forEach(highlight => {
      // Check if highlight already exists
      const existing = document.querySelector(`[data-highlight-id="${highlight.id}"]`);
      if (!existing) {
        this.applyHighlight(highlight);
      }
    });
    this.isRestoring = false;
  }

  clearSelectionIndicator () {
    const indicator = document.querySelector('.webnotes-selection-indicator');
    if (indicator) {
      indicator.remove();
    }
  }

  generateId () {
    return `highlight_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Initialize highlighter when DOM is ready
// Check if already initialized to prevent double initialization
if (!window.webNotesHighlighterInitialized) {
  window.webNotesHighlighterInitialized = true;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (!window.webNotesHighlighter) {
        window.webNotesHighlighter = new WebNotesHighlighter();
      }
    });
  } else {
    if (!window.webNotesHighlighter) {
      window.webNotesHighlighter = new WebNotesHighlighter();
    }
  }
}

