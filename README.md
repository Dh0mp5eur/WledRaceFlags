# WLED Race Flags

[Français](README.fr.md) | **English**

Follow the flags of a motor race live and mirror them on your [WLED](https://kno.wled.ge/) LED strips:
the room turns yellow during a caution, red when the race is stopped, and blinks green at the restart.

Supported championships: **NASCAR**, **FIA WEC**, **European Le Mans Series (ELMS)**, **IMSA WeatherTech** and **GT World Challenge Europe**.

The application runs **entirely in the browser**: plain HTML, CSS and JavaScript, no build step, no dependency
and no application server. Just serve the files (or open `index.html`) on a device on the same network as your WLEDs.

> Bilingual interface, English and French: the language follows your browser, and the **FR / EN** selector at the top right changes it at any time (your choice is remembered).

## Features

- **Live tracking** of the public timing feeds of NASCAR, FIA WEC, ELMS, IMSA and GT World Challenge Europe (Endurance and Sprint Cup).
  The WEC and ELMS tabs can also follow practice, qualifying and hyperpole: choose *Session in progress* or a specific session of the weekend
  (the menu lists the sessions present in the live feed). The GTWC tab also offers the support races of the SRO meeting (GT4, GT2, McLaren Trophy…): pick the *Series* and the *Race*, or let *Automatic* follow the race in progress.
- **Strip effects**:
  - green or chequered flag: green blinks, then control is handed back;
  - yellow and red: one second of solid color, then a “breathe” effect for as long as the flag lasts;
  - each effect can be replaced by a **WLED preset** of your choice.
- **Several devices** driven at once, with **discovery on the local network** or manual entry (IP or `wled-xxxx.local`).
- **Hands control back cleanly**: when you stop (or close the tab), the strip returns to its original state,
  or control goes back to another source such as Hyperion.
- **Joining mid-race**: a green flag already showing does not make the strip blink; a yellow or red flag is applied immediately.
- **Broadcast synchronization**: the official timing is often a minute or more ahead of TV.
  - NASCAR: automatic synchronization based on lap times;
  - WEC, ELMS, IMSA and GT World Challenge Europe: a “My broadcast clock” to match with the clock shown on your screen, adjustable during the race.
- **Recording and replay**: every live session can be downloaded as JSON and replayed later,
  from a given time or lap, at any speed, and re-aligned while it runs.
- **NASCAR archive**: replay any past race (Cup, Xfinity, Truck) straight from the official archive, no file needed.
- Settings saved in the browser, with JSON **export and import**. Light or dark theme, usable on a phone.

## Online version

The application is published with GitHub Pages: **<https://dh0mp5eur.github.io/WledRaceFlags/>**.
Nothing to install, but it is served over https while WLEDs answer over http, which limits which browsers work:

| Browser | Online version |
|---|---|
| Chrome, Edge (desktop, Android) | Works once you **allow local network access** when the browser asks, the first time it reaches a WLED |
| Firefox, Safari, any browser on iPhone or iPad | Cannot reach the WLEDs: use a local installation (below) |

**FIA WEC** and **ELMS** live do not work from the online version (see “Known limitations”); NASCAR, IMSA, GT World Challenge Europe and replays do.
Devices must be given as a private IP address (`192.168.1.50`) or a local network name (`wled-xxxx.local`, `wled.lan`).
If access was denied, restore it in the site settings (icon to the left of the address), then reload the page.
The application shows a banner explaining the situation whenever the WLEDs are blocked.

## Local installation

It works with every browser.

Requirements: a recent browser and at least one [WLED](https://kno.wled.ge/) device on the local network.

```sh
git clone https://github.com/Dh0mp5eur/WledRaceFlags.git
cd WledRaceFlags
python3 -m http.server 8000
```

Then open `http://localhost:8000`, or `http://<PC-IP>:8000` from a phone or tablet on the same network.

Any static file server will do. Opening `index.html` directly (`file://`) also works,
but an HTTP server is preferable: the page then has a real http origin, which avoids special cases with the race feeds.

> **Serve the page over http, not https.** WLEDs answer over http, and most browsers block http calls
> made from an https page (mixed content). Only Chrome and Edge accept them, after permission (see “Online version”).

## Usage

The application has three views, reachable from the top bar.

### 1. WLED

- **Scan the network** queries `/json/info` on every address of the given prefix (`192.168.1.` by default, 1 to 254).
  A browser knows neither its own subnet nor mDNS: if the page is served from a private IP address,
  the prefix is deduced from it, otherwise enter yours (it is remembered).
- Or add a device by hand with its IP address or name.
- The **Test** buttons (Green, Yellow, Red, Chequered) play each effect on the devices so you can check everything before the race.

### 2. Race

Pick the championship with the tabs. Each tab has two sections:

- **Live**: follows the race in progress. “No WLED (watch only)” lets you follow without driving the strip.
- **Replay**: replays a recording of that championship (a file downloaded earlier or, for NASCAR, a race from the archive).
  - *Start (time)* or *Lap*: where the replay starts (a lap of 0 means “start from the time”).
  - *Speed* and *Video delay*: to line the replay up with a video.
  - While a replay runs, the button becomes **Resynchronize the replay**: it applies the new settings without restarting.

A recording can only be replayed in the tab of its own championship. NASCAR archive data is published
a few hours after a race ends.

**Matching the flags to your TV (WEC, ELMS, IMSA and GT World Challenge Europe)**: “My broadcast clock” runs and shows the time your broadcast
should display with the current delay. Make it match your screen:

- with the ▲ ▼ buttons of each segment (or the keyboard arrows): the delay changes at once;
- or by typing the time you read on screen: the clock freezes at the first digit, Enter confirms, Esc cancels.

First pick the *Clock type* your broadcast shows: *Time remaining* or *Time elapsed* (GT World Challenge TV usually shows the time elapsed).

### 3. Settings

Brightness, number and duration of the green blinks, WLED presets for each flag, restoring the original state,
network timeouts, TV synchronization parameters and feed addresses. Every setting has a tooltip.

## Permanent hosting

To keep the application available on the local network, serve `index.html`, `css/`, `js/` and `img/`
with any static server. Tests, tools and documentation are not needed.

Example `Caddyfile` (http only):

```caddyfile
http://raceflags.lan {
    root * /var/www/raceflags
    encode zstd gzip
    file_server

    # The page is always revalidated; scripts and CSS carry ?v=<fingerprint>,
    # so their address changes with every update.
    @page path / /index.html
    header @page Cache-Control "no-cache"
    @versioned path /js/* /css/*
    header @versioned Cache-Control "public, max-age=31536000, immutable"
}
```

Copy to the server, for example with `rsync` (add `-n -i` for a dry run):

```sh
node tools/cache-bust.js
rsync -a --no-owner --no-group --checksum --delete index.html css js img user@server:/var/www/raceflags/
```

## Development

```
index.html          Single page (WLED, Race and Settings views)
css/app.css         Styles, light and dark themes
js/core.js          Flags, errors, clock, unthrottled timers (Web Worker)
js/i18n.js          Translations: RF.t(), current language, formats
js/i18n/            One dictionary per language: fr.js, en.js
js/sources/         One source per feed: nascar.js, wec.js (WEC and ELMS), imsa.js, sro.js (GT World Challenge Europe), replay.js
js/engine.js        Tracking loop: flag changes, retries on error, delay
js/sync.js          Broadcast synchronization (per lap or fixed delay)
js/wled.js          WLED client and flag effects
js/discovery.js     WLED discovery on the network
js/recording.js     Recording and replay format
js/nascar-import.js Import from the NASCAR archive
js/settings.js      Defaults, validation, local storage
js/ui.js            User interface (the only file that touches the DOM)
img/                Application icons and championship logos
tests/              Dependency-free Node tests, with a sample recording
tools/              cache-bust.js (cache fingerprints), make-icons.py (icons)
```

Principles:

- Classic `<script defer>` scripts sharing the global `RF` namespace, no ES modules, so that opening from `file://` works.
- WLED commands are sent as `text/plain` `POST` requests (a “simple” request, no CORS preflight).
- A new data source is a `js/sources/<name>.js` file exposing `poll()`, `setSignal()` and `close()`.
- **No hard-coded visible text**: labels, messages and tooltips go through `RF.t('key')` (code) or `data-i18n` (HTML), with the key in every dictionary of `js/i18n/`.
  A test checks that all languages have the same keys and that no text was left hard-coded.

Tests (Node.js, nothing to install):

```sh
node tests/run.js
```

**After any change to `js/` or `css/`**, run `node tools/cache-bust.js` again: it recomputes the `?v=<fingerprint>` parameter
of the tags in `index.html`, so a browser never mixes old and new files. A test fails if the fingerprint is stale.

### Adding a language

1. Copy `js/i18n/en.js` to `js/i18n/<code>.js` (for example `es.js`), change the code in `RF.addMessages('<code>', …)` and translate the texts (keep the `{variables}`; plurals are `{ one, other }` objects).
2. Add the code to `RF.LANGUAGES` (`js/i18n.js`) and the `<script defer src="js/i18n/<code>.js">` tag to `index.html`, after the other dictionaries.
3. Run `node tools/cache-bust.js` then `node tests/run.js`: the tests list missing keys and tooltips that are too long (220 characters at most).

The application icons are generated by `tools/make-icons.py` (Python and `cairosvg`): edit the script and rerun it
rather than editing the images.

## Known limitations

- The tab must stay open during the race. Timers run in a Web Worker and a screen wake lock is requested
  to limit background throttling.
- The timing feeds are public but undocumented: they can change without notice. Their addresses can be edited in Settings.
- **GT World Challenge Europe**: the Swiss Timing feed keeps no flag history, so a race can only be replayed from a recording made live
  (“Record flag changes”). Before the start, the tab waits and shows the scheduled time (track local time). GT World Challenge America, Asia and Australia are not supported yet.
- **FIA WEC and ELMS live: only from `http://localhost`.** Both come from the same timing server, which only allows (CORS) pages opened on `localhost`
  (any port). From the online version, an IP address or a name such as `raceflags.lan`, the browser blocks the feed:
  run the application on the computer that watches the race (`python3 -m http.server 8000`, then `http://localhost:8000`).
  NASCAR, IMSA and replay work everywhere.
- From a public page (such as the online version), Chrome and Edge ask for permission to access the local network; other browsers block the WLEDs.

## License

Copyright © 2026 Dhomps Florian.

This project is free software, released under the **GNU General Public License v3.0** (see [`LICENSE`](LICENSE)).
You may use, study, modify and redistribute it, including in an improved version.
Any redistributed version, modified or not, must remain under GPL-3.0 and come with its source code.

The championship logos (`img/nascar.svg`, `img/wec.svg`, `img/imsa.svg`, `img/elms.png`, `img/gtwc.png`) are not covered by this license (see below).

## Notices

The NASCAR, FIA WEC, IMSA and ELMS logos shown in the tabs come from Wikimedia Commons (details in [`img/README.md`](img/README.md)).
The NASCAR, FIA WEC and IMSA logos are in the public domain as far as copyright goes; the ELMS logo is by Kobokem2021, under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), cropped and resized. The GT World Challenge logo is not from Wikimedia Commons
(source in [`img/README.md`](img/README.md)). They are **registered trademarks** of their owners, used only to identify
the championship being followed.

This project is independent: it is not affiliated with NASCAR, the FIA, the ACO, the ELMS, IMSA or SRO Motorsports Group, nor with the WLED project.
Race data belongs to its publishers; the application only reads the public feeds from your browser.
