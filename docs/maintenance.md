# Maintenance

External drives on macOS like to create AppleDouble sidecar files such as `._README.md`. Very helpful if your hobby is watching garbage files appear in `git status`. Less helpful otherwise.

## Ignore rules

The repo ignores common macOS metadata:

```text
.DS_Store
**/.DS_Store
._*
**/._*
.AppleDouble
.LSOverride
.Spotlight-V100/
.Trashes/
.fseventsd/
```

## Cleanup routine

Preview cleanup:

```bash
npm run cleanup:macos:dry
```

Interactive cleanup:

```bash
npm run cleanup:macos
```

Non-interactive cleanup:

```bash
node scripts/cleanup-macos-sidecars.mjs --yes
```

The script skips `.git`, `node_modules`, `artifacts`, and ignored research folders.
