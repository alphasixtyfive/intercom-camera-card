import { PAN_STORAGE_PREFIX, DEFAULT_VIDEO_PAN_X } from './defaults.js';

export class VideoPan {
    constructor(card) {
        this.card = card;
        this.videoPanX = DEFAULT_VIDEO_PAN_X;
        this.mobilePanEnabled = true;
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
        this.mobilePanEnabled = this.config.mobile_pan;
        this.videoPanX = this.loadVideoPanX();
    }

    bindPanControls() {
        const wrap = this.card.$('.video-wrap');
        wrap.addEventListener('pointerdown', this.handlePanPointerDown, { passive: false });
        wrap.addEventListener('pointermove', this.handlePanPointerMove, { passive: false });
        wrap.addEventListener('pointerup', this.handlePanPointerEnd, { passive: false });
        wrap.addEventListener('pointercancel', this.handlePanPointerEnd, { passive: false });
        wrap.addEventListener('lostpointercapture', this.handlePanPointerEnd, { passive: false });

        this.installPanResizeObserver();
    }

    installPanResizeObserver() {
        if (!this.card.shadowRoot || this.resizeObserver || this.panResizeHandlerInstalled) return;

        const wrap = this.card.$('.video-wrap');
        if (!wrap) return;

        if ('ResizeObserver' in window) {
            this.resizeObserver = new ResizeObserver(this.handleResize);
            this.resizeObserver.observe(wrap);
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
        this.card.$?.('.stage')?.classList.remove('panning');
    }

    applyVideoPan() {
        this.card.style.setProperty('--intercom-video-pan-x', `${this.videoPanX}%`);
        this.updatePanAvailability();
    }

    canPanVideo() {
        return (
            this.mobilePanEnabled &&
            this.card.hasVideoSource() &&
            this.isMobilePanContext() &&
            this.videoHorizontalOverflow() > 1
        );
    }

    isMobilePanContext() {
        return window.matchMedia?.('(max-width: 680px), (pointer: coarse)')?.matches ?? false;
    }

    videoHorizontalOverflow() {
        if (!this.video?.videoWidth || !this.video?.videoHeight || !this.card.shadowRoot) return 0;
        if (getComputedStyle(this.video).objectFit !== 'cover') return 0;

        const wrap = this.card.$('.video-wrap');
        const width = wrap?.clientWidth || 0;
        const height = wrap?.clientHeight || 0;
        if (!width || !height) return 0;

        const scale = Math.max(width / this.video.videoWidth, height / this.video.videoHeight);
        return Math.max(0, this.video.videoWidth * scale - width);
    }

    updatePanAvailability() {
        if (!this.card.shadowRoot) return;
        this.card.$('.stage')?.classList.toggle('pannable', this.canPanVideo());
    }

    onPanPointerDown(ev) {
        if (!ev.isPrimary || ev.button !== 0 || !this.canPanVideo()) return;

        const wrap = this.card.$('.video-wrap');
        this.panGesture = {
            pointerId: ev.pointerId,
            startX: ev.clientX,
            startY: ev.clientY,
            startPanX: this.videoPanX,
            active: false,
            overflow: this.videoHorizontalOverflow(),
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
            this.card.$('.stage')?.classList.add('panning');
        }

        ev.preventDefault();
        ev.stopPropagation();

        const overflow = gesture.overflow;
        if (!overflow) return;

        this.videoPanX = this.clamp(gesture.startPanX - (dx / overflow) * 100, 0, 100);
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

        this.card.$('.stage')?.classList.remove('panning');
        this.panGesture = null;
        const wrap = this.card.$('.video-wrap');
        if (wrap.hasPointerCapture?.(ev.pointerId)) wrap.releasePointerCapture(ev.pointerId);
    }

    panPreferenceKey() {
        const source = this.card.useAlternateStream()
            ? this.config?.alternate_stream
            : this.config?.stream || this.config?.url || this.config?.entity || '';
        return source ? `${PAN_STORAGE_PREFIX}${encodeURIComponent(source)}` : '';
    }

    loadVideoPanX() {
        const key = this.panPreferenceKey();
        if (!key) return DEFAULT_VIDEO_PAN_X;

        try {
            const value = localStorage.getItem(key);
            if (value === null || value.trim() === '') return DEFAULT_VIDEO_PAN_X;
            const stored = Number(value);
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
}
