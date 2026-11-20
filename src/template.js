export const CARD_TEMPLATE = `
<style>
    :host {
        display: block;
        height: 100%;
        --intercom-height: calc(100dvh - 96px);
        --intercom-height-mobile: calc(100dvh - 72px);
        --intercom-fit: cover;
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
        border: 0;
        border-radius: 0;
        box-shadow: none;
    }
    .stage {
        --overlay-inset: var(--ha-space-4, 16px);
        --overlay-radius: var(--ha-button-border-radius, var(--ha-border-radius-md, 8px));
        --overlay-background: rgba(18, 20, 24, 0.72);
        --overlay-border: var(--ha-border-width-sm, 1px) solid rgba(255, 255, 255, 0.16);
        --focus-color: var(--ha-color-focus, var(--primary-color, #03a9f4));
        position: relative;
        isolation: isolate;
        width: 100%;
        height: 100%;
        min-height: inherit;
        overflow: hidden;
        background: #050505;
        container-type: inline-size;
    }
    .video-wrap { position: absolute; inset: 0; }
    .fallback-image {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: var(--intercom-fit);
        object-position: var(--intercom-video-pan-x, 50%) center;
        filter: blur(7px) brightness(0.62);
        transform: scale(1.025);
    }
    .fallback-image[hidden] { display: none; }
    video {
        position: relative;
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
    video.loading:not([poster]) { opacity: 0; }
    .stage.pannable video { cursor: grab; }
    .stage.pannable .video-wrap { touch-action: pan-y; }
    .stage.panning video { cursor: grabbing; }
    .shade {
        position: absolute;
        inset: 0;
        z-index: 1;
        pointer-events: none;
        background: linear-gradient(to bottom, rgba(0, 0, 0, 0.42), transparent 16%, transparent 65%, rgba(0, 0, 0, 0.48));
    }
    .top-bar {
        position: absolute;
        inset: 0;
        z-index: 2;
        display: flex;
        align-items: flex-start;
        gap: var(--ha-space-2, 8px);
        padding: var(--overlay-inset);
        pointer-events: none;
    }
    button {
        appearance: none;
        box-sizing: border-box;
        cursor: pointer;
        font: inherit;
        transition: background 150ms ease, opacity 150ms ease;
    }
    button:focus-visible, video:focus-visible {
        outline: 2px solid var(--focus-color);
        outline-offset: -3px;
    }
    button[hidden] { display: none; }
    button[disabled] { cursor: not-allowed; opacity: 0.5; }
    .stream-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--ha-space-2, 8px);
        margin-inline-start: auto;
        min-width: 44px;
        min-height: 44px;
        max-width: 50%;
        padding: 0 var(--ha-space-3, 12px);
        pointer-events: auto;
    }
    .stream-toggle ha-icon { --mdc-icon-size: 18px; flex: none; }
    .stream-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .stream-toggle, .status {
        border: var(--overlay-border);
        border-radius: var(--overlay-radius);
        color: #fff;
        background: var(--overlay-background);
        font: var(--ha-font-weight-medium, 500) var(--ha-font-size-s, 12px)/1.4 var(--ha-font-family-body, sans-serif);
    }
    .status {
        box-sizing: border-box;
        min-width: 0;
        max-width: 420px;
        padding: 8px 12px;
        font-size: var(--ha-font-size-m, 14px);
        opacity: 0;
        overflow-wrap: anywhere;
        transition: opacity 150ms ease;
    }
    .status.visible { opacity: 1; }
    .status.centered {
        position: absolute;
        top: 50%;
        left: 50%;
        width: max-content;
        max-width: min(calc(100% - 2 * var(--overlay-inset)), 420px);
        padding: 12px 18px;
        transform: translate(-50%, -50%);
        text-align: center;
        font-size: var(--ha-font-size-l, 16px);
    }
    .controls {
        --control-size: 68px;
        --control-icon-size: 29px;
        --control-gap: 18px;
        position: absolute;
        left: 50%;
        bottom: max(var(--ha-space-4, 16px), calc(env(safe-area-inset-bottom) + 8px));
        z-index: 2;
        display: flex;
        flex-wrap: nowrap;
        justify-content: safe center;
        gap: var(--control-gap);
        box-sizing: border-box;
        width: max-content;
        max-width: min(620px, calc(100% - 2 * var(--overlay-inset)));
        overflow-x: auto;
        overflow-y: hidden;
        padding: 6px 4px 12px;
        overscroll-behavior-inline: contain;
        scrollbar-color: rgba(255, 255, 255, 0.45) transparent;
        scrollbar-width: thin;
        transform: translateX(-50%);
    }
    .controls:not(:has(button:not([hidden]))) { display: none; }
    .button-group { display: contents; }
    .controls button {
        --control-color: var(--button-color, #fff);
        --control-fill: var(--button-background, var(--overlay-background));
        --control-hover: var(--button-hover-background, var(--control-fill));
        --control-border: var(--button-border, var(--overlay-border));
        display: grid;
        place-items: center;
        flex: 0 0 var(--control-size);
        min-height: var(--control-size);
        padding: 0;
        border: 0;
        border-radius: var(--ha-border-radius-circle, 50%);
        background: transparent;
    }
    @media (hover: hover) {
        .stream-toggle:not(:disabled):hover { background: rgba(42, 45, 50, 0.92); }
        .controls button:not(:disabled):hover ha-icon {
            background: var(--control-hover);
        }
    }
    .controls button:focus-visible { outline-offset: 2px; }
    .controls button:not(:disabled):active ha-icon { transform: scale(0.97); }
    .controls ha-icon {
        --mdc-icon-size: var(--control-icon-size);
        display: grid;
        place-items: center;
        box-sizing: border-box;
        width: var(--control-size);
        height: var(--control-size);
        border: var(--control-border);
        border-radius: inherit;
        color: var(--control-color);
        background: var(--control-fill);
        box-shadow: inset 0 1px rgba(255, 255, 255, 0.14), 0 3px 10px rgba(0, 0, 0, 0.28);
        transition: transform 160ms ease, background 160ms ease;
    }
    .controls .talk.active {
        --control-color: var(--talk-active-color);
        --control-fill: var(--talk-active-background, var(--error-color, #db4437));
        --control-hover: var(--control-fill);
        --control-border: var(--talk-active-border, var(--overlay-border));
    }
    .controls .talk.busy {
        --control-color: var(--talk-busy-color);
        --control-fill: var(--talk-busy-background, var(--warning-color, #e6a23c));
        --control-hover: var(--control-fill);
        --control-border: var(--talk-busy-border, var(--overlay-border));
    }
    @media (max-width: 680px) {
        :host([panel]) ha-card {
            height: var(--intercom-height-mobile);
            min-height: 360px;
        }
    }
    @container (max-width: 680px) {
        .top-bar, .controls { --overlay-inset: var(--ha-space-2, 8px); }
        .controls {
            --control-size: 60px;
            --control-icon-size: 25px;
            --control-gap: 10px;
        }
    }
    @container (max-width: 375px) {
        .controls {
            --control-size: 56px;
            --control-gap: var(--ha-space-2, 8px);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        button, .controls ha-icon, .status, video { transition: none; }
    }
</style>
<ha-card>
    <div class="stage">
        <div class="video-wrap"><img class="fallback-image" alt="" hidden></div>
        <div class="shade"></div>
        <div class="top-bar">
            <div class="status" role="status" aria-live="polite" aria-atomic="true"></div>
            <button class="stream-toggle" type="button" hidden><ha-icon icon="mdi:video-switch" aria-hidden="true"></ha-icon><span class="stream-label"></span></button>
        </div>
        <div class="controls" role="group" aria-label="Intercom controls">
            <div class="button-group left-buttons"></div>
            <button class="talk" type="button"><ha-icon aria-hidden="true"></ha-icon></button>
            <div class="button-group right-buttons"></div>
        </div>
    </div>
</ha-card>
`;
