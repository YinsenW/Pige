# Pige App Icon Assets

Status: UI Design source and platform export set. Build integration remains owned by
Development.

The approved mark is the white pigeon cutout over a deep teal circle on a pure white
canvas. Do not recolor it, add a containing rounded rectangle, pre-mask it, add text,
or place it on a tinted/gradient background.

## Source of truth

- `master/pige-icon-1024.png`: 1024 x 1024, opaque RGB, pure-white square canvas.
- Brand teal is sampled from the supplied approved artwork; the image is the color
  authority. Avoid manual palette substitution in platform exports.
- Preserve the current optical padding and full pigeon silhouette.

## Platform exports

- macOS: `macos/Pige.icns` plus its source `macos/Pige.iconset/`. The artwork is not
  pre-rounded; macOS applies the installed icon presentation.
- Windows: `windows/Pige.ico` contains 16, 24, 32, 48, 64, 128, and 256 px frames.
  Matching PNGs are retained for inspection and future light/dark unplated work.
- iOS/iPadOS: `ios/AppIcon-1024.png`, opaque and unmasked. Xcode/App Store tooling
  derives required device renditions.
- Android: `android/play-store-512.png`; adaptive icon layers are
  `ic_launcher_foreground.png`, `ic_launcher_background.png`, and
  `ic_launcher_monochrome.png`. The visible mark is constrained to the centered
  66/108 safe zone so OEM masks do not clip the pigeon.

## Acceptance

- Inspect the 16, 24, and 32 px Windows frames at 1:1 scale.
- Inspect macOS Dock/Finder output after packaging; do not judge only the 1024 px PNG.
- Confirm the iOS source has no alpha channel.
- Preview Android adaptive layers under circle, squircle, rounded-square, and teardrop
  masks, including themed monochrome mode.
- Platform packaging, signing, store metadata, and mobile project wiring are separate
  Development/release responsibilities.
