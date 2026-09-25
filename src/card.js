import { TALK_BUTTON } from './defaults.js';
import { IntercomStream } from './stream.js';
import { IntercomButtons } from './buttons.js';
import { VideoPan } from './pan.js';
import { CARD_TEMPLATE } from './template.js';
import { normalizeConfig, connectionKey, getConfigForm, talkSettings } from './config.js';

export class IntercomCameraCard extends IntercomStream {
    constructor() {
        super();

        this._hass = null;
        this.config = null;
        this.pan = new VideoPan(this);
        this.buttons = new IntercomButtons(this);
        this.talkButton = { ...TALK_BUTTON };
        this.statusHoldUntil = 0;
        this.statusTimeout = 0;
    }

    setConfig(config) {
        const nextConfig = normalizeConfig(config);
        const sourceChanged = connectionKey(this.config) !== connectionKey(nextConfig);
        const stopTalking = this.talking && !talkSettings(nextConfig).enabled;
        if (sourceChanged || stopTalking) this.disconnectImmediately();
        this.config = nextConfig;
        if (sourceChanged) this.streamVariant = this.loadStreamVariant();
        this.pan.configure();
        this.talkButton = talkSettings(nextConfig);
        this.media = this.mediaForTalkState();

        this.buttons.configure();

        if (this.video) {
            this.applyConfigToDom();
        }
        if (sourceChanged || stopTalking) this.onconnect();
    }

    set hass(hass) {
        const previous = this._hass;
        this._hass = hass;
        if (this.isConnected) this.buttons.updateStatefulButtons(previous);
        if (!previous && this.config && !this.isConnected) {
            this.getSignedPath().catch(() => {});
        }
        if (!previous) this.onconnect();
    }

    get hass() {
        return this._hass;
    }

    getCardSize() {
        return Math.ceil((this.getBoundingClientRect().height || 400) / 50);
    }

    static getConfigForm() {
        return getConfigForm();
    }

    static getStubConfig(hass) {
        const entity = Object.keys(hass?.states ?? {}).find((id) => id.startsWith('camera.'));
        return entity
            ? { entity, talk: true, mobile_pan: true }
            : { stream: 'front_door', talk: true, mobile_pan: true };
    }

    set layout(layout) {
        this.toggleAttribute('panel', layout === 'panel');
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
        this.pan.installPanResizeObserver();
        this.buttons.updateStatefulButtons();
    }

    disconnectedCallback() {
        this.removeVisibilityHandlers();
        this.pan.removePanControls();
        this.disconnectImmediately();
        this.buttons.dispose();
    }

    oninit() {
        this.video = document.createElement('video');
        this.video.controls = false;
        this.video.playsInline = true;
        this.video.preload = 'auto';
        this.video.volume = 1;

        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = CARD_TEMPLATE;

        this.$ = (selectors) => this.shadowRoot.querySelector(selectors);
        this.$('.video-wrap').appendChild(this.video);

        this.applyConfigToDom();
        this.bindControls();
        this.pan.bindPanControls();
        this.bindVideoLifecycle();
        this.installVisibilityHandlers();
    }

    bindControls() {
        this.$('.stage').addEventListener('pointerup', () => this.enableAudio(), { passive: true });
        this.$('.talk').addEventListener('click', () => this.toggleTalk());
        this.$('.stream-toggle').addEventListener('click', () => this.toggleStreamVariant());
    }

    enableAudio() {
        if (!this.video) return;
        this.video.muted = false;
        this.video.volume = 1;
        this.play();
    }

    bindVideoLifecycle() {
        this.video.addEventListener('error', () => {
            if (this.ws || this.pc) {
                this.connectionFailed(this.video.error, this.connectionGeneration);
            }
        });

        this.video.addEventListener('playing', () => {
            this.onVideoPlaying();
        });
        this.video.addEventListener('loadedmetadata', () => this.pan.updatePanAvailability());
        this.video.addEventListener('loadeddata', () => this.pan.updatePanAvailability());
        this.video.addEventListener('playing', () => this.pan.updatePanAvailability());
    }

    applyConfigToDom() {
        if (!this.shadowRoot || !this.config) return;

        this.buttons.renderActionButtons();
        this.updateStreamToggle();
        this.updateTalkButton();
        this.buttons.updateStatefulButtons();
        this.pan.applyVideoPan();
        if (!this.hasVideoSource()) this.showStatus('Camera source unavailable');
    }

    updateStreamToggle() {
        if (!this.shadowRoot) return;

        const button = this.$('.stream-toggle');
        button.hidden = !this.hasAlternateStream();
        if (button.hidden) return;

        const nextVariant = this.useAlternateStream() ? 'primary' : 'alternate';
        const currentLabel = this.streamLabel();
        const nextLabel = this.streamLabel(nextVariant);
        const title = this.talking ? 'Hang up before switching stream' : `Switch to ${nextLabel}`;

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
        this.pan.videoPanX = this.pan.loadVideoPanX();
        this.pan.applyVideoPan();
        this.updateStreamToggle();

        if (this.isConnected) {
            this.reconnectKeepingFrame(`Switching to ${this.streamLabel()}`, false);
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
        button.disabled = sourceUnavailable || (button.classList.contains('busy') && !this.talking);
        button.title = buttonTitle;
        button.setAttribute('aria-label', buttonTitle);
        button.setAttribute('aria-pressed', this.talking ? 'true' : 'false');
        icon.setAttribute('icon', iconName);
        button.style.setProperty('--button-color', color);
        button.style.setProperty('--talk-active-color', this.talkButton.active_color);
        button.style.setProperty('--talk-busy-color', this.talkButton.busy_color);

        this.buttons.setOptionalVar(button, '--button-background', this.talkButton.background);
        this.buttons.setOptionalVar(
            button,
            '--button-hover-background',
            this.talkButton.hover_background,
        );
        this.buttons.setOptionalVar(button, '--button-border', this.talkButton.border);
        this.buttons.setOptionalVar(
            button,
            '--talk-active-background',
            this.talkButton.active_background,
        );
        this.buttons.setOptionalVar(button, '--talk-active-border', this.talkButton.active_border);
        this.buttons.setOptionalVar(
            button,
            '--talk-busy-background',
            this.talkButton.busy_background,
        );
        this.buttons.setOptionalVar(button, '--talk-busy-border', this.talkButton.busy_border);
    }

    setTalkBusy(busy, status) {
        if (!this.shadowRoot) return;

        const button = this.$('.talk');
        const sourceUnavailable = !this.hasVideoSource();
        button.disabled = (Boolean(busy) && !this.talking) || sourceUnavailable;
        button.classList.toggle('busy', Boolean(busy));
        button.classList.toggle('source-disabled', sourceUnavailable);
        button.setAttribute('aria-busy', busy ? 'true' : 'false');
        if (sourceUnavailable && !busy) {
            button.title = 'Camera source unavailable';
            button.setAttribute('aria-label', button.title);
        }
        if (status) {
            this.showStatus(status, 0, busy ? 'center' : 'corner');
        } else if (!busy && !this.talking && Date.now() >= this.statusHoldUntil) {
            this.showStatus('', 0);
        }
    }

    showStatus(text, timeout = 0, position = 'corner') {
        if (!this.shadowRoot) return;

        const status = this.$('.status');
        status.textContent = text || '';
        status.classList.toggle('visible', Boolean(text));
        status.classList.toggle('centered', Boolean(text) && position === 'center');

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
}

if (!customElements.get('intercom-camera-card')) {
    customElements.define('intercom-camera-card', IntercomCameraCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === 'intercom-camera-card')) {
    window.customCards.push({
        type: 'intercom-camera-card',
        name: 'Intercom Camera Card',
        preview: false,
        description: 'A configurable intercom camera card with talk-back controls.',
        documentationURL: 'https://github.com/alphasixtyfive/intercom-camera-card',
    });
}
