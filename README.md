# Intercom Camera Card

[![Open your Home Assistant instance and open this repository inside HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=alphasixtyfive&repository=intercom-camera-card&category=plugin)

Lovelace dashboard card for a doorbell or gate intercom camera with low-latency WebRTC video, optional browser microphone talkback, a main/sub stream switcher, and configurable action buttons for gates, lights, sounds, and TTS messages.

![Intercom Camera Card preview](images/preview.jpg)

This card was built for intercom-style Home Assistant dashboards where the useful controls need to be available directly on top of the live camera view: answer/hang up, open a gate, turn on a light, play a warning sound, or send a canned voice message.

## Important: go2rtc dependency

This is a frontend card, not a camera streaming server. It depends on the WebRTC/go2rtc frontend endpoints that expose:

- `/webrtc/video-rtc.js`
- `/api/webrtc/ws`

In practice that means you need a working Home Assistant WebRTC/go2rtc setup, commonly one of these:

- Home Assistant's go2rtc integration where available in your installation.
- AlexxIT's WebRTC Camera integration, which can run or connect to go2rtc.
- Another setup that provides the same Home Assistant WebRTC card endpoints.

The card sends the selected stream or camera entity to the WebRTC endpoint and asks for `video,audio`. When you press the Talk button, it reconnects with `video,audio,microphone` and sends your browser microphone track through WebRTC. go2rtc still has to know how to deliver that microphone audio to the camera or intercom device.

Two-way audio only works when all of these are true:

- The camera/intercom supports talkback through a protocol supported by go2rtc.
- The stream is configured in go2rtc with a source that supports that backchannel.
- Home Assistant is opened in a browser context that allows microphone access. For normal browsers this means HTTPS or localhost.
- The browser, go2rtc, and camera can agree on compatible WebRTC audio codecs or go2rtc can transcode as needed.

If video works but Talk does not, debug go2rtc first. The card can request microphone access and send the WebRTC track, but it cannot add talkback support to a camera stream that go2rtc cannot talk back to.

Useful references:

- Home Assistant go2rtc integration: https://www.home-assistant.io/integrations/go2rtc/
- go2rtc project: https://github.com/AlexxIT/go2rtc
- go2rtc WebRTC notes: https://go2rtc.org/internal/webrtc/

## Installation

### HACS

1. Open HACS.
2. Add `https://github.com/alphasixtyfive/intercom-camera-card` as a custom repository.
3. Select the repository type `Dashboard`.
4. Install the card.
5. Refresh the browser if Home Assistant does not load the new card immediately.

HACS should add the dashboard resource automatically. If you need to add it manually, use:

```yaml
url: /hacsfiles/intercom-camera-card/intercom-camera-card.js
type: module
```

### Manual

Copy `intercom-camera-card.js` to `/config/www/intercom-camera-card.js`, then add this dashboard resource:

```yaml
url: /local/intercom-camera-card.js
type: module
```

## Basic example

Use a go2rtc stream name:

```yaml
type: custom:intercom-camera-card
stream: front_door
```

Use a Home Assistant camera entity:

```yaml
type: custom:intercom-camera-card
entity: camera.front_door
```

Use a direct URL supported by your WebRTC/go2rtc setup:

```yaml
type: custom:intercom-camera-card
url: rtsp://user:password@192.168.1.50:554/Streaming/Channels/101
```

## Complete example

```yaml
type: custom:intercom-camera-card
stream: front_door_main
alternate_stream: front_door_sub
primary_label: Main
alternate_label: Sub
server: http://127.0.0.1:11984
player: media_player.front_door_speaker
tts_entity: tts.home_assistant_cloud
buttons:
  - entity: cover.driveway_gate
    title: Gate
    position: left
  - entity: light.front_porch
    title: Porch
    position: left
  - sound: alert/chime.wav
    title: Chime
    position: right
  - tts: Please leave the parcel by the door.
    title: Parcel
    position: right
  - title: Unlock
    icon: mdi:lock-open-variant
    appearance: warning
    position: right
    tap_action:
      action: perform-action
      perform_action: lock.unlock
      target:
        entity_id: lock.front_door
```

## go2rtc stream example

Exact go2rtc configuration depends on the camera model and protocol. A simple RTSP video stream looks like this:

```yaml
streams:
  front_door_main:
    - rtsp://user:password@192.168.1.50:554/Streaming/Channels/101
  front_door_sub:
    - rtsp://user:password@192.168.1.50:554/Streaming/Channels/102
```

For live talkback, configure the stream using a go2rtc source/protocol that supports two-way audio for your device. For many intercoms this is not the same as a plain receive-only RTSP URL. Verify talkback in the go2rtc Web UI before blaming the card.

## Configuration

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `stream` | string | no | go2rtc stream name or source URL passed to the WebRTC endpoint as `url`. |
| `entity` | string | no | Home Assistant camera entity passed to the WebRTC endpoint as `entity`. Used for the primary stream only. |
| `url` | string | no | Direct stream URL passed to the WebRTC endpoint. Used when `stream` is not set. |
| `alternate_stream` | string | no | Optional second stream. When set, the card shows a stream toggle button. |
| `primary_label` | string | no | Label for the primary stream toggle state. Default: `Main`. |
| `alternate_label` | string | no | Label for the alternate stream toggle state. Default: `Alt`. |
| `server` | string | no | Optional go2rtc server URL passed through to the WebRTC endpoint. Useful when your WebRTC integration supports multiple or external servers. |
| `talk` | boolean/object | no | Set `false` to hide the Talk button, or pass an object to customize talk button labels, icons, colors, and status text. |
| `buttons` | list | no | Action buttons rendered left and right of the Talk button. |
| `player` | string/list | no | Default `media_player` target for sound and TTS buttons. |
| `tts_entity` | string | no | Default TTS entity for TTS buttons. Default: `tts.home_assistant_cloud`. |
| `mobile_pan` | boolean | no | Set `false` to disable horizontal drag panning on small/coarse-pointer screens. |
| `pan` | boolean | no | Alias used by the card to disable panning when set to `false`. |

At least one of `stream`, `entity`, or `url` should be set.

## Talk button

The center Talk button is always present unless `talk: false` is configured.

Default behavior:

- Idle state shows a green phone button.
- Pressing it starts a new WebRTC connection that includes your microphone.
- Pressing it again hangs up and reconnects back to receive-only video/audio.
- While Talk is active, the stream toggle is disabled.
- Sound and TTS buttons are disabled while Talk is active so the camera speaker is not asked to play two different things at once.
- Before starting Talk, the card calls `media_player.media_stop` on configured audio players to stop currently playing sounds or messages.

Browser microphone failures are shown as short status messages:

- `Microphone needs HTTPS or localhost`
- `Allow microphone access`
- `No microphone found`
- `Microphone is busy`
- `Microphone unavailable`

You can customize the Talk button:

```yaml
type: custom:intercom-camera-card
stream: front_door
talk:
  title: Answer
  active_title: Hang up
  icon: mdi:phone
  active_icon: mdi:phone-hangup
  starting_status: Connecting microphone
  active_status: Talking
```

## Action buttons

Buttons are configured in a single `buttons` list. Each button can use `position: left` or `position: right`; left is the default.

### Light button

If the button entity is a `light`, the card automatically creates a light toggle action and state-aware icons.

```yaml
buttons:
  - entity: light.front_porch
    title: Porch
    position: left
```

When the light is unavailable or unknown, the button is disabled automatically.

### Cover or gate button

If the button entity is a `cover`, the card automatically opens when closed and closes when open. It also shows disabled warning states while opening or closing.

```yaml
buttons:
  - entity: cover.driveway_gate
    title: Gate
    position: left
```

The default icon is a garage icon unless the title or entity contains `gate`.

### Sound button

A `sound` button calls `media_player.play_media` on a configured media player.

```yaml
player: media_player.front_door_speaker
buttons:
  - sound: warning.wav
    title: Warning
    position: right
```

Relative sound paths are resolved under `/local/sounds/`, so `warning.wav` becomes `/local/sounds/warning.wav`. Absolute paths and full URLs are used as-is.

You can override the player per button:

```yaml
buttons:
  - sound: /local/custom/doorbell.mp3
    title: Doorbell
    player: media_player.front_door_speaker
```

### TTS button

A `tts` or `message` button calls `tts.speak`.

```yaml
player: media_player.front_door_speaker
tts_entity: tts.home_assistant_cloud
buttons:
  - tts: Please wait a moment.
    title: Wait
    position: right
```

Per-button overrides:

```yaml
buttons:
  - message: Please leave the parcel by the door.
    title: Parcel
    player: media_player.front_door_speaker
    tts_entity: tts.piper
    cache: true
```

### Custom action button

Any button can use a normal Lovelace-style `tap_action`.

```yaml
buttons:
  - title: Unlock
    icon: mdi:lock-open-variant
    appearance: warning
    position: right
    tap_action:
      action: perform-action
      perform_action: lock.unlock
      target:
        entity_id: lock.front_door
```

Supported action styles:

- `perform-action`
- `more-info`
- `fire-dom-event`
- `none`

If a button is written as a plain string, it is treated as an entity and defaults to a `more-info` action unless the entity domain has built-in behavior.

```yaml
buttons:
  - light.front_porch
```

### Stateful button overrides

Buttons can override their look and action by entity state.

```yaml
buttons:
  - entity: binary_sensor.front_door_motion
    title: Motion
    icon: mdi:motion-sensor
    tap_action:
      action: more-info
      entity: binary_sensor.front_door_motion
    states:
      "on":
        title: Motion detected
        icon: mdi:motion-sensor
        background: "#b4552f"
      "off":
        title: No motion
        icon: mdi:motion-sensor-off
      unavailable:
        title: Motion unavailable
        icon: mdi:alert-circle-outline
        disabled: true
```

State override fields:

- `title`
- `icon`
- `color`
- `background`
- `hover_background`
- `border`
- `disabled`
- `hidden`
- `success_status`
- `tap_action`

### Button appearances

Built-in appearances:

- `alert`
- `primary`
- `warning`
- `light`
- `light_on`
- `disabled`

These are just defaults. You can override `color`, `background`, `hover_background`, and `border` per button or per state.

## Stream switcher

When `alternate_stream` is configured, a small toggle appears on the card. It switches between the primary and alternate stream and remembers the selected stream in browser `localStorage`.

The stream switcher is disabled while Talk is active because the card has to hold the microphone WebRTC session to the current stream.

## Mobile panning

The card uses `object-fit: cover` to fill the available area. On small screens or coarse-pointer devices, if the video is wider than the card, you can drag horizontally to pan the cropped video. The pan position is saved per stream in browser `localStorage`.

Disable it with:

```yaml
mobile_pan: false
```

or:

```yaml
pan: false
```

## Troubleshooting

### The card is blank or says the custom element is missing

Check that the JavaScript resource is loaded as a module and refresh the browser cache.

### The browser console says `/webrtc/video-rtc.js` cannot be loaded

The WebRTC/go2rtc frontend dependency is missing. Install or fix the WebRTC Camera/go2rtc integration that provides that file.

### Video connects but Talk fails

Check:

- Home Assistant is opened through HTTPS or localhost.
- The browser has microphone permission.
- The microphone is not already in use by another app.
- go2rtc can do two-way audio with this camera.
- The stream source is configured for the camera's talkback protocol, not only receive-only RTSP.

### Buttons do nothing

Check that the button has a valid `tap_action` or uses one of the built-in button types. Also check that required target entities are available. Audio buttons are disabled while Talk is active.

## Development

The card is a plain JavaScript module. There is no build step.

Syntax check:

```bash
node --check intercom-camera-card.js
```

## License

MIT
