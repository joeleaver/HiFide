# Language Server Status Indicator

## Overview

A new status indicator has been added to the status bar in the **Explorer View** that shows the real-time status of the Language Server Protocol (LSP) for TypeScript/JavaScript files.

## Location

The indicator appears in the **status bar** (bottom of the explorer view) when:
1. You're in the **Explorer View** (not Flow view)
2. You have a **TypeScript/JavaScript file open** (.ts, .tsx, .js, .jsx)

## Status States

The indicator displays different icons and colors based on the LSP status:

### ✅ Ready (Green Check)
- **Icon**: Green checkmark
- **Label**: "Language Server Ready"
- **Meaning**: LSP is fully initialized and validating your code
- **Action**: No action needed - everything is working

### 🔄 Initializing (Blue Spinner)
- **Icon**: Blue loading spinner
- **Label**: "Initializing Language Server..."
- **Meaning**: LSP is starting up
- **Action**: Wait a moment for initialization to complete

### 📦 Installing (Blue Spinner)
- **Icon**: Blue loading spinner
- **Label**: "Installing Language Server..."
- **Meaning**: LSP is being installed for the first time
- **Action**: Wait for installation to complete

### ❌ Error (Red Alert)
- **Icon**: Red alert circle
- **Label**: "Language Server Error: [error message]"
- **Meaning**: LSP encountered an error
- **Action**: Check the error message in the tooltip

### ⊘ Disabled (Gray X)
- **Icon**: Gray X
- **Label**: "Language Server Disabled"
- **Meaning**: LSP is disabled for this language
- **Action**: Enable it in Settings if needed

## How to Use

1. **Open a TypeScript/JavaScript file** in the editor
2. **Look at the status bar** at the bottom of the explorer view
3. **Hover over the LSP indicator** to see the detailed status message
4. **Wait for "Ready" status** before expecting diagnostics

## What It Tells You

- **LSP is working**: When status is "Ready", the language server is actively validating your code
- **Diagnostics are available**: Red squiggles on errors will appear when LSP is ready
- **Initialization progress**: You can see when LSP is starting up
- **Error diagnosis**: If there's an error, the tooltip shows what went wrong

## Example Scenarios

### Scenario 1: Opening a TypeScript File
1. Open a `.ts` or `.tsx` file
2. Status shows "Initializing Language Server..."
3. After a moment, status changes to "Language Server Ready"
4. Diagnostics (red squiggles) appear on errors

### Scenario 2: Switching Files
1. Open a Python file - LSP indicator disappears (not a TS/JS file)
2. Switch back to a TypeScript file - LSP indicator reappears
3. Status should be "Ready" (cached from previous initialization)

### Scenario 3: Workspace Switch
1. Open a different workspace
2. LSP indicator shows "Initializing Language Server..."
3. New workspace's tsconfig.json is loaded
4. Status changes to "Ready"

## Technical Details

### Component Location
- **File**: `src/components/LspStatusIndicator.tsx`
- **Integration**: Added to `src/components/StatusBar.tsx`

### Data Source
- Uses `useLanguageSupportStore` to get LSP status
- Monitors the active editor tab
- Only shows for supported languages (TypeScript, JavaScript)

### Status Values
- `ready`: LSP is initialized and ready
- `pending`: LSP is initializing
- `installing`: LSP is being installed
- `error`: LSP encountered an error
- `disabled`: LSP is disabled
- `unsupported`: Language not supported

## Troubleshooting

### Indicator Not Showing
- **Check**: Are you in the Explorer View? (not Flow view)
- **Check**: Is the active file a TypeScript/JavaScript file?
- **Check**: Is the file extension .ts, .tsx, .js, or .jsx?

### Status Shows "Error"
- **Check**: Hover over the indicator to see the error message
- **Check**: Browser console (F12) for detailed error logs
- **Check**: Workspace has a valid tsconfig.json

### Status Stuck on "Initializing"
- **Check**: Browser console for errors
- **Check**: Language server process is running (check system processes)
- **Check**: Try switching to a different file and back

## Future Enhancements

Potential improvements:
- Click to open language server logs
- Quick action to restart language server
- Show number of diagnostics in indicator
- Per-language status (show status for all languages)

