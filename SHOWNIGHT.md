# SHOWNIGHT

One page for running posthuman3026 at the party. Same build and same URL on every machine.
Chrome is the primary browser on Windows and macOS. Safari on the Mac is a backup: test it, don't depend on it.

> Status: Phase 1 (audio on the demo site, quality levels). The `03 Set` controller, its keys, blackout and output
> windows land in Phase 2 and 3; those sections are marked below.

## Machines

| Machine | GPU (renderer string) | Starts at | Role |
|---|---|---|---|
| **Luna**, Framework 16, Ryzen 7 7840HS | RX 7700S (expansion bay) | **high** (1080p, 60) | **Primary controller** |
| Luna on the iGPU | Radeon 780M / "AMD Radeon(TM) Graphics" | med (720p, 30) | Means Chrome is not on the 7700S: fix it (below) |
| **MacBook Pro 14" M4** (10-core GPU, 16 GB) | "Apple M4" (Chrome) / "Apple GPU" (Safari) | **med** (720p, 60) | Backup controller, or second output |
| **Stardust**, Legion 7 16IRX8H | RTX 40 laptop | med; **high** if RTX 4070 or above | **One output screen only** (Phase 3), never the controller |
| Any machine on software GL | SwiftShader / "Basic Render" | low (540p, 30) | Emergency only |

- Auto-drop is on everywhere: under 24 fps for 5 s drops one level. The Hydras section's **Quality** menu shows
  `Auto · <level>`, which tells you at a glance which GPU Chrome picked up. If Luna shows `Auto · med`, Chrome is on the iGPU.
- Levels: **low** 960x540, 30 fps cap, 1 tile runs · **med** 1280x720, 30 fps (60 on Apple), 3 tiles · **high** 1920x1080, 60 fps, all tiles.
- Output canvases never render above devicePixelRatio 1 (Retina and HiDPI screens included). Full screen is 720p or more.

### Measured (Polaris stand-ins, 18 Oct 2026; two heaviest sketches, nesso_0 + ritchse_1)

fps at a 30 fps cap. "2" = deck + compositor with the idle deck paused (normal set state); "3" = crossfade.

| Renderer | 540p 1 / 2 / 3 | 720p 1 / 2 / 3 | 1080p 1 / 2 / 3 |
|---|---|---|---|
| SwiftShader (software floor) | 30 / 30 / 30 | 30 / 28 / **18** | 21 / **13** / **9** |
| Intel UHD 770 (iGPU stand-in) | 30 / 30 / 30 | 30 / 30 / 30 | 30 / 30 / 30 |
| RTX 3080 (ceiling) | 30 / 30 / 30 | 30 / 30 / 30 | 30 / 30 / 30 |

Uncapped, the UHD 770 and the 3080 hold 60 fps with 3 canvases at 1080p. **Not yet measured on Luna, the M4 or Stardust.**
To measure: `cd build && node bench.mjs`, copy `build/.cache/hydra-bench.html` to the laptop (USB / AirDrop), open it in
Chrome (and Safari on the Mac), press run (about 90 s, plugged in, window in front), press "copy JSON" and keep the result.
That file holds the sketch code in plaintext: never put it in `docs/` or online.

## Offline

The site runs with no internet from a local copy of `docs/`:

```sh
cd posthuman3026/build
node serve.mjs            # http://localhost:8080/  (Node on Luna, the Mac and Stardust)
```

- Use `localhost`, not the file: Chrome remembers the mic permission for localhost; opened from disk it may ask every launch.
- hydra-synth and the fonts are local. The **Kodamas** section still loads three.js from the internet; the Hydras do not.
- **Edit in Hydra** opens hydra.ojack.xyz and needs internet.

## Setup, per OS

| | **Windows** (Luna, Stardust) | **macOS** (MacBook Pro M4) |
|---|---|---|
| **Power** | Plugged in. Settings > System > Power & battery > Power mode **Best performance**; Screen and sleep **Never** when plugged in. On battery Luna may fall back to the iGPU and throttle. | MagSafe connected. System Settings > Battery > Options > **Prevent automatic sleeping on power adapter when the display is off**. Lock Screen > **Turn display off on power adapter: Never**. |
| **GPU** | Luna: Settings > System > Display > Graphics > add Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe`) > Options > **High performance** (the RX 7700S). Stardust: same, and/or NVIDIA Control Panel > Manage 3D settings > Program settings > Chrome > High-performance NVIDIA processor. Check `Auto · high` in the Quality menu after relaunching Chrome. | Nothing to set (one GPU). |
| **No sleep, no popups** | Settings > System > Notifications > **Do not disturb** on (or Focus session). Settings > Windows Update > **Pause updates** for 1 week. | Terminal: `caffeinate -dis` (leave the window open; Ctrl+C ends it). Control Center > Focus > **Do Not Disturb**. |
| **Displays** | Win+P > **Extend** (laptop screen = controller, projector = output). Settings > System > Display: projector at 1920x1080, **scale 100%**; laptop screen "Make this my main display". **Duplicate** (mirror) forces one resolution on both: use only if there is no controller screen. | Projector on the **HDMI** port directly; more displays through **Thunderbolt / USB-C to HDMI**. System Settings > Displays > Arrange: **Extended** (not "Mirror for Built-in Display"); projector at 1920x1080 (Scaled). |
| **Audio input** | Class-compliant USB interface, DJ line feed into input 1/2. Settings > System > Sound > Input: pick the interface; its Properties: **48 kHz**, **Audio enhancements off**. Settings > Privacy & security > Microphone: on for desktop apps. | Same interface. **Audio MIDI Setup**: select it, Format **48,000 Hz**. System Settings > Privacy & Security > Microphone: **Google Chrome** on (Safari asks per site: Safari > Settings > Websites > Microphone > localhost: Allow). |
| **In the site** | Hydras > a tile's **Audio** > allow the prompt > **Audio input** menu: pick the interface (not the laptop mic). Set the interface gain so the meters move but do not sit at the top; then **Scale** (higher = less sensitive) and **Smooth**. **React** sets how hard the FX pump. | Same. |
| **Kiosk launch** (one window per display; the x position is where that display starts in the arrangement) | `kiosk.bat`:<br>`start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="%LOCALAPPDATA%\ph-kiosk" --kiosk --window-position=1920,0 --autoplay-policy=no-user-gesture-required "http://localhost:8080/"` | Terminal:<br>`open -na "Google Chrome" --args --user-data-dir="$HOME/ph-kiosk" --kiosk --window-position=1512,0 --autoplay-policy=no-user-gesture-required "http://localhost:8080/"` (1512 = the 14" built-in screen's default width in points) |

- Kiosk exits with Alt+F4 (Windows) / Cmd+Q (macOS).
- A dedicated `--user-data-dir` profile loads no extensions. It also has its own storage, so the gate asks for the password
  once in that window. Phase 3 output windows open from the controller and skip the gate.
- `--window-position` with `--kiosk` is untested on the Mac so far: if the window lands on the wrong screen, drag it there
  before kiosk (launch without `--kiosk`, move, then View > Enter Full Screen).

### Stardust: lean machine

1. Quit Lenovo Vantage, Legion Arena and every tray app you don't need (right-click tray icons > Exit; Task Manager > Startup apps to stop them coming back).
2. Do not disturb on. Windows Update paused.
3. Chrome on **High performance** (Windows Graphics settings and/or NVIDIA Control Panel, see GPU row).
4. Plugged in. Legion performance mode **Fn+Q** until the power button LED is red (Performance).
5. Launch Chrome kiosk with a fresh dedicated profile (`--user-data-dir`, see Kiosk launch) so no extensions load.
6. Check the Quality menu reads `Auto · med` (or `Auto · high` on an RTX 4070 or above).

### Network (Phase 3 relay)

Prefer wired: Luna's Ethernet expansion card into the venue switch. The relay's address will be the only IP anyone types.

## Setup order

1. Power, GPU, no-sleep and Do not disturb (table above).
2. Displays: connect the projector, set Extend, check resolution and scale.
3. Audio: plug the interface, pick it in the OS, set 48 kHz.
4. `node serve.mjs`, open `http://localhost:8080/` in Chrome, unlock.
5. Check the Quality menu shows the expected level for this machine.
6. Hydras > Audio on one tile > pick the interface in **Audio input** > check the meters move with the DJ feed.
7. Launch the kiosk window on the projector.

## Keys (Phase 2)

The `03 Set` controller keys (space, 1 to 7, arrows, T, B, H, A, Esc) and the `?` help card arrive in Phase 2.
On the demo site today: **Esc** closes a full screen viewer.

## Panic

- Phase 2 adds **B** (blackout) on the set page, working even if a sketch throws.
- Today: Esc out of full screen; reload the page (the password is remembered for the tab); if Chrome hangs, kill it and relaunch the kiosk line.
- **Fallback video:** record a 10 minute loop beforehand with OBS (Sources > Window Capture > the Chrome output window,
  Settings > Output > Recording: MP4, 1920x1080, 30 fps). If the browser dies, play it full screen in VLC
  (`vlc --fullscreen --loop loop.mp4`) or QuickTime (View > Loop, then full screen).
- **Venue wants a feed:** OBS Window Capture of the output window; NDI through the DistroAV plugin for OBS.
  Mapping, warping and edge blending stay in the venue's tools (Resolume, MadMapper, OBS).
