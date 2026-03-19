// WebNotes Content Script
// Handles text highlighting, selection, and persistence

class WebNotesHighlighter {
  constructor () {
    this.highlights = new Map();
    this.isHighlightMode = false;
    this.currentSelection = null;
    this.isRestoring = false;
    this._onMouseUp = this.handleSelection.bind(this);
    this._selectionTimer = null;
    this._onSelectionChange = this._handleSelectionChange.bind(this);
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
        document.addEventListener('mouseup', this._onMouseUp);
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
      // Add selectionchange handler which debounces stable selection
      document.addEventListener('selectionchange', this._onSelectionChange, true);
      document.body.style.cursor = 'text';
    } else {
      document.removeEventListener('mouseup', this._onMouseUp);
      document.removeEventListener('selectionchange', this._onSelectionChange, true);
      document.body.style.cursor = '';
      this.clearSelectionIndicator();
    }
  }

  _handleSelectionChange () {
    // Debounce selectionchange events and call handleSelection on stable selection
    if (this._selectionTimer) clearTimeout(this._selectionTimer);
    this._selectionTimer = setTimeout(() => {
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) {
        this.handleSelection();
      }
    }, 200);
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


    // remove menu when clicking/touching anywhere outside it
    const outsideHandler = (e) => {
      if (!menu.contains(e.target)) {
        document.removeEventListener('mousedown', outsideHandler, true);
        document.removeEventListener('touchstart', outsideHandler, true);
        menu.remove();
      }
    };
    document.addEventListener('mousedown', outsideHandler, true);
    document.addEventListener('touchstart', outsideHandler, true);


    document.body.appendChild(menu);

    // console.log('Highlight menu shown at:', menuX, menuY);
    // console.log('Current selection exists:', !!this.currentSelection);
    // console.log('Save button element:', saveButton);
    // console.log('Button clickable:', saveButton ? 'YES' : 'NO');



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
      if (highlight.text.length > 1000) {
        console.warn(`Saving very large highlight (length: ${highlight.text.length}) for ${highlight.url}. This may affect matching and highlighting on some pages.`);
      }
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
      console.log('range', range)
      if (!range) {
        console.warn('Could not find text to highlight:', highlight.text);
        console.warn(`Highlight id: ${highlight.id}, text length: ${highlight.text.length}, preview: ${highlight.text.substring(0, 80)}`);
        return;
      }

      const span = document.createElement('span');
      span.className = 'webnotes-highlight';
      span.dataset.highlightId = highlight.id;
      span.title = `Saved: ${new Date(highlight.timestamp).toLocaleString()}`;

      try {
        range.surroundContents(span);
      } catch (e) {
        // If surroundContents fails, try wrapping text nodes inside range individually
        console.warn('surroundContents failed, attempting per-node wrap', e);
        try {
          const textNodes = [];
          const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE ? range.commonAncestorContainer.parentElement : range.commonAncestorContainer;
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
          let node;
          while (node = walker.nextNode()) {
            const nodeRange = document.createRange();
            nodeRange.selectNodeContents(node);
            if (nodeRange.compareBoundaryPoints(Range.END_TO_START, range) < 0) continue;
            if (nodeRange.compareBoundaryPoints(Range.START_TO_END, range) > 0) break;
            textNodes.push(node);
          }

          for (let tNode of textNodes) {
            const nodeRange = document.createRange();
            const start = (tNode === range.startContainer) ? range.startOffset : 0;
            const end = (tNode === range.endContainer) ? range.endOffset : tNode.textContent.length;
            if (start >= end) continue;
            nodeRange.setStart(tNode, start);
            nodeRange.setEnd(tNode, end);
            const localSpan = document.createElement('span');
            localSpan.className = 'webnotes-highlight';
            localSpan.dataset.highlightId = highlight.id;
            localSpan.title = `Saved: ${new Date(highlight.timestamp).toLocaleString()}`;
            try {
              nodeRange.surroundContents(localSpan);
            } catch (err2) {
              // If even this fails, try extract/insert for the nodeRange
              try {
                const fragments = nodeRange.extractContents();
                localSpan.appendChild(fragments);
                nodeRange.insertNode(localSpan);
              } catch (err3) {
                console.error('Failed to wrap nodeRange', err3);
              }
            }
            // Add click handler
            localSpan.addEventListener('click', (e) => {
              e.stopPropagation();
              this.showHighlightActionsMenu(highlight, e);
            });
          }
          return; // done
        } catch (err) {
          console.error('Error in per-node wrapping fallback:', err);
          // Fallback: try extract/insert on whole range
          const contents = range.extractContents();
          span.appendChild(contents);
          range.insertNode(span);
        }
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
      console.log('selector', selector)
      const searchText = selector.text.trim();
      if (!searchText || searchText.length < 3) return null;
      // Build an array of text nodes (skipping those inside existing highlights)
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            // Skip if node is inside an existing highlight
            if (node.parentElement?.closest('.webnotes-highlight')) {
              return NodeFilter.FILTER_REJECT;
            }
            // Skip empty nodes
            if (!node.textContent || node.textContent.trim().length === 0) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

      const textNodes = [];
      let n;
      while (n = walker.nextNode()) {
        textNodes.push(n);
      }

      // Helper to verify context: ensure before/after snippets appear near match
      const contextMatches = (text, index) => {
        if (selector.beforeContext && selector.beforeContext.length > 0) {
          const beforeText = text.substring(Math.max(0, index - 100), index);
          const contextSnippet = selector.beforeContext.substring(Math.max(0, selector.beforeContext.length - 30));
          if (contextSnippet.length > 5 && !beforeText.includes(contextSnippet)) return false;
        }
        if (selector.afterContext && selector.afterContext.length > 0) {
          const afterText = text.substring(index + searchText.length, index + searchText.length + 100);
          const contextSnippet = selector.afterContext.substring(0, Math.min(30, selector.afterContext.length));
          if (contextSnippet.length > 5 && !afterText.includes(contextSnippet)) return false;
        }
        return true;
      };

      // Search inside single nodes first (fast path)
      for (let i = 0; i < textNodes.length; i++) {
        const node = textNodes[i];
        const text = node.textContent;
        let idx = text.indexOf(searchText);
        while (idx !== -1) {
          console.log('found inside node index', idx, 'nodeText', text.substring(Math.max(0, idx - 30), idx + 30));
          if (!contextMatches(text, idx)) {
            idx = text.indexOf(searchText, idx + 1);
            continue;
          }
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + searchText.length);
          const container = range.commonAncestorContainer;
          const parent = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
          if (parent?.closest('.webnotes-highlight')) {
            idx = text.indexOf(searchText, idx + 1);
            continue; // Skip already highlighted
          }
          return range;
        }
      }

      // Multi-node matching: search for occurrences spanning across adjacent text nodes
      for (let i = 0; i < textNodes.length; i++) {
        const startNode = textNodes[i];
        const startText = startNode.textContent;
        for (let startOffset = 0; startOffset < startText.length; startOffset++) {
          if (startText[startOffset] !== searchText[0]) continue;
          // Build concatenated text across subsequent nodes
          let concat = startText.substring(startOffset);
          let endNode = startNode;
          let endOffset = startText.length;
          let j = i + 1;
          while (concat.length < searchText.length && j < textNodes.length) {
            concat += textNodes[j].textContent;
            endNode = textNodes[j];
            endOffset = textNodes[j].textContent.length;
            j++;
          }
          if (concat.substring(0, searchText.length) === searchText) {
            // Confirm context matches
            let beforeConcat = '';
            if (startOffset > 0) {
              const s = startText.substring(Math.max(0, startOffset - 100), startOffset);
              beforeConcat = s;
            } else if (i > 0) {
              const prev = textNodes[i - 1].textContent;
              beforeConcat = prev.substring(Math.max(0, prev.length - 100));
            }
            let afterConcat = '';
            if (concat.length > searchText.length) {
              afterConcat = concat.substring(searchText.length, searchText.length + 100);
            } else if (j < textNodes.length) {
              afterConcat = textNodes[j].textContent.substring(0, 100);
            }
            const combinedText = beforeConcat + concat.substring(0, searchText.length) + afterConcat;
            // Approximate context check
            if (!contextMatches(combinedText, beforeConcat.length)) continue;

            // Build range from startNode/startOffset to the calculated end location
            let remaining = searchText.length;
            let endNodeIndex = i;
            let endNodeOffset = startOffset;
            // consume start node
            const firstPartLen = startText.length - startOffset;
            if (firstPartLen >= remaining) {
              endNodeIndex = i;
              endNodeOffset = startOffset + remaining;
            } else {
              remaining -= firstPartLen;
              let k = i + 1;
              while (k < textNodes.length && remaining > 0) {
                const len = textNodes[k].textContent.length;
                if (len >= remaining) {
                  endNodeIndex = k;
                  endNodeOffset = remaining;
                  remaining = 0;
                  break;
                }
                remaining -= len;
                k++;
              }
            }

            const range = document.createRange();
            range.setStart(startNode, startOffset);
            range.setEnd(textNodes[endNodeIndex], endNodeOffset);
            const container = range.commonAncestorContainer;
            const parent = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
            if (parent?.closest('.webnotes-highlight')) continue;
            return range;
          }
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
    menu.style.left = `${event.screenX}px`;
    menu.style.top = `${event.screenY - 50}px`;

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

    console.log('loading highlights')

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


      console.log('responses loaded', response)

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
    console.log('restoreing', this.highlights)
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

