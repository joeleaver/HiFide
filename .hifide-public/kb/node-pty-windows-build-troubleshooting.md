---
id: 9b3c4496-bea0-4144-ba3f-4e358c175ba6
title: node-pty Windows Build Troubleshooting
tags: [node-pty, windows, build-error, node-gyp]
files: [package.json, patches/node-pty@1.0.0.patch]
createdAt: 2026-01-04T04:05:54.219Z
updatedAt: 2026-01-04T04:35:30.799Z
---

## node-pty Windows Build Errors (Modern SDK / node-gyp 11+)

Native build failure for `node-pty@1.0.0` during `pnpm install` on Windows with SDK 10.0.26100.0.

### Current Status (Failed Attempt)
Applying a patch to `binding.gyp` to set `CharacterSet` to `'0'` and including ConPTY typedefs in `conpty.cc` failed. 

The error:
`C:\Users\joe\AppData\Roaming
pm
ode_modules\pnpm\dist
ode_modules
ode-gyp\src\win_delay_load_hook.cc(32,7): error C2664: 'HMODULE GetModuleHandleW(LPCWSTR)': cannot convert argument 1 from 'const char [12]' to 'LPCWSTR'`

This confirms that even with `CharacterSet: 0`, `node-gyp`'s internal hook is sensing a `UNICODE` environment (likely via global compiler flags) and generating a call to `GetModuleHandleW` while passing an ANSI string.

### Next Steps 
Recommended approach: 
1. Revert to `node-pty@1.0.0` default (already done via failed patch iterations).
2. Upgrade to `node-pty@1.1.0` which has better support for modern Node/SDKs.
3. If sticking with 1.0.0, the patch MUST successfully force the compiler to treat the entire project as non-Unicode or provide custom wrappers for the node-gyp hooks.

### Applied Patch (Reference)
The patch attempted to:
- Update `binding.gyp` to set `'CharacterSet': '0'`.
- Define `PFN*` typedefs in `src/win/conpty.cc`.
- Fix `goto` scoping in `src/win/winpty.cc`.
