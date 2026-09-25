import { VideoRTC } from '/webrtc/video-rtc.js';
import {
    CAMERA_MEDIA,
    TALK_MEDIA,
    STREAM_MODE,
    CONNECTION_TIMEOUT_MS,
    STREAM_STORAGE_PREFIX,
    DEFAULT_PRIMARY_STREAM_LABEL,
    DEFAULT_ALTERNATE_STREAM_LABEL,
} from './defaults.js';

export class IntercomStream extends VideoRTC {
    constructor() {
        super();
        this.mode = STREAM_MODE;
        this.background = false;
        this.visibilityThreshold = 0.75;
        this.connectionGeneration = 0;
        this.connectionTimeout = 0;
        this.signing = false;
        this.signedPath = '';
        this.signedPathExpiresAt = 0;
        this.signedPathPromise = null;
        this.talking = false;
        this.streamVariant = 'primary';
        this.localMicrophoneTracks = [];
        this.keepFrameOnDisconnect = false;
        this.posterGeneration = 0;
        this.posterURL = null;
        this.pendingVideo = null;
        this.playbackGeneration = -1;
        this.playbackMicrophoneRequested = false;
        this.pendingConnectStatus = undefined;
        this.elementInView = true;
        this.visibilityHandlersInstalled = false;
        this.visibilityObserver = null;
        this.handlePageHide = () => this.disconnectImmediately();
        this.handleVisibilityChange = () => this.syncVisibility();
        this.handlePageShow = () => this.syncVisibility();
    }

    disconnectImmediately() {
        if (this.background) return;
        this.clearReconnectTimers();
        this.ondisconnect();
    }

    installVisibilityHandlers() {
        if (this.background || this.visibilityHandlersInstalled) return;

        this.visibilityHandlersInstalled = true;
        window.addEventListener('pagehide', this.handlePageHide, { passive: true });
        window.addEventListener('pageshow', this.handlePageShow, { passive: true });

        if ('hidden' in document && this.visibilityCheck) {
            document.addEventListener('visibilitychange', this.handleVisibilityChange);
        }

        if ('IntersectionObserver' in window && this.visibilityThreshold) {
            this.visibilityObserver = new IntersectionObserver(
                (entries) => {
                    entries.forEach((entry) => {
                        this.elementInView =
                            entry.isIntersecting &&
                            entry.intersectionRatio >= this.visibilityThreshold;
                        this.syncVisibility();
                    });
                },
                { threshold: this.visibilityThreshold },
            );
            this.visibilityObserver.observe(this);
        }
    }

    removeVisibilityHandlers() {
        if (!this.visibilityHandlersInstalled) return;

        window.removeEventListener('pagehide', this.handlePageHide);
        window.removeEventListener('pageshow', this.handlePageShow);
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        this.visibilityObserver?.disconnect();
        this.visibilityObserver = null;
        this.visibilityHandlersInstalled = false;
    }

    syncVisibility() {
        if (!this.shouldStream()) {
            this.disconnectImmediately();
            return;
        }

        this.onconnect();
    }

    shouldStream() {
        return (
            this.hasVideoSource() &&
            this.isConnected &&
            document.hidden !== true &&
            this.elementInView !== false
        );
    }

    mediaForTalkState() {
        return this.talking ? TALK_MEDIA : CAMERA_MEDIA;
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

    onconnect() {
        if (!this.config || !this.hass) return false;
        if (!this.hasVideoSource()) {
            this.showStatus('Camera source unavailable');
            return false;
        }
        if (!this.shouldStream() || this.ws || this.pc || this.signing) return false;

        const generation = ++this.connectionGeneration;
        this.signing = true;
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = setTimeout(() => {
            this.connectionFailed(new Error('Camera connection timed out'), generation);
        }, CONNECTION_TIMEOUT_MS);
        const status =
            this.pendingConnectStatus ??
            (this.talking ? this.talkButton.starting_status : 'Connecting video');
        this.pendingConnectStatus = undefined;
        if (status) this.showStatus(status, 0, 'center');

        this.getSignedPath()
            .then((path) => {
                if (!this.canStartConnection(generation)) return;
                this.signing = false;

                this.wsURL = this.buildWebSocketUrl(path);
                if (!this.wsURL) {
                    this.showStatus('Camera source unavailable');
                    this.setTalkBusy(false);
                    return;
                }

                this.openSocket(generation);
            })
            .catch((err) => {
                if (generation !== this.connectionGeneration) return;
                this.signing = false;
                console.warn(err);
                this.showStatus('Connection error', 1800);
                this.setTalkBusy(false);
                this.scheduleReconnect();
            });

        return true;
    }

    getSignedPath() {
        if (this.signedPath && Date.now() < this.signedPathExpiresAt) {
            return Promise.resolve(this.signedPath);
        }
        if (this.signedPathPromise) return this.signedPathPromise;

        const expiresAt = Date.now() + 20_000;
        const request = this.hass
            .callWS({ type: 'auth/sign_path', path: '/api/webrtc/ws' })
            .then(({ path }) => {
                if (this.signedPathPromise !== request) return path;
                // Home Assistant signs paths for 30 seconds by default. Reuse only
                // a short portion for rapid stream or talk transitions.
                this.signedPath = path;
                this.signedPathExpiresAt = expiresAt;
                return path;
            })
            .finally(() => {
                if (this.signedPathPromise === request) this.signedPathPromise = null;
            });
        this.signedPathPromise = request;
        return request;
    }

    canStartConnection(generation) {
        return (
            generation === this.connectionGeneration && this.shouldStream() && !this.ws && !this.pc
        );
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

    openSocket(generation) {
        const socket = new WebSocket(this.wsURL);
        this.ws = socket;
        this.wsState = WebSocket.CONNECTING;
        this.connectTS = Date.now();
        const current = () => generation === this.connectionGeneration && socket === this.ws;
        socket.addEventListener('open', () => {
            if (!current()) return;
            try {
                this.onopen();
            } catch (error) {
                this.connectionFailed(error, generation);
            }
        });
        socket.addEventListener('message', (event) => {
            if (!current() || typeof event.data !== 'string') return;
            try {
                const message = JSON.parse(event.data);
                for (const handler of Object.values(this.onmessage)) handler(message);
            } catch (error) {
                this.connectionFailed(error, generation);
            }
        });
        socket.addEventListener('close', () => {
            if (!current() || this.pcState === WebSocket.OPEN) return;
            this.ondisconnect();
            this.showStatus('Reconnecting video', 0, 'center');
            this.scheduleReconnect();
        });
    }

    send(message) {
        if (this.ws?.readyState !== WebSocket.OPEN) return;
        try {
            this.ws.send(JSON.stringify(message));
        } catch (error) {
            this.connectionFailed(error, this.connectionGeneration);
        }
    }

    onopen() {
        this.wsState = WebSocket.OPEN;
        this.onmessage = {};
        if (!('RTCPeerConnection' in window)) {
            this.ondisconnect();
            this.showStatus('WebRTC unsupported', 3200);
            this.setTalkBusy(false);
            return;
        }

        this.onmessage.intercom = (msg) => {
            switch (msg.type) {
                case 'error':
                    console.warn(msg.value);
                    this.ondisconnect();
                    this.showStatus(this.streamErrorStatus(msg.value), 3200);
                    this.setTalkBusy(false);
                    this.scheduleReconnect();
                    break;
            }
        };
        this.onwebrtc();
    }

    onpcvideo(video2, microphoneRequested = false) {
        super.onpcvideo(video2);
        if (this.pcState !== WebSocket.OPEN) return;
        this.playbackGeneration = this.connectionGeneration;
        this.playbackMicrophoneRequested = microphoneRequested;
        if (this.talking && microphoneRequested) {
            if (!this.hasLiveMicrophoneTrack()) {
                this.setTalking(false);
                this.showStatus('Microphone unavailable', 3200);
            }
        }
    }

    onVideoPlaying() {
        if (this.playbackGeneration !== this.connectionGeneration || !this.video.srcObject) return;
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = 0;
        this.clearPoster();
        if (this.talking && this.playbackMicrophoneRequested && this.hasLiveMicrophoneTrack()) {
            this.showStatus(this.talkButton.active_status);
        }
        if (!this.talking || this.playbackMicrophoneRequested) this.setTalkBusy(false);
    }

    async createOffer(pc) {
        const generation = this.connectionGeneration;
        try {
            if (this.media.indexOf('microphone') >= 0) {
                if (this.talking) {
                    this.showStatus(this.talkButton.requesting_status);
                }
                if (!navigator.mediaDevices?.getUserMedia) {
                    throw new Error('getUserMedia unavailable');
                }
                const media = await navigator.mediaDevices.getUserMedia({ audio: true });
                if (
                    generation !== this.connectionGeneration ||
                    pc !== this.pc ||
                    !this.talking ||
                    !this.shouldStream()
                ) {
                    this.stopStreamTracks(media);
                    return null;
                }
                const tracks = media.getAudioTracks();
                if (!tracks.length) {
                    this.stopStreamTracks(media);
                    throw new Error('No microphone track');
                }

                try {
                    tracks.forEach((track) => {
                        pc.addTransceiver(track, { direction: 'sendonly' });
                        this.localMicrophoneTracks.push(track);
                        track.addEventListener('ended', () => this.onMicrophoneEnded(track), {
                            once: true,
                        });
                    });
                } catch (err) {
                    this.stopTracks(tracks);
                    throw err;
                }
            }
        } catch (err) {
            if (generation !== this.connectionGeneration || pc !== this.pc) return null;
            this.onMicrophoneError(err);
        }

        for (const kind of ['video', 'audio']) {
            if (this.media.indexOf(kind) >= 0) {
                pc.addTransceiver(kind, { direction: 'recvonly' });
            }
        }

        const offer = await pc.createOffer();
        if (generation !== this.connectionGeneration || pc !== this.pc) return null;
        await pc.setLocalDescription(offer);
        if (generation !== this.connectionGeneration || pc !== this.pc) return null;
        return offer;
    }

    ondisconnect() {
        this.connectionGeneration++;
        this.signing = false;
        this.signedPathPromise = null;
        this.playbackGeneration = -1;
        this.playbackMicrophoneRequested = false;
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = 0;
        clearTimeout(this.statusTimeout);
        this.statusTimeout = 0;
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
            if (this.keepFrameOnDisconnect) this.capturePoster();
            this.stopTracks(this.pc.getSenders().map((sender) => sender.track));
            this.stopTracks(this.pc.getReceivers().map((receiver) => receiver.track));
            this.pc.close();
            this.pc = null;
        }
        this.stopTracks(this.localMicrophoneTracks);
        this.localMicrophoneTracks = [];
        this.stopStreamTracks(this.pendingVideo?.srcObject);
        if (this.pendingVideo) this.pendingVideo.srcObject = null;
        this.pendingVideo = null;
        this.stopStreamTracks(this.video?.srcObject);
        if (!this.video) return;

        this.video.removeAttribute('src');
        this.video.srcObject = null;
        if (fullDisconnect) this.clearPoster();
    }

    stopStreamTracks(stream) {
        if (stream?.getTracks) {
            this.stopTracks(stream.getTracks());
        }
    }

    stopTracks(tracks = []) {
        tracks.filter(Boolean).forEach((track) => {
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
            const generation = this.connectionGeneration;
            await this.stopAudioPlayers();
            if (generation !== this.connectionGeneration || !this.talking || !this.shouldStream())
                return;
        } else {
            this.setTalking(false);
        }

        this.reconnectKeepingFrame(
            this.talking ? this.talkButton.starting_status : this.talkButton.ending_status,
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
        this.buttons.updateStatefulButtons();
    }

    hasLiveMicrophoneTrack() {
        return this.liveMicrophoneTracks().length > 0;
    }

    liveMicrophoneTracks() {
        this.localMicrophoneTracks = this.localMicrophoneTracks.filter(
            (track) => track.readyState === 'live',
        );
        return this.localMicrophoneTracks;
    }

    onMicrophoneEnded(track) {
        this.localMicrophoneTracks = this.localMicrophoneTracks.filter((item) => item !== track);
        if (this.talking && !this.hasLiveMicrophoneTrack()) {
            this.setTalking(false);
            this.setTalkBusy(false);
            this.showStatus('Microphone disconnected', 3200);
        }
    }

    async stopAudioPlayers() {
        const players = this.buttons.audioPlayers();
        if (!players.length || !this.hass?.callService) return;

        try {
            await this.hass.callService('media_player', 'media_stop', {
                entity_id: players,
            });
        } catch (err) {
            console.warn(err);
        }
    }

    streamErrorStatus(value) {
        if (!value) return 'Stream error';
        return 'Unable to connect to the camera';
    }

    reconnectKeepingFrame(status, talkBusy = true) {
        if (talkBusy) {
            this.setTalkBusy(true, status);
        } else {
            this.showStatus(status, 0, 'center');
        }
        this.clearReconnectTimers();
        this.pendingConnectStatus = status;

        this.keepFrameOnDisconnect = true;
        this.ondisconnect();
        this.keepFrameOnDisconnect = false;

        this.onconnect();
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

    capturePoster() {
        if (!this.video || !this.video.videoWidth || !this.video.videoHeight) return;

        const generation = ++this.posterGeneration;
        try {
            const canvas = document.createElement('canvas');
            const scale = Math.min(1, 1280 / this.video.videoWidth, 720 / this.video.videoHeight);
            canvas.width = Math.max(1, Math.round(this.video.videoWidth * scale));
            canvas.height = Math.max(1, Math.round(this.video.videoHeight * scale));
            canvas.getContext('2d').drawImage(this.video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(
                (blob) => {
                    if (!blob || generation !== this.posterGeneration || !this.isConnected) return;
                    if (this.posterURL) URL.revokeObjectURL(this.posterURL);
                    this.posterURL = URL.createObjectURL(blob);
                    this.video.poster = this.posterURL;
                },
                'image/jpeg',
                0.82,
            );
        } catch (err) {
            console.debug(err);
        }
    }

    clearPoster() {
        this.posterGeneration++;
        if (this.posterURL) URL.revokeObjectURL(this.posterURL);
        this.posterURL = null;
        this.video?.removeAttribute('poster');
    }

    // VideoRTC's offer callbacks do not guard against an obsolete peer or catch
    // rejected offers. Keep signaling scoped to the connection that created it.
    onwebrtc() {
        const pc = new RTCPeerConnection(this.pcConfig);
        const generation = this.connectionGeneration;
        const microphoneRequested = this.media.includes('microphone');
        this.pc = pc;
        this.pcState = WebSocket.CONNECTING;
        const current = () => generation === this.connectionGeneration && pc === this.pc;
        let remoteReady = false;
        const pendingCandidates = [];
        pc.addEventListener('icecandidate', (event) => {
            if (current())
                this.send({
                    type: 'webrtc/candidate',
                    value: event.candidate?.toJSON().candidate ?? '',
                });
        });
        pc.addEventListener('connectionstatechange', () => {
            if (!current()) return;
            if (pc.connectionState === 'connected') {
                const tracks = pc
                    .getTransceivers()
                    .filter((item) => ['recvonly', 'sendrecv'].includes(item.currentDirection))
                    .map((item) => item.receiver.track);
                const preview = document.createElement('video');
                this.pendingVideo = preview;
                preview.addEventListener(
                    'loadeddata',
                    () => {
                        if (current()) this.onpcvideo(preview, microphoneRequested);
                        else this.stopStreamTracks(preview.srcObject);
                        preview.srcObject = null;
                        if (this.pendingVideo === preview) this.pendingVideo = null;
                    },
                    { once: true },
                );
                preview.srcObject = new MediaStream(tracks);
            } else if (['failed', 'disconnected'].includes(pc.connectionState)) {
                this.ondisconnect();
                this.showStatus('Reconnecting video', 0, 'center');
                this.scheduleReconnect(1000);
            }
        });
        this.onmessage.webrtc = (message) => {
            if (!current()) return;
            let operation;
            if (message.type === 'webrtc/candidate') {
                const candidate = { candidate: message.value, sdpMid: '0' };
                if (!remoteReady) pendingCandidates.push(candidate);
                else operation = pc.addIceCandidate(candidate);
            }
            if (message.type === 'webrtc/answer') {
                operation = pc
                    .setRemoteDescription({ type: 'answer', sdp: message.value })
                    .then(() => {
                        if (!current()) return;
                        remoteReady = true;
                        return Promise.all(
                            pendingCandidates
                                .splice(0)
                                .map((candidate) => pc.addIceCandidate(candidate)),
                        );
                    });
            }
            operation?.catch((error) => this.connectionFailed(error, generation));
        };
        this.createOffer(pc)
            .then((offer) => {
                if (offer && current()) this.send({ type: 'webrtc/offer', value: offer.sdp });
            })
            .catch((error) => this.connectionFailed(error, generation));
    }

    connectionFailed(error, generation) {
        if (generation !== this.connectionGeneration) return;
        console.warn('Intercom WebRTC connection failed', error);
        this.ondisconnect();
        this.showStatus('Connection error', 3200);
        this.scheduleReconnect();
    }
}
