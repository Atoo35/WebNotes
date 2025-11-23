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
        sendResponse({ success: true });
      } else if (request.action === 'getHighlights') {
        sendResponse({ highlights: Array.from(this.highlights.values()) });
      }
      return true;
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
    menu.className = '';
    menu.innerHTML = `
      <button class="save-highlight">Save to Notion</button>
      <button class="cancel-highlight">Cancel</button>
    `;






    // console.log('event', event);
    // console.log('event.pageX', event.pageX);
    // console.log('event.pageY', event.pageY);
    // Get selection range for better positioning
    const selection = window.getSelection();

    const range = selection.getRangeAt(0);
    const rect2 = range.getBoundingClientRect();

    console.log('Selection Coordinates (relative to viewport):');
    console.log('Top:', rect2.top);
    console.log('Left:', rect2.left);
    console.log('Width:', rect2.width);
    console.log('Height:', rect2.height);

    let menuX = rect2.top;
    let menuY = rect2.left + rect2.width;

    // Try to position menu above selection if near bottom of screen
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      // Position menu above or below selection based on available space
      if (rect.bottom + 60 > window.innerHeight) {
        // Not enough space below, position above
        menuY = rect.top + window.scrollY - 50;
      } else {
        // Position below selection
        menuY = rect.bottom + window.scrollY + 5;
      }

      // Center horizontally on selection
      menuX = rect.left + (rect.width / 2) + window.scrollX - 75; // 75 is half menu width approx

      // Ensure menu stays within viewport
      menuX = Math.max(10, Math.min(menuX, window.innerWidth - 160));
      menuY = Math.max(10, Math.min(menuY, window.innerHeight + window.scrollY - 60));
    }

    // Position menu
    menu.style.position = 'fixed';
    menu.style.left = `${menuX}px`;
    menu.style.top = `${menuY}px`;
    menu.style.zIndex = '100000'; // Very high z-index to ensure visibility

    menu.querySelector('.save-highlight').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.saveHighlight();
      menu.remove();
      window.getSelection().removeAllRanges();
    });

    menu.querySelector('.cancel-highlight').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      menu.remove();
      window.getSelection().removeAllRanges();
      this.currentSelection = null;
    });

    document.body.appendChild(menu);

    console.log('Highlight menu shown at:', menuX, menuY);

    // Remove menu on click outside (but give it a moment to register clicks)
    setTimeout(() => {
      const clickHandler = (e) => {
        if (!menu.contains(e.target) && !menu.contains(e.target.closest('.webnotes-highlight-menu'))) {
          menu.remove();
          document.removeEventListener('click', clickHandler);
          document.removeEventListener('mousedown', clickHandler);
        }
      };
      document.addEventListener('click', clickHandler, true);
      document.addEventListener('mousedown', clickHandler, true);
    }, 50);
  }

  async saveHighlight () {
    if (!this.currentSelection) return;

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

    // Store locally first
    this.highlights.set(highlightId, highlight);
    await this.saveToStorage(highlight);

    // Apply visual highlight
    this.applyHighlight(highlight);

    // Send to background script to save to Notion
    chrome.runtime.sendMessage({
      action: 'saveToNotion',
      highlight: highlight
    });

    this.currentSelection = null;
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
    });
  }

  async loadHighlights () {
    const url = window.location.href;
    const result = await chrome.storage.local.get([`highlights_${url}`]);
    const savedHighlights = result[`highlights_${url}`] || [];

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
if (!window.webNotesHighlighter) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (!window.webNotesHighlighter) {
        window.webNotesHighlighter = new WebNotesHighlighter();
      }
    });
  } else {
    window.webNotesHighlighter = new WebNotesHighlighter();
  }
}

