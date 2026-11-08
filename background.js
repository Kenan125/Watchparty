// Open Chrome's native panel from the toolbar; room ownership stays in the tab.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
