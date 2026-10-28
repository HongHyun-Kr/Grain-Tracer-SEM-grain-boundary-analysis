## Grain Tracer

SEM grain boundary detection and EBSD-style grain size (ECD) analysis.

### Download

| File | |
|---|---|
| `GrainTracer-*-macOS.zip` | macOS app (Apple Silicon, macOS 12 or later) |
| `GrainTracer-*-web.html` | Browser version — open in Chrome, Edge or Safari, works offline |

### Install (macOS)

1. Download and unzip `GrainTracer-*-macOS.zip`, then move **Grain Tracer.app** to Applications.
2. The app is not notarized, so macOS blocks the first launch.
   - macOS 14 and earlier: right-click the app ▸ **Open** ▸ **Open**.
   - macOS 15 and later: try to open it once, then go to **System Settings ▸ Privacy & Security** and click **Open Anyway**.
   - Or in Terminal: `xattr -dr com.apple.quarantine "/Applications/Grain Tracer.app"`

### Features

- Grain boundary detection for line-type (crack/groove) and contrast-type SEM images
- Automatic scale from Hitachi dotted scale bars and `.txt` PixelSize
- Physically scaled default parameters (nm), so different magnifications use the same criteria
- Manual correction: draw/erase boundaries, split, merge — kept when parameters change
- ECD distribution (number/area fraction), D10/D50/D90, area-weighted ECD, aspect ratio, linear intercept Lx/Ly
- Size map with color legend, multi-image projects, Process All, comparison plots
- CSV and PNG export

---

See the [README](../../#readme) for usage and algorithm details.
