---
id: 432bb55b-1716-4965-945e-4454ff7d1577
title: Port Configuration - Auto-fallback for Multiple Instances
tags: [configuration, dev-server, vite, ports]
files: [vite.config.ts]
createdAt: 2025-12-01T15:45:41.281Z
updatedAt: 2025-12-01T15:45:41.281Z
---

## Port Configuration

The Vite dev server is configured to start on port **5328** by default, with automatic fallback to higher ports if busy.

### Configuration Location
`vite.config.ts` - `server.port`

### Behavior
- **Default port**: 5328 (high port number to avoid common conflicts)
- **strictPort**: Removed (was `true`)
- **Auto-increment**: Enabled - if port 5328 is busy, Vite will automatically try 5329, 5330, etc.

### Rationale
This allows running multiple instances of the application simultaneously, which is essential when using HiFide to develop HiFide itself.

### Previous Configuration
- Port 5179
- `strictPort: true` - Would fail if port was busy instead of auto-incrementing

### localStorage Consideration
With `strictPort: false`, different ports will have separate localStorage origins. This is acceptable for development of multiple instances.