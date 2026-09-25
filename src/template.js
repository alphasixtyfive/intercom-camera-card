export const CARD_TEMPLATE = `
<style>
    :host {
        display: block;
        --intercom-height: calc(100dvh - 96px);
        --intercom-height-mobile: calc(100dvh - 72px);
        --intercom-fit: cover;
        --intercom-shade-background: linear-gradient(to top, rgba(0, 0, 0, 0.68), rgba(0, 0, 0, 0.18) 56%, transparent);
        --intercom-controls-gap: 18px;
        --intercom-controls-width: 420px;
        --intercom-button-size: 68px;
        --intercom-button-size-mobile: 56px;
        --intercom-icon-size: 30px;
        --intercom-button-background: rgba(25, 25, 25, 0.72);
        --intercom-button-hover-background: rgba(45, 45, 45, 0.84);
        --intercom-button-border: 1px solid rgba(255, 255, 255, 0.22);
        --intercom-button-shadow: 0 10px 28px rgba(0, 0, 0, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.14);
        --intercom-icon-shadow: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.42));
        --intercom-status-background: rgba(25, 25, 25, 0.78);
        height: 100%;
    }
    ha-card {
        display: block;
        position: relative;
        height: 100%;
        min-height: 328px;
        overflow: hidden;
    }
    :host([panel]) ha-card {
        height: var(--intercom-height);
    }
    .stage {
        min-height: inherit;
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #050505;
        isolation: isolate;
        container-type: inline-size;
    }
    .video-wrap {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        touch-action: auto;
    }
    video {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: var(--intercom-fit);
        object-position: var(--intercom-video-pan-x, 50%) center;
        background: #050505;
        transition: filter 180ms ease, transform 180ms ease;
    }
    video.loading {
        filter: blur(7px) brightness(0.62);
        transform: scale(1.025);
    }
    video:focus-visible {
        outline: 2px solid var(--primary-color, #03a9f4);
        outline-offset: -4px;
    }
    .stage.pannable video {
        cursor: grab;
    }
    .stage.pannable .video-wrap {
        touch-action: pan-y;
    }
    .stage.panning video {
        cursor: grabbing;
    }
    .shade {
        position: absolute;
        inset: auto 0 0 0;
        height: 38%;
        pointer-events: none;
        background: var(--intercom-shade-background);
        z-index: 1;
    }
    .controls {
        position: absolute;
        left: 50%;
        bottom: max(clamp(18px, 4vh, 34px), calc(env(safe-area-inset-bottom) + 12px));
        z-index: 2;
        box-sizing: border-box;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        align-content: center;
        justify-content: center;
        row-gap: var(--intercom-controls-gap);
        column-gap: var(--intercom-controls-gap);
        transform: translateX(-50%);
        width: min(var(--intercom-controls-width), calc(100% - 24px));
        max-width: min(92%, 680px);
        overflow: visible;
    }
    .button-group {
        display: contents;
    }
    button {
        appearance: none;
        border: var(--button-border, var(--intercom-button-border));
        border-radius: 999px;
        color: var(--button-color, var(--intercom-button-color, #fff));
        background: var(--button-background, var(--intercom-button-background));
        box-shadow: var(--button-shadow, var(--intercom-button-shadow));
        box-sizing: border-box;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        width: var(--button-size, var(--intercom-button-size));
        height: var(--button-size, var(--intercom-button-size));
        aspect-ratio: 1 / 1;
        flex: 0 0 var(--button-size, var(--intercom-button-size));
        line-height: 0;
        overflow: hidden;
        padding: 0;
        position: relative;
        transition:
            background 150ms ease,
            border-color 150ms ease,
            color 150ms ease,
            opacity 150ms ease,
            transform 150ms ease;
    }
    @media (hover: hover) {
        button:hover {
            background: var(--button-hover-background, var(--intercom-button-hover-background));
        }
        button.stream-toggle:hover {
            background: var(--intercom-button-hover-background);
        }
    }
    button:active {
        transform: scale(0.94);
    }
    button:focus-visible {
        outline: 2px solid var(--primary-color, #03a9f4);
        outline-offset: 3px;
        box-shadow: 0 0 0 5px rgba(0, 0, 0, 0.75), var(--button-shadow, var(--intercom-button-shadow));
    }
    button[hidden] {
        display: none;
    }
    button[disabled] {
        cursor: wait;
        opacity: 0.48;
    }
    button.audio-disabled[disabled] {
        cursor: not-allowed;
        opacity: 0.38;
    }
    button.stream-toggle {
        position: absolute;
        top: 14px;
        right: 14px;
        z-index: 2;
        width: auto;
        height: 44px;
        min-width: 56px;
        flex-basis: auto;
        aspect-ratio: auto;
        padding: 0 13px;
        color: rgba(255, 255, 255, 0.94);
        background: var(--intercom-button-background);
        border: 1px solid rgba(255, 255, 255, 0.22);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
        font: var(--ha-font-weight-medium, 500) var(--ha-font-size-s, 12px)/1 var(--ha-font-family-body, sans-serif);
        letter-spacing: 0;
        text-transform: uppercase;
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
    }
    button.stream-toggle[disabled] {
        cursor: not-allowed;
    }
    button::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
        pointer-events: none;
    }
    ha-icon {
        --mdc-icon-size: var(--button-icon-size, var(--intercom-icon-size));
        position: absolute;
        top: 50%;
        left: 50%;
        display: flex;
        align-items: center;
        box-sizing: border-box;
        color: currentColor;
        flex: 0 0 auto;
        justify-content: center;
        width: var(--button-icon-size, var(--intercom-icon-size));
        height: var(--button-icon-size, var(--intercom-icon-size));
        line-height: 1;
        margin: 0;
        pointer-events: none;
        transform: translate(-50%, -50%);
        filter: var(--intercom-icon-shadow);
    }
    .talk.active {
        color: var(--talk-active-color);
        background: var(--talk-active-background, var(--button-background, var(--intercom-button-background)));
        border: var(--talk-active-border, var(--button-border, var(--intercom-button-border)));
    }
    .talk.busy {
        color: var(--talk-busy-color);
        background: var(--talk-busy-background, var(--button-background, var(--intercom-button-background)));
        border: var(--talk-busy-border, var(--button-border, var(--intercom-button-border)));
    }
    .talk.active ha-icon {
        filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.34));
    }
    .status {
        position: absolute;
        top: 14px;
        left: 14px;
        z-index: 2;
        box-sizing: border-box;
        min-width: 74px;
        max-width: min(calc(100% - 100px), 420px);
        padding: 9px 14px;
        border-radius: 999px;
        color: rgba(255, 255, 255, 0.94);
        background: var(--intercom-status-background);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
        font: var(--ha-font-weight-medium, 500) var(--ha-font-size-m, 14px)/1.3 var(--ha-font-family-body, sans-serif);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: normal;
        overflow-wrap: anywhere;
        text-align: center;
        opacity: 0;
        transition: opacity 150ms ease;
        pointer-events: none;
    }
    .status.visible {
        opacity: 1;
    }
    .status.centered {
        top: 50%;
        left: 50%;
        max-width: min(calc(100% - 32px), 420px);
        padding: 12px 18px;
        font-size: var(--ha-font-size-xl, 18px);
        transform: translate(-50%, -50%);
    }
    @media (max-width: 680px) {
        :host([panel]) ha-card {
            height: var(--intercom-height-mobile);
            min-height: 360px;
            border-radius: 0;
        }
    }
    @container (max-width: 680px) {
        .status.centered {
            font-size: var(--ha-font-size-l, 16px);
        }
        .controls {
            left: max(8px, env(safe-area-inset-left));
            right: max(8px, env(safe-area-inset-right));
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(var(--button-size-mobile, var(--intercom-button-size-mobile)), var(--button-size-mobile, var(--intercom-button-size-mobile))));
            justify-content: center;
            justify-items: center;
            row-gap: 9px;
            column-gap: 10px;
            width: auto;
            max-width: none;
            transform: none;
        }
        button {
            width: var(--button-size-mobile, var(--intercom-button-size-mobile));
            height: var(--button-size-mobile, var(--intercom-button-size-mobile));
            flex: none;
        }
        button.stream-toggle {
            top: 12px;
            right: 10px;
            height: 44px;
            min-width: 52px;
            padding: 0 11px;
            font-size: 11px;
        }
    }
    @container (max-width: 380px) {
        .controls {
            row-gap: 8px;
            column-gap: 8px;
            grid-template-columns: repeat(auto-fit, minmax(52px, 52px));
        }
        button {
            width: 52px;
            height: 52px;
            flex-basis: 52px;
            --button-icon-size: 27px;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        button, .status, video { transition: none; }
    }
</style>
<ha-card>
    <div class="stage">
        <div class="video-wrap"></div>
        <div class="shade"></div>
        <div class="status" role="status" aria-live="polite" aria-atomic="true"></div>
        <button class="stream-toggle" type="button" hidden></button>
        <div class="controls">
            <div class="button-group left-buttons"></div>
            <button class="talk" type="button"></button>
            <div class="button-group right-buttons"></div>
        </div>
    </div>
</ha-card>
        `;
