import {VideoRTC} from '/webrtc/video-rtc.js?v=1.9.9';

const CAMERA_MEDIA = 'video,audio';
const TALK_MEDIA = 'video,audio,microphone';
const STREAM_MODE = 'webrtc';
const BUTTON_COOLDOWN_MS = 700;
const STREAM_STORAGE_PREFIX = 'intercom-camera-card:stream:';
const PAN_STORAGE_PREFIX = 'intercom-camera-card:pan:';
const DEFAULT_PRIMARY_STREAM_LABEL = 'Main';
const DEFAULT_ALTERNATE_STREAM_LABEL = 'Alt';
const DEFAULT_TTS_ENTITY = 'tts.home_assistant_cloud';
const UNAVAILABLE_ENTITY_STATES = new Set(['unavailable', 'unknown']);
const DEFAULT_VIDEO_PAN_X = 50;

const CARD_STYLE = {
    height: 'calc(100dvh - 96px)',
    height_mobile: 'calc(100dvh - 72px)',
    fit: 'cover',
    shade_background: 'linear-gradient(to top, rgba(5, 11, 20, 0.68), rgba(5, 11, 20, 0.20) 56%, rgba(0, 0, 0, 0))',
    controls_gap: '18px',
    controls_width: '420px',
    controls_width_mobile: '360px',
    button_size: '68px',
    button_size_mobile: '56px',
    icon_size: '30px',
    button_background: 'rgba(9, 18, 32, 0.72)',
    button_hover_background: 'rgba(18, 35, 58, 0.84)',
    button_border: '1px solid rgba(255, 255, 255, 0.22)',
    button_shadow: '0 10px 28px rgba(0, 0, 0, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.14)',
    icon_shadow: '0 2px 8px rgba(0, 0, 0, 0.42)',
    status_background: 'rgba(5, 11, 20, 0.72)',
};

const TALK_BUTTON = {
    enabled: true,
    title: 'Talk',
    active_title: 'Hang up',
    icon: 'mdi:phone',
    active_icon: 'mdi:phone-hangup',
    color: '#ffffff',
    active_color: '#ffffff',
    background: '#159447',
    hover_background: '#18a95a',
    active_background: '#d43d32',
    active_border: '1px solid rgba(255, 255, 255, 0.28)',
    busy_color: '#07111f',
    busy_background: '#f5b640',
    busy_border: '1px solid rgba(255, 255, 255, 0.32)',
    starting_status: 'Connecting microphone',
    ending_status: 'Ending talk',
    active_status: 'Talking',
    requesting_status: 'Enabling microphone',
};

const SOUND_BASE_PATH = '/local/sounds/';

const BUTTON_STYLE_PRESETS = {
    alert: {
        color: '#ffffff',
        background: '#b4552f',
        hover_background: '#c9643b',
    },
    primary: {
        color: '#ffffff',
        background: '#1f6feb',
        hover_background: '#2f81f7',
    },
    warning: {
        color: '#07111f',
        background: '#f5b640',
        hover_background: '#fbbf24',
    },
    light: {
        color: '#ffcf6b',
    },
    light_on: {
        color: '#ffffff',
        background: '#f59e0b',
        hover_background: '#fbbf24',
    },
    disabled: {
        color: '#d6dde8',
        background: 'rgba(79, 86, 99, 0.62)',
    },
};

class IntercomCameraCard extends VideoRTC {
    constructor() {
        super();

        this._hass = null;
        this.config = null;
        this.connectionGeneration = 0;
        this.talking = false;
        this.streamVariant = 'primary';
        this.videoPanX = DEFAULT_VIDEO_PAN_X;
        this.mobilePanEnabled = true;
        this.panGesture = null;
        this.resizeObserver = null;
        this.panResizeHandlerInstalled = false;
        this.keepFrameOnDisconnect = false;
        this.pendingActionIds = new Set();
        this.leftButtons = [];
        this.rightButtons = [];
        this.talkButton = {...TALK_BUTTON};
        this.localMicrophoneTracks = [];
        this.pendingConnectStatus = undefined;
        this.statusHoldUntil = 0;
        this.elementInView = true;
        this.visibilityHandlersInstalled = false;
        this.visibilityObserver = null;
        this.handlePageHide = () => this.disconnectImmediately();
        this.handleVisibilityChange = () => this.syncVisibility();
        this.handlePanPointerDown = ev => this.onPanPointerDown(ev);
        this.handlePanPointerMove = ev => this.onPanPointerMove(ev);
        this.handlePanPointerEnd = ev => this.onPanPointerEnd(ev);
        this.handleResize = () => this.updatePanAvailability();
    }

    setConfig(config) {
        const nextConfig = config || {};
        if (!nextConfig.stream && !nextConfig.url && !nextConfig.entity) {
            console.warn('Intercom Camera Card: missing `stream`, `url`, or `entity`');
        }

        this.config = {...nextConfig};
        this.streamVariant = this.loadStreamVariant();
        this.mobilePanEnabled = nextConfig.mobile_pan !== false && nextConfig.pan !== false;
        this.videoPanX = this.loadVideoPanX();

        this.talkButton = this.normalizeTalkButton();
        if (!this.talkButton.enabled) this.talking = false;
        this.mode = STREAM_MODE;
        this.media = this.mediaForTalkState();
        this.background = false;
        this.visibilityThreshold = 0.75;

        this.leftButtons = this.normalizeButtons('left');
        this.rightButtons = this.normalizeButtons('right');

        if (this.video) {
            this.applyConfigToDom();
        }
    }

    set hass(hass) {
        const hadHass = Boolean(this._hass);
        this._hass = hass;
        this.updateStatefulButtons();
        if (!hadHass) this.onconnect();
    }

    get hass() {
        return this._hass;
    }

    getCardSize() {
        return 8;
    }

    getGridOptions() {
        return {
            columns: 12,
            min_columns: 6,
            rows: 8,
            min_rows: 6,
        };
    }

    connectedCallback() {
        super.connectedCallback();
        this.installVisibilityHandlers();
        this.installPanResizeObserver();
    }

    disconnectedCallback() {
        this.removeVisibilityHandlers();
        this.removePanControls();
        this.disconnectImmediately();
    }

    disconnectImmediately() {
        if (this.background) return;
        this.clearReconnectTimers();
        if (this.wsState === WebSocket.CLOSED && this.pcState === WebSocket.CLOSED && !this.ws && !this.pc) return;
        this.ondisconnect();
    }

    oninit() {
        this.video = document.createElement('video');
        this.video.controls = false;
        this.video.playsInline = true;
        this.video.preload = 'auto';
        this.video.volume = 1;

        const shadow = this.attachShadow({mode: 'open'});
        shadow.innerHTML = `
            <style>
                :host {
                    display: block;
                }
                ha-card {
                    position: relative;
                    height: var(--intercom-height);
                    min-height: 420px;
                    overflow: hidden;
                    border-radius: 8px;
                    background: #050505;
                    box-shadow: none;
                }
                .stage {
                    position: relative;
                    width: 100%;
                    height: 100%;
                    overflow: hidden;
                    background: #050505;
                    isolation: isolate;
                    container-type: inline-size;
                }
                .video-wrap {
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
                    block-size: var(--button-size, var(--intercom-button-size));
                    inline-size: var(--button-size, var(--intercom-button-size));
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
                button:hover {
                    background: var(--button-hover-background, var(--intercom-button-hover-background));
                }
                button:active {
                    transform: scale(0.94);
                }
                button:focus-visible {
                    outline: 2px solid rgba(116, 184, 255, 0.86);
                    outline-offset: 3px;
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
                    inline-size: auto;
                    width: auto;
                    block-size: 34px;
                    height: 34px;
                    min-width: 56px;
                    min-inline-size: 56px;
                    flex-basis: auto;
                    aspect-ratio: auto;
                    padding: 0 13px;
                    color: rgba(255, 255, 255, 0.94);
                    background: rgba(5, 11, 20, 0.56);
                    border: 1px solid rgba(255, 255, 255, 0.22);
                    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
                    font: 700 12px/1 var(--paper-font-body1_-_font-family, sans-serif);
                    letter-spacing: 0;
                    text-transform: uppercase;
                    backdrop-filter: blur(10px);
                    -webkit-backdrop-filter: blur(10px);
                }
                button.stream-toggle:hover {
                    background: rgba(18, 35, 58, 0.72);
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
                    --iron-icon-width: var(--button-icon-size, var(--intercom-icon-size));
                    --iron-icon-height: var(--button-icon-size, var(--intercom-icon-size));
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
                    left: 50%;
                    z-index: 2;
                    transform: translateX(-50%);
                    min-width: 74px;
                    max-width: min(82%, 420px);
                    padding: 9px 14px;
                    border-radius: 999px;
                    color: rgba(255, 255, 255, 0.94);
                    background: var(--intercom-status-background);
                    backdrop-filter: blur(10px);
                    -webkit-backdrop-filter: blur(10px);
                    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
                    font: 600 13px/1.25 var(--paper-font-body1_-_font-family, sans-serif);
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    text-align: center;
                    opacity: 0;
                    transition: opacity 150ms ease;
                    pointer-events: none;
                }
                .status.visible {
                    opacity: 1;
                }
                @media (max-width: 680px) {
                    ha-card {
                        height: var(--intercom-height-mobile);
                        min-height: 360px;
                        border-radius: 0;
                    }
                    .controls {
                        left: max(8px, env(safe-area-inset-left));
                        right: max(8px, env(safe-area-inset-right));
                        bottom: max(14px, calc(env(safe-area-inset-bottom) + 8px));
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
                        inline-size: var(--button-size-mobile, var(--intercom-button-size-mobile));
                        block-size: var(--button-size-mobile, var(--intercom-button-size-mobile));
                        flex: none;
                    }
                    button.stream-toggle {
                        top: 12px;
                        right: 10px;
                        block-size: 32px;
                        height: 32px;
                        min-width: 52px;
                        min-inline-size: 52px;
                        padding: 0 11px;
                        font-size: 11px;
                    }
                }
                @container (max-width: 680px) {
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
                        inline-size: var(--button-size-mobile, var(--intercom-button-size-mobile));
                        block-size: var(--button-size-mobile, var(--intercom-button-size-mobile));
                        flex: none;
                    }
                    button.stream-toggle {
                        top: 12px;
                        right: 10px;
                        block-size: 32px;
                        height: 32px;
                        min-width: 52px;
                        min-inline-size: 52px;
                        padding: 0 11px;
                        font-size: 11px;
                    }
                }
                @media (max-width: 380px) {
                    .controls {
                        row-gap: 8px;
                        column-gap: 8px;
                        grid-template-columns: repeat(auto-fit, minmax(52px, 52px));
                    }
                    button {
                        width: 52px;
                        height: 52px;
                        inline-size: 52px;
                        block-size: 52px;
                        flex-basis: 52px;
                        --button-icon-size: 27px;
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
                        inline-size: 52px;
                        block-size: 52px;
                        flex-basis: 52px;
                        --button-icon-size: 27px;
                    }
                }
            </style>
            <ha-card>
                <div class="stage">
                    <div class="video-wrap"></div>
                    <div class="shade"></div>
                    <div class="status"></div>
                    <button class="stream-toggle" type="button" hidden></button>
                    <div class="controls">
                        <div class="button-group left-buttons"></div>
                        <button class="talk" type="button"></button>
                        <div class="button-group right-buttons"></div>
                    </div>
                </div>
            </ha-card>
        `;

        this.$ = selectors => this.shadowRoot.querySelector(selectors);
        this.$('.video-wrap').appendChild(this.video);

        this.applyConfigToDom();
        this.bindControls();
        this.bindPanControls();
        this.bindVideoLifecycle();
        this.installVisibilityHandlers();
    }

    bindControls() {
        this.$('.stage').addEventListener('pointerup', () => this.enableAudio(), {passive: true});
        this.$('.talk').addEventListener('click', () => this.toggleTalk());
        this.$('.stream-toggle').addEventListener('click', () => this.toggleStreamVariant());
    }

    bindPanControls() {
        const wrap = this.$('.video-wrap');
        wrap.addEventListener('pointerdown', this.handlePanPointerDown, {passive: false});
        wrap.addEventListener('pointermove', this.handlePanPointerMove, {passive: false});
        wrap.addEventListener('pointerup', this.handlePanPointerEnd, {passive: false});
        wrap.addEventListener('pointercancel', this.handlePanPointerEnd, {passive: false});
        wrap.addEventListener('lostpointercapture', this.handlePanPointerEnd, {passive: false});

        this.installPanResizeObserver();
    }

    installPanResizeObserver() {
        if (!this.shadowRoot || this.resizeObserver || this.panResizeHandlerInstalled) return;

        const wrap = this.$('.video-wrap');
        if (!wrap) return;

        if ('ResizeObserver' in window) {
            this.resizeObserver = new ResizeObserver(this.handleResize);
            this.resizeObserver.observe(wrap);
        } else {
            window.addEventListener('resize', this.handleResize, {passive: true});
            this.panResizeHandlerInstalled = true;
        }
    }

    enableAudio() {
        if (!this.video) return;
        this.video.muted = false;
        this.video.volume = 1;
        this.play();
    }

    bindVideoLifecycle() {
        this.video.addEventListener('error', ev => {
            console.warn(ev);
            if (this.ws) this.ws.close();
        });

        this.video.addEventListener('playing', () => this.setTalkBusy(false));
        this.video.addEventListener('loadedmetadata', () => this.updatePanAvailability());
        this.video.addEventListener('loadeddata', () => this.updatePanAvailability());
        this.video.addEventListener('playing', () => this.updatePanAvailability());

        const safari = window.navigator.userAgent.match(/Version\/(\d+).+Safari/);
        if (safari) {
            const skip = safari[1] < '13' ? 'mp4a.40.2' : safari[1] < '14' ? 'flac' : 'opus';
            const index = this.CODECS.indexOf(skip);
            if (index >= 0) this.CODECS.splice(index);
        }
    }

    installVisibilityHandlers() {
        if (this.background || this.visibilityHandlersInstalled) return;

        this.visibilityHandlersInstalled = true;
        window.addEventListener('pagehide', this.handlePageHide, {passive: true});

        if ('hidden' in document && this.visibilityCheck) {
            document.addEventListener('visibilitychange', this.handleVisibilityChange);
        }

        if ('IntersectionObserver' in window && this.visibilityThreshold) {
            this.visibilityObserver = new IntersectionObserver(entries => {
                entries.forEach(entry => {
                    this.elementInView = entry.isIntersecting;
                    this.syncVisibility();
                });
            }, {threshold: this.visibilityThreshold});
            this.visibilityObserver.observe(this);
        }
    }

    removeVisibilityHandlers() {
        if (!this.visibilityHandlersInstalled) return;

        window.removeEventListener('pagehide', this.handlePageHide);
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        this.visibilityObserver?.disconnect();
        this.visibilityObserver = null;
        this.visibilityHandlersInstalled = false;
    }

    removePanControls() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        if (this.panResizeHandlerInstalled) {
            window.removeEventListener('resize', this.handleResize);
            this.panResizeHandlerInstalled = false;
        }
        this.panGesture = null;
    }

    syncVisibility() {
        if (!this.shouldStream()) {
            this.disconnectImmediately();
            return;
        }

        this.onconnect();
    }

    shouldStream() {
        return this.hasVideoSource() && this.isConnected && document.hidden !== true && this.elementInView !== false;
    }

    applyConfigToDom() {
        if (!this.shadowRoot || !this.config) return;

        this.applyStyleVariables();
        this.video.muted = false;
        this.video.volume = 1;
        this.renderActionButtons();
        this.updateStreamToggle();
        this.updateTalkButton();
        this.updateStatefulButtons();
        this.applyVideoPan();
        if (!this.hasVideoSource()) this.showStatus('Camera source unavailable');
    }

    applyStyleVariables() {
        const styles = CARD_STYLE;
        const root = this.style;
        const vars = {
            '--intercom-height': styles.height,
            '--intercom-height-mobile': styles.height_mobile,
            '--intercom-fit': styles.fit,
            '--intercom-shade-background': styles.shade_background,
            '--intercom-controls-gap': styles.controls_gap,
            '--intercom-controls-width': styles.controls_width,
            '--intercom-controls-width-mobile': styles.controls_width_mobile,
            '--intercom-button-size': styles.button_size,
            '--intercom-button-size-mobile': styles.button_size_mobile,
            '--intercom-icon-size': styles.icon_size,
            '--intercom-button-background': styles.button_background,
            '--intercom-button-hover-background': styles.button_hover_background,
            '--intercom-button-border': styles.button_border,
            '--intercom-button-shadow': styles.button_shadow,
            '--intercom-icon-shadow': styles.icon_shadow,
            '--intercom-status-background': styles.status_background,
            '--intercom-video-pan-x': `${this.videoPanX}%`,
        };

        Object.entries(vars).forEach(([name, value]) => {
            root.setProperty(name, value);
        });
    }

    applyVideoPan() {
        this.style.setProperty('--intercom-video-pan-x', `${this.videoPanX}%`);
        this.updatePanAvailability();
    }

    normalizeTalkButton() {
        if (this.config.talk === false) {
            return {...TALK_BUTTON, enabled: false};
        }

        const config = typeof this.config.talk === 'object' && this.config.talk !== null
            ? this.config.talk
            : {};
        const settings = {...config};
        delete settings.mode;

        return {...TALK_BUTTON, ...settings};
    }

    mediaForTalkState() {
        return this.talking ? TALK_MEDIA : CAMERA_MEDIA;
    }

    normalizeButtons(position) {
        if (Array.isArray(this.config.buttons)) {
            return this.config.buttons
                .filter(button => (button.position || 'left') === position)
                .map((button, index) => this.normalizeButton(button, `${position}-${index}`));
        }

        return [];
    }

    normalizeButton(value, fallbackId) {
        const button = typeof value === 'string'
            ? {entity: value}
            : {...(value || {})};
        const defaults = this.buttonDefaults(button);
        const merged = {...defaults, ...button};
        const title = merged.title || this.defaultButtonTitle(merged) || '';
        const tapAction = this.normalizeLovelaceAction(button.tap_action || defaults.tap_action || button);

        return {
            id: fallbackId,
            entity: button.entity || defaults.entity,
            title,
            icon: merged.icon || 'mdi:circle',
            color: merged.color || '#f3f7ff',
            background: merged.background,
            hover_background: merged.hover_background,
            border: merged.border,
            audio: Boolean(merged.audio ?? this.isAudioAction(tapAction)),
            player: merged.player || this.playerFromAction(tapAction),
            states: merged.states || {},
            success_status: merged.success_status,
            cooldown: merged.cooldown ?? BUTTON_COOLDOWN_MS,
            tap_action: tapAction,
        };
    }

    buttonDefaults(button) {
        if (button.sound) return this.soundButtonDefaults(button);
        if (button.tts || button.message) return this.ttsButtonDefaults(button);

        const domain = this.entityDomain(button.entity);
        if (domain === 'light') return this.lightButtonDefaults(button);
        if (domain === 'cover') return this.coverButtonDefaults(button);

        return this.appearanceDefaults(button.appearance);
    }

    soundButtonDefaults(button) {
        const player = button.player || this.config.player || this.defaultPlayerEntity(button.entity);
        if (!player) return this.appearanceDefaults(button.appearance || 'alert');

        return {
            ...this.appearanceDefaults(button.appearance || 'alert'),
            audio: true,
            player,
            icon: button.icon || 'mdi:bullhorn',
            tap_action: {
                action: 'perform-action',
                perform_action: 'media_player.play_media',
                target: {entity_id: player},
                data: {
                    media_content_type: 'music',
                    media_content_id: this.resolveMediaPath(button.sound),
                },
            },
        };
    }

    ttsButtonDefaults(button) {
        const player = button.player || this.config.player || this.defaultPlayerEntity(button.entity);
        const message = button.tts || button.message;
        const ttsEntity = button.tts_entity || this.config.tts_entity || DEFAULT_TTS_ENTITY;
        if (!player || !message || !ttsEntity) return this.appearanceDefaults(button.appearance || 'alert');

        return {
            ...this.appearanceDefaults(button.appearance || 'alert'),
            audio: true,
            player,
            icon: button.icon || 'mdi:message-alert',
            success_status: button.success_status || 'Playing message',
            tap_action: {
                action: 'perform-action',
                perform_action: 'tts.speak',
                target: {entity_id: ttsEntity},
                data: {
                    media_player_entity_id: player,
                    message,
                    cache: button.cache ?? true,
                },
            },
        };
    }

    lightButtonDefaults(button) {
        const title = button.title || this.defaultButtonTitle(button) || 'Light';

        return {
            ...this.appearanceDefaults('light'),
            icon: button.icon || 'mdi:lightbulb-off-outline',
            tap_action: this.performActionConfig('light.toggle', button.entity),
            states: {
                on: {
                    ...this.appearanceDefaults('light_on'),
                    title: `${title} on`,
                    icon: 'mdi:lightbulb-on',
                },
                off: {
                    ...this.appearanceDefaults('light'),
                    title: `${title} off`,
                    icon: button.icon || 'mdi:lightbulb-off-outline',
                },
                unavailable: {
                    ...this.appearanceDefaults('disabled'),
                    title: `${title} unavailable`,
                    icon: 'mdi:lightbulb-alert',
                    disabled: true,
                },
                unknown: {
                    ...this.appearanceDefaults('disabled'),
                    title: `${title} unknown`,
                    icon: 'mdi:lightbulb-alert',
                    disabled: true,
                },
            },
        };
    }

    coverButtonDefaults(button) {
        const title = button.title || this.defaultButtonTitle(button) || 'Cover';
        const closedIcon = button.icon || this.defaultCoverIcon(button, false);
        const openIcon = this.defaultCoverIcon(button, true);
        const appearance = button.appearance || 'primary';

        return {
            ...this.appearanceDefaults(appearance),
            icon: closedIcon,
            states: {
                closed: {
                    ...this.appearanceDefaults(appearance),
                    title: `Open ${title}`,
                    icon: closedIcon,
                    success_status: `Opening ${title}`,
                    tap_action: this.performActionConfig('cover.open_cover', button.entity),
                },
                open: {
                    ...this.appearanceDefaults(appearance),
                    title: `Close ${title}`,
                    icon: openIcon,
                    success_status: `Closing ${title}`,
                    tap_action: this.performActionConfig('cover.close_cover', button.entity),
                },
                opening: {
                    ...this.appearanceDefaults('warning'),
                    title: `${title} opening`,
                    icon: openIcon,
                    disabled: true,
                },
                closing: {
                    ...this.appearanceDefaults('warning'),
                    title: `${title} closing`,
                    icon: closedIcon,
                    disabled: true,
                },
                unavailable: {
                    ...this.appearanceDefaults('disabled'),
                    title: `${title} unavailable`,
                    icon: 'mdi:alert-circle-outline',
                    disabled: true,
                },
                unknown: {
                    ...this.appearanceDefaults('disabled'),
                    title: `${title} unknown`,
                    icon: 'mdi:alert-circle-outline',
                    disabled: true,
                },
            },
        };
    }

    appearanceDefaults(appearance) {
        return {...(BUTTON_STYLE_PRESETS[appearance] || {})};
    }

    performActionConfig(actionName, entityId) {
        if (!entityId) return undefined;

        return {
            action: 'perform-action',
            perform_action: actionName,
            target: {entity_id: entityId},
        };
    }

    resolveMediaPath(path) {
        if (!path) return path;
        if (path.startsWith('/') || path.includes('://')) return path;
        return SOUND_BASE_PATH + path;
    }

    defaultPlayerEntity(entityId) {
        if (this.entityDomain(entityId) === 'media_player') return entityId;

        const stream = this.config.stream;
        if (typeof stream !== 'string' || !/^[a-z0-9_]+$/i.test(stream)) return undefined;
        return `media_player.${stream.toLowerCase()}`;
    }

    defaultCoverIcon(button, open) {
        const label = `${button.title || ''} ${button.entity || ''}`.toLowerCase();
        if (label.includes('gate')) return open ? 'mdi:gate-open' : 'mdi:gate';
        return open ? 'mdi:garage-open' : 'mdi:garage';
    }

    entityDomain(entityId) {
        return entityId?.split('.', 1)[0];
    }

    defaultButtonTitle(button) {
        const entityId = button.entity || '';
        const objectId = entityId.includes('.') ? entityId.split('.')[1] : '';
        if (!objectId) return '';
        return objectId.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
    }

    normalizeLovelaceAction(action) {
        if (!action) return undefined;

        if (action.tap_action) return this.normalizeLovelaceAction(action.tap_action);
        if (action.action) return {...action};
        if (action.perform_action) return {action: 'perform-action', ...action};
        if (action.entity) {
            return {
                action: 'more-info',
                entity: action.entity,
            };
        }

        return {action: 'none'};
    }

    isAudioAction(action) {
        const actionName = action?.perform_action || action?.service;
        return actionName === 'media_player.play_media' || actionName === 'tts.speak';
    }

    playerFromAction(action) {
        if (!this.isAudioAction(action)) return undefined;

        const actionName = action?.perform_action || action?.service;
        const entityId = actionName === 'tts.speak'
            ? action?.data?.media_player_entity_id
            : action?.target?.entity_id || action?.data?.entity_id || action?.entity;
        const players = this.asArray(entityId).filter(entity => this.entityDomain(entity) === 'media_player');
        if (!players.length) return undefined;
        return players.length === 1 ? players[0] : players;
    }

    asArray(value) {
        if (Array.isArray(value)) return value;
        return value ? [value] : [];
    }

    hasAlternateStream() {
        return Boolean(this.config?.alternate_stream);
    }

    useAlternateStream() {
        return this.hasAlternateStream() && this.streamVariant === 'alternate';
    }

    activeVideoSource() {
        return this.useAlternateStream()
            ? this.config.alternate_stream
            : this.config.stream || this.config.url;
    }

    hasVideoSource() {
        return Boolean(this.config?.entity || this.config?.stream || this.config?.url);
    }

    canPanVideo() {
        return this.mobilePanEnabled
            && this.hasVideoSource()
            && this.isMobilePanContext()
            && this.videoHorizontalOverflow() > 1;
    }

    isMobilePanContext() {
        return window.matchMedia?.('(max-width: 680px), (pointer: coarse)')?.matches ?? false;
    }

    videoHorizontalOverflow() {
        if (!this.video?.videoWidth || !this.video?.videoHeight || !this.shadowRoot) return 0;
        if (getComputedStyle(this.video).objectFit !== 'cover') return 0;

        const wrap = this.$('.video-wrap');
        const width = wrap?.clientWidth || 0;
        const height = wrap?.clientHeight || 0;
        if (!width || !height) return 0;

        const scale = Math.max(width / this.video.videoWidth, height / this.video.videoHeight);
        return Math.max(0, this.video.videoWidth * scale - width);
    }

    updatePanAvailability() {
        if (!this.shadowRoot) return;
        this.$('.stage')?.classList.toggle('pannable', this.canPanVideo());
    }

    onPanPointerDown(ev) {
        if (!ev.isPrimary || !this.canPanVideo()) return;

        const wrap = this.$('.video-wrap');
        this.panGesture = {
            pointerId: ev.pointerId,
            startX: ev.clientX,
            startY: ev.clientY,
            startPanX: this.videoPanX,
            active: false,
        };

        try {
            wrap.setPointerCapture(ev.pointerId);
        } catch (err) {
            console.debug(err);
        }
    }

    onPanPointerMove(ev) {
        const gesture = this.panGesture;
        if (!gesture || ev.pointerId !== gesture.pointerId) return;

        const dx = ev.clientX - gesture.startX;
        const dy = ev.clientY - gesture.startY;

        if (!gesture.active) {
            if (Math.abs(dx) < 8) return;
            if (Math.abs(dx) < Math.abs(dy) * 1.15) return;
            gesture.active = true;
            this.$('.stage')?.classList.add('panning');
        }

        ev.preventDefault();
        ev.stopPropagation();

        const overflow = this.videoHorizontalOverflow();
        if (!overflow) return;

        this.videoPanX = this.clamp(gesture.startPanX - (dx / overflow) * 100, 0, 100);
        this.applyVideoPan();
    }

    onPanPointerEnd(ev) {
        const gesture = this.panGesture;
        if (!gesture || ev.pointerId !== gesture.pointerId) return;

        if (gesture.active) {
            ev.preventDefault?.();
            ev.stopPropagation?.();
            this.saveVideoPanX();
        }

        this.$('.stage')?.classList.remove('panning');
        this.panGesture = null;
    }

    panPreferenceKey() {
        const source = this.useAlternateStream()
            ? this.config?.alternate_stream
            : this.config?.stream || this.config?.url || this.config?.entity || '';
        return source ? `${PAN_STORAGE_PREFIX}${encodeURIComponent(source)}` : '';
    }

    loadVideoPanX() {
        const key = this.panPreferenceKey();
        if (!key) return DEFAULT_VIDEO_PAN_X;

        try {
            const stored = Number(localStorage.getItem(key));
            return Number.isFinite(stored) ? this.clamp(stored, 0, 100) : DEFAULT_VIDEO_PAN_X;
        } catch (err) {
            console.debug(err);
            return DEFAULT_VIDEO_PAN_X;
        }
    }

    saveVideoPanX() {
        const key = this.panPreferenceKey();
        if (!key) return;

        try {
            localStorage.setItem(key, String(Math.round(this.videoPanX)));
        } catch (err) {
            console.debug(err);
        }
    }

    clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    streamLabel(variant = this.streamVariant) {
        if (variant === 'alternate') {
            return this.config.alternate_label || DEFAULT_ALTERNATE_STREAM_LABEL;
        }
        return this.config.primary_label || DEFAULT_PRIMARY_STREAM_LABEL;
    }

    streamPreferenceKey() {
        if (!this.hasAlternateStream()) return '';

        const primary = this.config.stream || this.config.url || this.config.entity || '';
        const alternate = this.config.alternate_stream || '';
        return `${STREAM_STORAGE_PREFIX}${encodeURIComponent(primary)}:${encodeURIComponent(alternate)}`;
    }

    loadStreamVariant() {
        const key = this.streamPreferenceKey();
        if (!key) return 'primary';

        try {
            return localStorage.getItem(key) === 'alternate' ? 'alternate' : 'primary';
        } catch (err) {
            console.debug(err);
            return 'primary';
        }
    }

    saveStreamVariant() {
        const key = this.streamPreferenceKey();
        if (!key) return;

        try {
            localStorage.setItem(key, this.streamVariant);
        } catch (err) {
            console.debug(err);
        }
    }

    updateStreamToggle() {
        if (!this.shadowRoot) return;

        const button = this.$('.stream-toggle');
        button.hidden = !this.hasAlternateStream();
        if (button.hidden) return;

        const nextVariant = this.useAlternateStream() ? 'primary' : 'alternate';
        const currentLabel = this.streamLabel();
        const nextLabel = this.streamLabel(nextVariant);
        const title = this.talking
            ? 'Hang up before switching stream'
            : `Switch to ${nextLabel}`;

        button.textContent = currentLabel;
        button.title = title;
        button.disabled = this.talking;
        button.setAttribute('aria-label', title);
        button.setAttribute('aria-pressed', this.useAlternateStream() ? 'true' : 'false');
    }

    toggleStreamVariant() {
        if (!this.hasAlternateStream() || this.talking) return;

        this.streamVariant = this.useAlternateStream() ? 'primary' : 'alternate';
        this.saveStreamVariant();
        this.videoPanX = this.loadVideoPanX();
        this.applyVideoPan();
        this.updateStreamToggle();

        if (this.isConnected) {
            this.reconnectKeepingFrame(`Switching to ${this.streamLabel()}`, false);
        }
    }

    renderActionButtons() {
        this.renderButtonGroup('.left-buttons', this.leftButtons);
        this.renderButtonGroup('.right-buttons', this.rightButtons);
    }

    renderButtonGroup(selector, buttons) {
        const group = this.$(selector);
        group.replaceChildren(...buttons.map(buttonConfig => this.createActionButton(buttonConfig)));
    }

    createActionButton(buttonConfig) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.buttonId = buttonConfig.id;
        button.title = buttonConfig.title;
        button.setAttribute('aria-label', buttonConfig.title || buttonConfig.id);

        const icon = document.createElement('ha-icon');
        icon.setAttribute('aria-hidden', 'true');
        icon.setAttribute('icon', buttonConfig.icon);
        button.appendChild(icon);

        this.applyStateToButton(button, buttonConfig);
        this.bindActionButton(button, buttonConfig);
        return button;
    }

    bindActionButton(button, buttonConfig) {
        button.addEventListener('click', ev => {
            ev.preventDefault();
            if (button.disabled) return;
            this.dispatchButtonAction(button, buttonConfig);
        });
    }

    updateStatefulButtons() {
        if (!this.shadowRoot) return;

        const buttons = Array.from(this.shadowRoot.querySelectorAll('[data-button-id]'));
        [...this.leftButtons, ...this.rightButtons].forEach(buttonConfig => {
            const button = buttons.find(element => element.dataset.buttonId === buttonConfig.id);
            if (button) this.applyStateToButton(button, buttonConfig);
        });
    }

    applyStateToButton(button, config) {
        const state = this.entityStateForButton(config);
        const stateConfig = this.effectiveStateConfigForButton(config, state);
        const visual = this.buttonVisualConfig(config, stateConfig);

        const icon = button.querySelector('ha-icon');
        if (visual.icon && icon) icon.setAttribute('icon', visual.icon);
        button.title = visual.title || config.id;
        button.setAttribute('aria-label', visual.title || config.id);
        this.setOptionalVar(button, '--button-color', visual.color);
        this.setOptionalVar(button, '--button-background', visual.background);
        this.setOptionalVar(button, '--button-hover-background', visual.hover_background);
        this.setOptionalVar(button, '--button-border', visual.border);

        if (state) {
            button.dataset.entityState = state;
        } else {
            delete button.dataset.entityState;
        }
        button.hidden = this.buttonHidden(stateConfig);
        this.syncButtonDisabled(button, config, state, stateConfig);
    }

    buttonVisualConfig(config, stateConfig = {}) {
        return {
            title: stateConfig.title ?? config.title,
            icon: stateConfig.icon ?? config.icon,
            color: stateConfig.color ?? config.color,
            background: stateConfig.background ?? config.background,
            hover_background: stateConfig.hover_background ?? config.hover_background,
            border: stateConfig.border ?? config.border,
        };
    }

    entityStateForButton(config) {
        if (!config.entity) return undefined;
        if (!this.hass?.states) return 'unavailable';
        return this.hass.states[config.entity]?.state || 'unavailable';
    }

    stateConfigForButton(config, state) {
        if (!state) return {};
        if (this.isUnavailableState(state)) {
            return config.states?.[state] || config.states?.unavailable || this.unavailableButtonConfig(config, state);
        }
        if (!config.states) return {};
        return config.states[state] || config.states.default || {};
    }

    effectiveStateConfigForButton(config, state = this.entityStateForButton(config)) {
        return {
            ...this.stateConfigForButton(config, state),
            ...this.audioPlayerAvailabilityConfig(config),
        };
    }

    audioPlayerAvailabilityConfig(config) {
        if (!config.audio) return {};

        const players = this.asArray(config.player).filter(player => this.entityDomain(player) === 'media_player');
        if (!players.length) return this.unavailableButtonConfig(config, 'unavailable', 'Audio target unavailable', 'mdi:speaker-off');

        if (!this.hass?.states) {
            return this.unavailableButtonConfig(config, 'unavailable', `${config.title || 'Audio'} unavailable`, 'mdi:speaker-off');
        }

        const unavailablePlayer = players.find(player => !this.entityAvailable(player));
        if (!unavailablePlayer) return {};

        const title = `${config.title || this.defaultButtonTitle({entity: unavailablePlayer}) || 'Audio'} unavailable`;
        return this.unavailableButtonConfig(config, 'unavailable', title, 'mdi:speaker-off');
    }

    unavailableButtonConfig(config, state = 'unavailable', title, icon = 'mdi:alert-circle-outline') {
        const label = config.title || this.defaultButtonTitle(config) || 'Button';
        return {
            ...this.appearanceDefaults('disabled'),
            title: title || `${label} ${state}`,
            icon,
            disabled: true,
        };
    }

    isUnavailableState(state) {
        return UNAVAILABLE_ENTITY_STATES.has(state);
    }

    entityAvailable(entityId) {
        const state = this.hass?.states?.[entityId]?.state;
        return Boolean(state) && !this.isUnavailableState(state);
    }

    buttonHidden(stateConfig) {
        return Boolean(stateConfig.hidden);
    }

    syncButtonDisabled(button, config, state = this.entityStateForButton(config), stateConfig) {
        const currentStateConfig = stateConfig || this.effectiveStateConfigForButton(config, state);
        const stateDisabled = Boolean(currentStateConfig.disabled);
        const audioDisabled = this.talking && Boolean(config.audio);
        const actionConfig = currentStateConfig.tap_action || config.tap_action;
        const actionDisabled = !actionConfig || actionConfig.action === 'none';

        button.disabled = this.pendingActionIds.has(config.id) || stateDisabled || audioDisabled || actionDisabled;
        button.classList.toggle('state-disabled', stateDisabled);
        button.classList.toggle('audio-disabled', audioDisabled);
        button.classList.toggle('action-disabled', actionDisabled);
        if (audioDisabled) {
            button.title = 'Hang up before playing audio';
            button.setAttribute('aria-label', button.title);
        }
    }

    setOptionalVar(element, name, value) {
        if (value !== undefined && value !== null) {
            element.style.setProperty(name, value);
        } else {
            element.style.removeProperty(name);
        }
    }

    updateTalkButton() {
        if (!this.shadowRoot) return;

        const button = this.$('.talk');
        button.hidden = !this.talkButton.enabled;
        if (!this.talkButton.enabled) return;

        const icon = button.querySelector('ha-icon') || document.createElement('ha-icon');
        if (!icon.parentElement) button.appendChild(icon);
        icon.setAttribute('aria-hidden', 'true');

        const title = this.talking ? this.talkButton.active_title : this.talkButton.title;
        const iconName = this.talking ? this.talkButton.active_icon : this.talkButton.icon;
        const color = this.talking ? this.talkButton.active_color : this.talkButton.color;
        const sourceUnavailable = !this.hasVideoSource();
        const buttonTitle = sourceUnavailable ? 'Camera source unavailable' : title;

        button.classList.toggle('active', this.talking);
        button.classList.toggle('source-disabled', sourceUnavailable);
        button.disabled = sourceUnavailable || button.classList.contains('busy');
        button.title = buttonTitle;
        button.setAttribute('aria-label', buttonTitle);
        button.setAttribute('aria-pressed', this.talking ? 'true' : 'false');
        icon.setAttribute('icon', iconName);
        button.style.setProperty('--button-color', color);
        button.style.setProperty('--talk-active-color', this.talkButton.active_color);
        button.style.setProperty('--talk-busy-color', this.talkButton.busy_color);

        this.setOptionalVar(button, '--button-background', this.talkButton.background);
        this.setOptionalVar(button, '--button-hover-background', this.talkButton.hover_background);
        this.setOptionalVar(button, '--button-border', this.talkButton.border);
        this.setOptionalVar(button, '--talk-active-background', this.talkButton.active_background);
        this.setOptionalVar(button, '--talk-active-border', this.talkButton.active_border);
        this.setOptionalVar(button, '--talk-busy-background', this.talkButton.busy_background);
        this.setOptionalVar(button, '--talk-busy-border', this.talkButton.busy_border);
    }

    onconnect() {
        if (!this.config || !this.hass) return false;
        if (!this.hasVideoSource()) {
            this.showStatus('Camera source unavailable');
            return false;
        }
        if (!this.shouldStream() || this.ws || this.pc) return false;

        const generation = ++this.connectionGeneration;
        const status = this.pendingConnectStatus
            ?? (this.talking ? this.talkButton.starting_status : 'Connecting video');
        this.pendingConnectStatus = undefined;
        if (status) this.showStatus(status);

        this.hass.callWS({
            type: 'auth/sign_path',
            path: '/api/webrtc/ws',
        }).then(data => {
            if (!this.canStartConnection(generation)) return;

            this.wsURL = this.buildWebSocketUrl(data.path);
            if (!this.wsURL) {
                this.showStatus('Camera source unavailable');
                this.setTalkBusy(false);
                return;
            }

            if (!super.onconnect()) {
                this.setTalkBusy(false);
            }
        }).catch(err => {
            if (generation !== this.connectionGeneration) return;
            console.warn(err);
            this.showStatus('Connection error', 1800);
            this.setTalkBusy(false);
            this.scheduleReconnect();
        });

        return true;
    }

    canStartConnection(generation) {
        return generation === this.connectionGeneration
            && this.shouldStream()
            && !this.ws
            && !this.pc;
    }

    buildWebSocketUrl(path) {
        const params = new URLSearchParams();
        if (this.config.entity && !this.useAlternateStream()) {
            params.set('entity', this.config.entity);
        } else if (this.activeVideoSource()) {
            params.set('url', this.activeVideoSource());
        } else {
            return '';
        }
        if (this.config.server) {
            params.set('server', this.config.server);
        }

        const separator = path.includes('?') ? '&' : '?';
        return `ws${this.hass.hassUrl(path).substring(4)}${separator}${params}`;
    }

    onopen() {
        const modes = super.onopen();
        if (!modes.includes('webrtc')) {
            this.showStatus('WebRTC unsupported', 3200);
            this.setTalkBusy(false);
            return modes;
        }

        this.onmessage.intercom = msg => {
            switch (msg.type) {
                case 'error':
                    console.warn(msg.value);
                    this.showStatus(this.streamErrorStatus(msg.value), 3200);
                    this.setTalkBusy(false);
                    break;
            }
        };
        return modes;
    }

    onpcvideo(video2) {
        super.onpcvideo(video2);
        if (this.pcState !== WebSocket.CLOSED && this.talking) {
            if (this.hasLiveMicrophoneTrack()) {
                this.showStatus(this.talkButton.active_status);
            } else {
                this.setTalking(false);
                this.showStatus('Microphone unavailable', 3200);
            }
        }
        this.setTalkBusy(false);
    }

    async createOffer(pc) {
        try {
            if (this.media.indexOf('microphone') >= 0) {
                if (this.talking) {
                    this.showStatus(this.talkButton.requesting_status);
                }
                if (!navigator.mediaDevices?.getUserMedia) {
                    throw new Error('getUserMedia unavailable');
                }
                const media = await navigator.mediaDevices.getUserMedia({audio: true});
                const tracks = media.getAudioTracks();
                if (!tracks.length) {
                    throw new Error('No microphone track');
                }

                try {
                    tracks.forEach(track => {
                        pc.addTransceiver(track, {direction: 'sendonly'});
                        this.localMicrophoneTracks.push(track);
                        track.addEventListener('ended', () => this.onMicrophoneEnded(track), {once: true});
                    });
                } catch (err) {
                    this.stopTracks(tracks);
                    throw err;
                }
            }
        } catch (err) {
            this.onMicrophoneError(err);
        }

        for (const kind of ['video', 'audio']) {
            if (this.media.indexOf(kind) >= 0) {
                pc.addTransceiver(kind, {direction: 'recvonly'});
            }
        }

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        return offer;
    }

    ondisconnect() {
        this.connectionGeneration++;
        const fullDisconnect = !this.keepFrameOnDisconnect;
        if (fullDisconnect) {
            if (this.talking) this.setTalking(false);
            this.pendingConnectStatus = undefined;
            this.setTalkBusy(false);
            this.showStatus('', 0);
        }

        this.wsState = WebSocket.CLOSED;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.pcState = WebSocket.CLOSED;
        if (this.pc) {
            this.capturePoster();
            this.stopTracks(this.pc.getSenders().map(sender => sender.track));
            this.stopTracks(this.pc.getReceivers().map(receiver => receiver.track));
            this.pc.close();
            this.pc = null;
        }
        this.stopTracks(this.localMicrophoneTracks);
        this.localMicrophoneTracks = [];
        this.stopStreamTracks(this.video?.srcObject);
        if (!this.video) return;

        if (this.keepFrameOnDisconnect && this.video.poster) {
            this.video.src = '';
            this.video.srcObject = null;
            return;
        }

        if (!this.keepFrameOnDisconnect) {
            this.video.src = '';
            this.video.srcObject = null;
        }
    }

    stopStreamTracks(stream) {
        if (stream?.getTracks) {
            this.stopTracks(stream.getTracks());
        }
    }

    stopTracks(tracks = []) {
        tracks.filter(Boolean).forEach(track => {
            try {
                track.stop();
            } catch (err) {
                console.debug(err);
            }
        });
    }

    async toggleTalk() {
        const button = this.$('.talk');
        if (!this.talkButton.enabled || button.disabled) return;

        const nextTalking = !this.talking;
        if (nextTalking) {
            this.setTalking(true);
            this.setTalkBusy(true, this.talkButton.starting_status);
            await this.stopAudioPlayers();
        } else {
            this.setTalking(false);
        }

        this.reconnectKeepingFrame(
            this.talking ? this.talkButton.starting_status : this.talkButton.ending_status
        );
    }

    onMicrophoneError(err) {
        console.warn('Intercom microphone unavailable', {
            secureContext: window.isSecureContext,
            protocol: window.location.protocol,
            host: window.location.host,
            hasMediaDevices: Boolean(navigator.mediaDevices),
            hasGetUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
            errorName: err?.name,
            errorMessage: err?.message,
        });
        if (this.hasLiveMicrophoneTrack()) {
            this.setTalkBusy(false);
            if (this.talking) this.showStatus(this.talkButton.active_status);
            return;
        }
        if (!this.talking) {
            this.setTalkBusy(false);
            return;
        }
        this.setTalking(false);
        this.setTalkBusy(false);
        this.showStatus(this.microphoneErrorStatus(err), 3200);
    }

    microphoneErrorStatus(err) {
        if (!navigator.mediaDevices?.getUserMedia) {
            return window.isSecureContext === false
                ? 'Microphone needs HTTPS or localhost'
                : 'Microphone API unavailable';
        }
        if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
            return 'Allow microphone access';
        }
        if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
            return 'No microphone found';
        }
        if (err?.name === 'NotReadableError' || err?.name === 'TrackStartError') {
            return 'Microphone is busy';
        }
        return 'Microphone unavailable';
    }

    setTalking(talking) {
        this.talking = Boolean(talking);
        this.mode = STREAM_MODE;
        this.media = this.mediaForTalkState();
        this.updateTalkButton();
        this.updateStreamToggle();
        this.updateStatefulButtons();
    }

    hasLiveMicrophoneTrack() {
        return this.liveMicrophoneTracks().length > 0;
    }

    liveMicrophoneTracks() {
        this.localMicrophoneTracks = this.localMicrophoneTracks.filter(track => track.readyState === 'live');
        return this.localMicrophoneTracks;
    }

    onMicrophoneEnded(track) {
        this.localMicrophoneTracks = this.localMicrophoneTracks.filter(item => item !== track);
        if (this.talking && !this.hasLiveMicrophoneTrack()) {
            this.setTalking(false);
            this.setTalkBusy(false);
            this.showStatus('Microphone disconnected', 3200);
        }
    }

    async stopAudioPlayers() {
        const players = this.audioPlayers();
        if (!players.length || !this.hass?.callService) return;

        try {
            await this.hass.callService('media_player', 'media_stop', {
                entity_id: players,
            });
        } catch (err) {
            console.warn(err);
        }
    }

    audioPlayers() {
        const players = [
            this.config?.player,
            ...[...this.leftButtons, ...this.rightButtons].flatMap(button => button.player),
        ].flatMap(value => this.asArray(value));

        return [...new Set(players.filter(player => (
            this.entityDomain(player) === 'media_player' && this.entityAvailable(player)
        )))];
    }

    streamErrorStatus(value) {
        if (!value) return 'Stream error';
        const text = String(value);
        if (text.length <= 64) return text;
        return `${text.slice(0, 61)}...`;
    }

    reconnectKeepingFrame(status, talkBusy = true) {
        if (talkBusy) {
            this.setTalkBusy(true, status);
        } else {
            this.showStatus(status);
        }
        this.clearReconnectTimers();
        this.pendingConnectStatus = status;

        this.keepFrameOnDisconnect = true;
        this.ondisconnect();
        this.keepFrameOnDisconnect = false;

        this.scheduleReconnect(120);
    }

    scheduleReconnect(delay = this.RECONNECT_TIMEOUT) {
        this.clearReconnectTimers();
        const generation = this.connectionGeneration;
        this.reconnectTID = setTimeout(() => {
            this.reconnectTID = 0;
            if (generation === this.connectionGeneration) this.onconnect();
        }, delay);
    }

    clearReconnectTimers() {
        if (this.disconnectTID) {
            clearTimeout(this.disconnectTID);
            this.disconnectTID = 0;
        }
        if (this.reconnectTID) {
            clearTimeout(this.reconnectTID);
            this.reconnectTID = 0;
        }
    }

    setTalkBusy(busy, status) {
        if (!this.shadowRoot) return;

        const button = this.$('.talk');
        const sourceUnavailable = !this.hasVideoSource();
        button.disabled = Boolean(busy) || sourceUnavailable;
        button.classList.toggle('busy', Boolean(busy));
        button.classList.toggle('source-disabled', sourceUnavailable);
        button.setAttribute('aria-busy', busy ? 'true' : 'false');
        if (sourceUnavailable && !busy) {
            button.title = 'Camera source unavailable';
            button.setAttribute('aria-label', button.title);
        }
        if (status) {
            this.showStatus(status);
        } else if (!busy && !this.talking && Date.now() >= this.statusHoldUntil) {
            this.showStatus('', 0);
        }
    }

    dispatchButtonAction(button, buttonConfig) {
        if (this.pendingActionIds.has(buttonConfig.id)) return;

        const state = this.entityStateForButton(buttonConfig);
        const stateConfig = this.effectiveStateConfigForButton(buttonConfig, state);
        if (this.buttonHidden(stateConfig)) return;
        if (stateConfig.disabled) return;

        const actionConfig = stateConfig.tap_action || buttonConfig.tap_action;
        if (!actionConfig || actionConfig.action === 'none') return;

        this.pendingActionIds.add(buttonConfig.id);
        button.disabled = true;
        setTimeout(() => {
            this.pendingActionIds.delete(buttonConfig.id);
            this.updateStatefulButtons();
        }, buttonConfig.cooldown);

        if (actionConfig.action === 'fire-dom-event') {
            this.fireDomEvent(actionConfig, buttonConfig);
        } else {
            this.fireHassAction(buttonConfig, stateConfig);
        }

        const successStatus = stateConfig.success_status ?? buttonConfig.success_status;
        if (successStatus) {
            this.showStatus(successStatus, 1200);
        }
    }

    fireHassAction(buttonConfig, stateConfig) {
        const event = new CustomEvent('hass-action', {
            bubbles: true,
            composed: true,
            detail: {
                action: 'tap',
                config: this.actionHandlerConfig(buttonConfig, stateConfig),
            },
        });
        this.dispatchEvent(event);
    }

    actionHandlerConfig(buttonConfig, stateConfig = {}) {
        return {
            entity: buttonConfig.entity,
            tap_action: stateConfig.tap_action || buttonConfig.tap_action,
        };
    }

    fireDomEvent(actionConfig, buttonConfig) {
        const type = actionConfig.event_type || 'intercom-camera-card-action';
        const {event_data: eventData, ...actionDetail} = actionConfig;
        this.dispatchEvent(new CustomEvent(type, {
            bubbles: true,
            composed: true,
            detail: {
                ...actionDetail,
                ...(eventData || {}),
                config: this.config,
                button: buttonConfig,
            },
        }));
    }

    showStatus(text, timeout = 0) {
        if (!this.shadowRoot) return;

        const status = this.$('.status');
        status.textContent = text || '';
        status.classList.toggle('visible', Boolean(text));

        if (this.statusTimeout) {
            clearTimeout(this.statusTimeout);
            this.statusTimeout = 0;
        }
        if (text && timeout) {
            this.statusHoldUntil = Date.now() + timeout;
            this.statusTimeout = setTimeout(() => this.showStatus('', 0), timeout);
        } else if (!timeout) {
            this.statusHoldUntil = 0;
        }
    }

    capturePoster() {
        if (!this.video || !this.video.videoWidth || !this.video.videoHeight) return;

        try {
            const canvas = document.createElement('canvas');
            canvas.width = this.video.videoWidth;
            canvas.height = this.video.videoHeight;
            canvas.getContext('2d').drawImage(this.video, 0, 0, canvas.width, canvas.height);
            this.video.poster = canvas.toDataURL('image/jpeg', 0.82);
        } catch (err) {
            console.debug(err);
        }
    }
}

if (!customElements.get('intercom-camera-card')) {
    customElements.define('intercom-camera-card', IntercomCameraCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some(card => card.type === 'intercom-camera-card')) {
    window.customCards.push({
        type: 'intercom-camera-card',
        name: 'Intercom Camera Card',
        preview: false,
        description: 'A configurable intercom camera card with talk-back controls.',
    });
}
