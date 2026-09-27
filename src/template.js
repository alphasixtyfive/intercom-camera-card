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
        border-radius: var(--ha-border-radius-lg, 12px);
    }
    .stage {
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
        inset: 16px 16px auto;
        z-index: 2;
        display: flex;
        align-items: flex-start;
        justify-content: flex-end;
        gap: 12px;
        pointer-events: none;
    }
    button {
        appearance: none;
        box-sizing: border-box;
        border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.15));
        border-radius: var(--ha-border-radius-md, 8px);
        color: var(--button-color, var(--primary-text-color, #fff));
        background: var(--button-background, rgba(255, 255, 255, 0.08));
        cursor: pointer;
        font-family: var(--ha-font-family-body, sans-serif);
        transition: background 150ms ease, opacity 150ms ease;
    }
    @media (hover: hover) {
        button:hover { background: var(--button-hover-background, rgba(255, 255, 255, 0.16)); }
    }
    button:focus-visible, video:focus-visible {
        outline: 2px solid var(--primary-color, #03a9f4);
        outline-offset: -3px;
    }
    button[hidden] { display: none; }
    button[disabled] { cursor: not-allowed; opacity: 0.5; }
    .stream-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        flex: 0 0 auto;
        min-height: 44px;
        padding: 0 14px;
        border-radius: 999px;
        pointer-events: auto;
        color: #fff;
        background: rgba(0, 0, 0, 0.54);
        font-size: var(--ha-font-size-s, 12px);
        font-weight: var(--ha-font-weight-medium, 500);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
    }
    .stream-toggle ha-icon { --mdc-icon-size: 18px; }
    .status {
        position: absolute;
        top: 16px;
        left: 16px;
        z-index: 2;
        max-width: min(calc(100% - 32px), 420px);
        padding: 8px 12px;
        border-radius: var(--ha-border-radius-md, 8px);
        color: #fff;
        background: rgba(0, 0, 0, 0.64);
        font: var(--ha-font-weight-medium, 500) var(--ha-font-size-m, 14px)/1.3 var(--ha-font-family-body, sans-serif);
        opacity: 0;
        pointer-events: none;
        overflow-wrap: anywhere;
        transition: opacity 150ms ease;
    }
    .status.visible { opacity: 1; }
    .status.centered {
        top: 50%;
        left: 50%;
        max-width: min(calc(100% - 32px), 420px);
        padding: 12px 18px;
        transform: translate(-50%, -50%);
        text-align: center;
        font-size: var(--ha-font-size-l, 16px);
    }
    .controls {
        position: absolute;
        left: 50%;
        bottom: max(16px, calc(env(safe-area-inset-bottom) + 8px));
        z-index: 2;
        display: flex;
        flex-wrap: nowrap;
        justify-content: safe center;
        gap: 12px;
        box-sizing: border-box;
        width: min(620px, calc(100% - 24px));
        overflow-x: auto;
        overflow-y: hidden;
        padding: 6px 0 12px;
        overscroll-behavior-inline: contain;
        scrollbar-color: rgba(255, 255, 255, 0.45) transparent;
        scrollbar-width: thin;
        transform: translateX(-50%);
    }
    .button-group { display: contents; }
    .controls button {
        display: flex;
        flex: 0 0 100px;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-width: 0;
        min-height: 68px;
        padding: 0;
        border: 0;
        background: transparent;
        text-align: center;
    }
    @media (hover: hover) {
        .controls button:hover { background: transparent; }
        .controls button:not(:disabled):hover ha-icon {
            transform: translateY(-2px) scale(1.04);
            background: var(--button-hover-background, var(--button-background, rgba(45, 45, 45, 0.84)));
            box-shadow: 0 9px 24px rgba(0, 0, 0, 0.42);
        }
    }
    .controls button:focus-visible { outline: none; }
    .controls button:focus-visible ha-icon {
        outline: 2px solid var(--primary-color, #03a9f4);
        outline-offset: 2px;
    }
    .controls button:not(:disabled):active ha-icon { transform: scale(0.97); }
    .controls ha-icon {
        --mdc-icon-size: 29px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        box-sizing: border-box;
        width: min(68px, 100%);
        height: auto;
        aspect-ratio: 1;
        border: var(--button-border, 1px solid rgba(255, 255, 255, 0.22));
        border-radius: 50%;
        color: var(--button-color, #fff);
        background: var(--button-background, rgba(25, 25, 25, 0.72));
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.34);
        transition: transform 160ms ease, background 160ms ease, box-shadow 160ms ease;
    }
    .controls .talk.active ha-icon {
        color: var(--talk-active-color);
        background: var(--talk-active-background, var(--error-color, #db4437));
        border: var(--talk-active-border, 1px solid rgba(255, 255, 255, 0.22));
    }
    .controls .talk.busy ha-icon {
        color: var(--talk-busy-color);
        background: var(--talk-busy-background, var(--warning-color, #e6a23c));
        border: var(--talk-busy-border, 1px solid rgba(255, 255, 255, 0.22));
    }
    @media (max-width: 680px) {
        :host([panel]) ha-card {
            height: var(--intercom-height-mobile);
            min-height: 360px;
        }
    }
    @container (max-width: 680px) {
        .top-bar { inset: 10px 10px auto; }
        .status { left: 10px; top: 10px; }
        .controls { gap: 8px; width: min(340px, calc(100% - 20px)); }
        .controls button {
            flex: 0 0 calc(20% - 7px);
            min-height: 60px;
        }
        .controls ha-icon { --mdc-icon-size: 25px; width: min(60px, 100%); }
    }
    @container (max-width: 350px) {
        .controls ha-icon { width: min(56px, 100%); }
    }
    @media (prefers-reduced-motion: reduce) {
        button, .controls ha-icon, .status, video { transition: none; }
    }
</style>
<ha-card>
    <div class="stage">
        <div class="video-wrap"></div>
        <div class="shade"></div>
        <div class="top-bar">
            <button class="stream-toggle" type="button" hidden><ha-icon icon="mdi:video-switch" aria-hidden="true"></ha-icon><span class="stream-label"></span></button>
        </div>
        <div class="status" role="status" aria-live="polite" aria-atomic="true"></div>
        <div class="controls" role="group" aria-label="Intercom controls">
            <div class="button-group left-buttons"></div>
            <button class="talk" type="button"><ha-icon aria-hidden="true"></ha-icon></button>
            <div class="button-group right-buttons"></div>
        </div>
    </div>
</ha-card>
`;
