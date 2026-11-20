import { PAN_STORAGE_PREFIX, DEFAULT_VIDEO_PAN_X } from './defaults.js';
import { readPreference, writePreference } from './preferences.js';

export class VideoPan {
    constructor(card) {
        this.card = card;
        this.videoPanX = DEFAULT_VIDEO_PAN_X;
        this.handlePanPointerDown = (event) => this.onPanPointerDown(event);
        this.handlePanPointerMove = (event) => this.onPanPointerMove(event);
        this.handlePanPointerEnd = (event) => this.onPanPointerEnd(event);
        this.handleResize = () => this.updatePanAvailability();
    }

    get config() {
        return this.card.config;
    }
    get video() {
        return this.card.video;
    }

    configure() {
        this.videoPanX = this.loadVideoPanX();
    }

    bindPanControls() {
        this.stage = this.card.$('.stage');
        const wrap = this.card.$('.video-wrap');
        this.wrap = wrap;
        wrap.addEventListener('pointerdown', this.handlePanPointerDown, { passive: false });
        wrap.addEventListener('pointermove', this.handlePanPointerMove, { passive: false });
        wrap.addEventListener('pointerup', this.handlePanPointerEnd, { passive: false });
        wrap.addEventListener('pointercancel', this.handlePanPointerEnd, { passive: false });
        wrap.addEventListener('lostpointercapture', this.handlePanPointerEnd, { passive: false });
    }

    installPanResizeObserver() {
        if (!this.wrap || this.resizeObserver || this.panResizeHandlerInstalled) return;

        if ('ResizeObserver' in window) {
            this.resizeObserver = new ResizeObserver(this.handleResize);
            this.resizeObserver.observe(this.wrap);
        } else {
            window.addEventListener('resize', this.handleResize, { passive: true });
            this.panResizeHandlerInstalled = true;
        }
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
        this.stage?.classList.remove('panning');
    }

    applyVideoPan() {
        this.card.style.setProperty('--intercom-video-pan-x', `${this.videoPanX}%`);
        this.updatePanAvailability();
    }

    panOverflow() {
        if (!this.config?.mobile_pan || !this.card.hasVideoSource()) return 0;
        if (!window.matchMedia?.('(max-width: 680px), (pointer: coarse)')?.matches) return 0;
        return this.videoHorizontalOverflow();
    }

    videoHorizontalOverflow() {
        if (!this.video?.videoWidth || !this.video.videoHeight || !this.wrap) return 0;
        if (getComputedStyle(this.video).objectFit !== 'cover') return 0;

        const { clientWidth: width, clientHeight: height } = this.wrap;
        if (!width || !height) return 0;

        const scale = Math.max(width / this.video.videoWidth, height / this.video.videoHeight);
        return Math.max(0, this.video.videoWidth * scale - width);
    }

    updatePanAvailability() {
        this.stage?.classList.toggle('pannable', this.panOverflow() > 1);
    }

    onPanPointerDown(ev) {
        if (!ev.isPrimary || ev.button !== 0) return;
        const overflow = this.panOverflow();
        if (overflow <= 1) return;
        this.panGesture = {
            pointerId: ev.pointerId,
            startX: ev.clientX,
            startY: ev.clientY,
            startPanX: this.videoPanX,
            active: false,
            overflow,
        };

        try {
            this.wrap.setPointerCapture(ev.pointerId);
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
            this.stage?.classList.add('panning');
        }

        ev.preventDefault();
        ev.stopPropagation();

        const overflow = gesture.overflow;
        if (!overflow) return;

        this.videoPanX = clampPan(gesture.startPanX - (dx / overflow) * 100);
        this.card.style.setProperty('--intercom-video-pan-x', `${this.videoPanX}%`);
    }

    onPanPointerEnd(ev) {
        const gesture = this.panGesture;
        if (!gesture || ev.pointerId !== gesture.pointerId) return;

        if (gesture.active) {
            ev.preventDefault?.();
            ev.stopPropagation?.();
            this.saveVideoPanX();
        }

        this.stage?.classList.remove('panning');
        this.panGesture = null;
        if (this.wrap.hasPointerCapture?.(ev.pointerId))
            this.wrap.releasePointerCapture(ev.pointerId);
    }

    panPreferenceKey() {
        const source = this.card.useAlternateStream()
            ? this.config?.alternate_stream
            : this.config?.stream || this.config?.url || this.config?.entity || '';
        return source ? `${PAN_STORAGE_PREFIX}${encodeURIComponent(source)}` : '';
    }

    loadVideoPanX() {
        const value = readPreference(this.panPreferenceKey());
        const stored = value?.trim() ? Number(value) : NaN;
        return Number.isFinite(stored) ? clampPan(stored) : DEFAULT_VIDEO_PAN_X;
    }

    saveVideoPanX() {
        writePreference(this.panPreferenceKey(), String(Math.round(this.videoPanX)));
    }
}

function clampPan(value) {
    return Math.min(100, Math.max(0, value));
}
