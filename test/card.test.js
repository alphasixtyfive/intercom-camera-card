import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { normalizeConfig, getConfigForm } from '../src/config.js';

const window = new Window({ url: 'http://localhost/' });
for (const key of [
    'document',
    'HTMLElement',
    'customElements',
    'navigator',
    'localStorage',
    'WebSocket',
    'CustomEvent',
    'ResizeObserver',
    'IntersectionObserver',
]) {
    Object.defineProperty(globalThis, key, { configurable: true, value: window[key] });
}
globalThis.window = window;
const bundle = await build({
    entryPoints: ['src/card.js'],
    bundle: true,
    write: false,
    format: 'esm',
    plugins: [
        {
            name: 'test-player',
            setup(builder) {
                builder.onResolve({ filter: /^\/webrtc\// }, () => ({
                    path:
                        process.env.INTERCOM_VIDEO_RTC_PATH ||
                        new URL('./fixtures/video-rtc.js', import.meta.url).pathname.replace(
                            /^\/([A-Z]:)/,
                            '$1',
                        ),
                }));
            },
        },
    ],
});
await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const states = {
    'light.porch': { state: 'off' },
    'cover.gate': { state: 'closed' },
    'media_player.door': { state: 'idle' },
};
const hass = {
    states,
    hassUrl: (path) => `https://ha.example${path}`,
    callWS: () => new Promise(() => {}),
};
const config = {
    stream: 'door',
    alternate_stream: 'door_sub',
    player: 'media_player.door',
    buttons: ['light.porch', 'cover.gate', { tts: 'Please wait', title: 'Wait' }],
};
function card(settings = config) {
    const element = document.createElement('intercom-camera-card');
    element.setConfig(settings);
    element.hass = hass;
    document.body.append(element);
    return element;
}
afterEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
});

test('configuration errors are reported at the boundary without mutating YAML', () => {
    assert.throws(() => normalizeConfig({}), /Set a camera/);
    assert.throws(() => normalizeConfig({ stream: 4 }), /stream must/);
    assert.throws(() => normalizeConfig({ stream: 'door', buttons: [null] }), /buttons\[0\]/);
    assert.throws(
        () => normalizeConfig({ stream: 'door', buttons: [{ states: { on: null } }] }),
        /states/,
    );
    assert.throws(() => normalizeConfig({ entity: 'light.porch' }), /camera entity/);
    const source = { url: 'rtsp://example', pan: false, buttons: [{ entity: 'light.porch' }] };
    const result = normalizeConfig(source);
    result.buttons[0].title = 'Changed';
    assert.equal(source.buttons[0].title, undefined);
    assert.equal(result.mobile_pan, false);
});

test('native editor protects advanced settings and supplies a valid stub', () => {
    assert.throws(() => getConfigForm().assertConfig({ talk: { title: 'Answer' } }), /YAML/);
    const Card = customElements.get('intercom-camera-card');
    assert.doesNotThrow(() =>
        normalizeConfig(Card.getStubConfig({ states: { 'camera.door': {} } })),
    );
    assert.equal(Card.getConfigForm().schema[0].selector.entity.domain, 'camera');
});

test('new pan preferences are centered; zero and alternate preferences survive', () => {
    const element = card();
    assert.equal(element.pan.videoPanX, 50);
    element.pan.videoPanX = 0;
    element.pan.saveVideoPanX();
    assert.equal(element.pan.loadVideoPanX(), 0);
    element.streamVariant = 'alternate';
    assert.equal(element.pan.loadVideoPanX(), 50);
});

test('pointer moves do not read layout', () => {
    const element = card();
    element.pan.panGesture = {
        pointerId: 1,
        startX: 0,
        startY: 0,
        startPanX: 50,
        overflow: 200,
        active: true,
    };
    element.pan.videoHorizontalOverflow = () => {
        throw new Error('Unexpected layout read');
    };
    element.pan.onPanPointerMove({
        pointerId: 1,
        clientX: 50,
        clientY: 0,
        preventDefault() {},
        stopPropagation() {},
    });
    assert.equal(element.pan.videoPanX, 25);
});

test('unrelated HA updates cause no button writes; relevant changes update once', () => {
    const element = card();
    let renders = 0;
    const apply = element.buttons.applyStateToButton.bind(element.buttons);
    element.buttons.applyStateToButton = (...args) => {
        renders++;
        apply(...args);
    };
    for (let index = 0; index < 1000; index++)
        element.hass = { ...hass, states: { ...states, 'sensor.clock': { state: String(index) } } };
    assert.equal(renders, 0);
    element.hass = { ...hass, states: { ...states, 'light.porch': { state: 'on' } } };
    assert.equal(renders, 1);
    assert.equal(element.$('[data-button-id="left-0"]').title, 'Porch on');
});

test('state overrides preserve cover actions and transit lockout', () => {
    const element = card({
        ...config,
        buttons: [{ entity: 'cover.gate', states: { closed: { title: 'Open driveway' } } }],
    });
    const button = element.buttons.leftButtons[0];
    assert.equal(button.states.closed.tap_action.perform_action, 'cover.open_cover');
    assert.equal(button.states.opening.disabled, true);
});

test('native action events preserve confirmation and targets', () => {
    const action = {
        action: 'perform-action',
        perform_action: 'lock.unlock',
        target: { entity_id: 'lock.door' },
        confirmation: { text: 'Unlock?' },
    };
    const element = card({ stream: 'door', buttons: [{ title: 'Unlock', tap_action: action }] });
    let detail;
    element.addEventListener('hass-action', (event) => {
        detail = event.detail;
    });
    element.$('[data-button-id]').click();
    assert.deepEqual(detail.config.tap_action, action);
    assert.equal(detail.action, 'tap');
    assert.equal(element.buttons.cooldowns.size, 1);
    element.remove();
    assert.equal(element.buttons.cooldowns.size, 0);
});

test('keyboard activation enables audio and buttons keep clear action labels', () => {
    const element = card();
    let audioEnables = 0;
    element.enableAudio = () => audioEnables++;
    const talk = element.$('.talk');
    element.video.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    assert.equal(audioEnables, 1);
    talk.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(audioEnables, 1);
    assert.equal(element.video.tabIndex, 0);
    assert.equal(talk.getAttribute('aria-label'), 'Talk');
    assert.equal(talk.hasAttribute('aria-pressed'), false);
    assert.equal(element.$('.stream-toggle').hasAttribute('aria-pressed'), false);
});

test('talk disables audio and unavailable entities stay disabled', () => {
    const element = card();
    element.setTalking(true);
    assert.equal(element.$('[data-button-id="left-2"]').disabled, true);
    element.hass = { ...hass, states: { ...states, 'light.porch': { state: 'unavailable' } } };
    assert.equal(element.$('[data-button-id="left-0"]').disabled, true);
});

test('presentation edits keep the connection; source edits replace it', () => {
    const element = card();
    const generation = element.connectionGeneration;
    element.setConfig({ ...config, primary_label: 'HD' });
    assert.equal(element.connectionGeneration, generation);
    element.setConfig({ ...config, stream: 'other' });
    assert.ok(element.connectionGeneration > generation);
});

test('signed connection requests coalesce and stale replies cannot connect', async () => {
    let resolve,
        requests = 0;
    const element = document.createElement('intercom-camera-card');
    element.setConfig(config);
    element.hass = {
        ...hass,
        callWS: () => {
            requests++;
            return new Promise((done) => {
                resolve = done;
            });
        },
    };
    assert.equal(requests, 1, 'path signing starts before the card mounts');
    document.body.append(element);
    element.onconnect();
    element.onconnect();
    assert.equal(requests, 1);
    element.remove();
    resolve({ path: '/api/webrtc/ws?authSig=test' });
    await Promise.resolve();
    assert.equal(element.ws, null);
    assert.equal(element.signing, false);
    assert.equal(element.signedPath, '');
});

test('rapid stream changes reuse a valid signed path', async () => {
    const element = document.createElement('intercom-camera-card');
    element.setConfig(config);
    let requests = 0;
    element.hass = {
        ...hass,
        callWS: async () => {
            requests++;
            return { path: `/api/webrtc/ws?authSig=${requests}` };
        },
    };

    const first = await element.getSignedPath();
    assert.equal(await element.getSignedPath(), first);
    assert.equal(requests, 1);

    element.signedPathExpiresAt = Date.now() - 1;
    assert.notEqual(await element.getSignedPath(), first);
    assert.equal(requests, 2);
});

test('loading stays centered until the visible video plays', () => {
    const element = card();
    const incoming = document.createElement('video');
    incoming.srcObject = new window.MediaStream();
    element.pc = { getSenders: () => [], getReceivers: () => [], close() {} };
    const timeout = element.connectionTimeout;
    assert.ok(timeout);
    assert.equal(element.$('.status').classList.contains('centered'), true);

    element.onpcvideo(incoming);
    assert.equal(element.connectionTimeout, timeout);
    assert.equal(element.$('.status').textContent, 'Connecting video');

    element.video.dispatchEvent(new window.Event('playing'));
    assert.equal(element.connectionTimeout, 0);
    assert.equal(element.$('.status').textContent, '');
    assert.equal(element.$('.status').classList.contains('centered'), false);
});

test('signaling URL preserves HA signing and encodes sources safely', () => {
    const element = card({
        entity: 'camera.door',
        alternate_stream: 'door sub',
        server: 'http://go2rtc:1984',
    });
    let url = new URL(element.buildWebSocketUrl('/api/webrtc/ws?authSig=abc'));
    assert.equal(url.protocol, 'wss:');
    assert.equal(url.searchParams.get('authSig'), 'abc');
    assert.equal(url.searchParams.get('entity'), 'camera.door');
    element.streamVariant = 'alternate';
    url = new URL(element.buildWebSocketUrl('/api/webrtc/ws?authSig=abc'));
    assert.equal(url.searchParams.get('url'), 'door sub');
    assert.equal(url.searchParams.has('entity'), false);
});

test('a signing error ends Talk before retrying', async (t) => {
    t.mock.method(console, 'warn', () => {});
    let reject;
    const element = document.createElement('intercom-camera-card');
    element.setConfig(config);
    element.hass = {
        ...hass,
        callWS: () => new Promise((_, fail) => (reject = fail)),
    };
    document.body.append(element);
    element.setTalking(true);
    reject(new Error('Signing unavailable'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(element.talking, false);
    assert.equal(element.$('.status').textContent, 'Connection error');
    assert.ok(element.reconnectTID);
});

test('visibility stops streaming and invalidates pending work', () => {
    const element = card();
    element.elementInView = false;
    element.syncVisibility();
    assert.equal(element.shouldStream(), false);
    assert.equal(element.signing, false);
});

test('late microphone permission stops its tracks after navigation', async () => {
    let resolve,
        stopped = 0;
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
            getUserMedia: () =>
                new Promise((done) => {
                    resolve = done;
                }),
        },
    });
    const element = card();
    element.setTalking(true);
    const pc = { getSenders: () => [], getReceivers: () => [], close() {} };
    element.pc = pc;
    const offer = element.createOffer(pc);
    element.remove();
    const track = {
        stop() {
            stopped++;
        },
    };
    resolve({ getTracks: () => [track], getAudioTracks: () => [track] });
    assert.equal(await offer, null);
    assert.equal(stopped, 1);
    assert.deepEqual(element.localMicrophoneTracks, []);
});

test('disconnect releases sender, receiver and microphone tracks', () => {
    const element = card();
    let stopped = 0,
        closed = 0;
    const track = () => ({
        stop() {
            stopped++;
        },
    });
    element.pc = {
        getSenders: () => [{ track: track() }],
        getReceivers: () => [{ track: track() }],
        close() {
            closed++;
        },
    };
    element.localMicrophoneTracks = [track()];
    element.remove();
    assert.equal(stopped, 3);
    assert.equal(closed, 1);
    assert.equal(element.pc, null);
});

test('labels are text rather than executable markup', () => {
    const element = card({
        stream: 'door',
        buttons: [{ title: '<img src=x onerror=alert(1)>', tap_action: { action: 'none' } }],
    });
    assert.equal(element.shadowRoot.querySelector('img'), null);
    assert.equal(element.$('[data-button-id]').title, '<img src=x onerror=alert(1)>');
});

test('offer failures close the peer and schedule a controlled retry', async (t) => {
    const warning = t.mock.method(console, 'warn', () => {});
    const Original = globalThis.RTCPeerConnection;
    class FailedPeer extends EventTarget {
        addTransceiver() {}
        createOffer() {
            return Promise.reject(new Error('Simulated negotiation failure'));
        }
        getSenders() {
            return [];
        }
        getReceivers() {
            return [];
        }
        close() {
            this.closed = true;
        }
    }
    globalThis.RTCPeerConnection = FailedPeer;
    try {
        const element = card();
        element.onmessage = {};
        element.onwebrtc();
        const peer = element.pc;
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(peer.closed, true);
        assert.equal(element.pc, null);
        assert.ok(element.reconnectTID);
        assert.equal(warning.mock.callCount(), 1);
    } finally {
        globalThis.RTCPeerConnection = Original;
    }
});

test('a late SDP offer cannot touch a replaced connection', async () => {
    const element = card();
    let resolve,
        descriptions = 0;
    const peer = {
        addTransceiver() {},
        getSenders: () => [],
        getReceivers: () => [],
        close() {},
        createOffer: () =>
            new Promise((done) => {
                resolve = done;
            }),
        setLocalDescription() {
            descriptions++;
        },
    };
    element.pc = peer;
    const offer = element.createOffer(peer);
    element.disconnectImmediately();
    resolve({ sdp: 'stale' });
    assert.equal(await offer, null);
    assert.equal(descriptions, 0);
});

test('socket events from a retired connection cannot close the new one', () => {
    const Original = globalThis.WebSocket;
    class Socket extends EventTarget {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSED = 3;
        close() {}
    }
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: Socket });
    try {
        const element = card();
        element.openSocket(element.connectionGeneration);
        const retired = element.ws;
        element.disconnectImmediately();
        element.openSocket(element.connectionGeneration);
        const current = element.ws;
        retired.dispatchEvent(new Event('close'));
        assert.equal(element.ws, current);
    } finally {
        Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: Original });
    }
});

test('poster encoding is bounded and discarded after navigation', (t) => {
    const element = card();
    Object.defineProperty(element.video, 'videoWidth', { value: 3840 });
    Object.defineProperty(element.video, 'videoHeight', { value: 2160 });
    let encoded,
        allocations = 0;
    const canvas = {
        getContext: () => ({ drawImage() {} }),
        toBlob(callback) {
            encoded = callback;
        },
    };
    const create = document.createElement.bind(document);
    t.mock.method(document, 'createElement', (tag) => (tag === 'canvas' ? canvas : create(tag)));
    t.mock.method(URL, 'createObjectURL', () => {
        allocations++;
        return 'blob:poster';
    });
    element.capturePoster();
    assert.equal(canvas.width, 1280);
    assert.equal(canvas.height, 720);
    element.remove();
    encoded(new Blob(['poster']));
    assert.equal(allocations, 0);
});

test('a recent frame appears blurred while reopening the same camera', (t) => {
    const element = card({ stream: 'cached-door-test' });
    Object.defineProperty(element.video, 'videoWidth', { value: 1920 });
    Object.defineProperty(element.video, 'videoHeight', { value: 1080 });
    element.hasPlayedFrame = true;
    let encoded;
    const canvas = {
        getContext: () => ({ drawImage() {} }),
        toBlob(callback) {
            encoded = callback;
        },
    };
    const create = document.createElement.bind(document);
    t.mock.method(document, 'createElement', (tag) => (tag === 'canvas' ? canvas : create(tag)));
    t.mock.method(URL, 'createObjectURL', () => 'blob:cached-door-test');
    let revoked = 0;
    t.mock.method(URL, 'revokeObjectURL', () => revoked++);
    element.remove();
    assert.equal(canvas.width, 640);
    assert.equal(canvas.height, 360);
    encoded(new Blob(['frame']));

    const reopened = card({ stream: 'cached-door-test' });
    assert.equal(reopened.video.poster, 'blob:cached-door-test');
    assert.equal(reopened.video.classList.contains('loading'), true);
    reopened.disconnectImmediately();
    assert.equal(revoked, 1);
});

test('a brief peer disconnect keeps the current connection', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const Original = globalThis.RTCPeerConnection;
    class Peer extends EventTarget {
        connectionState = 'connected';
        addTransceiver() {}
        createOffer() {
            return new Promise(() => {});
        }
        getSenders() {
            return [];
        }
        getReceivers() {
            return [];
        }
        close() {}
    }
    globalThis.RTCPeerConnection = Peer;
    try {
        const element = card();
        element.onmessage = {};
        element.onwebrtc();
        const peer = element.pc;
        element.pcState = WebSocket.OPEN;
        peer.connectionState = 'disconnected';
        peer.dispatchEvent(new Event('connectionstatechange'));
        assert.ok(element.peerDisconnectTimeout);
        peer.connectionState = 'connected';
        peer.dispatchEvent(new Event('connectionstatechange'));
        t.mock.timers.tick(1600);
        assert.equal(element.pc, peer);
        assert.equal(element.peerDisconnectTimeout, 0);
    } finally {
        globalThis.RTCPeerConnection = Original;
    }
});

test('automatic retries start quickly and back off', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const element = card();
    element.disconnectImmediately();
    let attempts = 0;
    element.onconnect = () => attempts++;
    element.scheduleReconnect();
    t.mock.timers.tick(999);
    assert.equal(attempts, 0);
    t.mock.timers.tick(1);
    assert.equal(attempts, 1);
    element.scheduleReconnect();
    t.mock.timers.tick(1999);
    assert.equal(attempts, 1);
    t.mock.timers.tick(1);
    assert.equal(attempts, 2);
});

test('disabling talk through configuration releases the active microphone', () => {
    const element = card();
    let stopped = 0;
    element.setTalking(true);
    element.localMicrophoneTracks = [
        {
            stop() {
                stopped++;
            },
        },
    ];
    element.setConfig({ ...config, talk: false });
    assert.equal(stopped, 1);
    assert.equal(element.talking, false);
    assert.equal(element.$('.talk').hidden, true);
});

test('observer uses the visibility ratio, not just intersection', () => {
    const Original = globalThis.IntersectionObserver;
    let report;
    class Observer {
        constructor(callback) {
            report = callback;
        }
        observe() {}
        disconnect() {}
    }
    Object.defineProperty(globalThis, 'IntersectionObserver', {
        configurable: true,
        value: Observer,
    });
    try {
        const element = card();
        report([{ isIntersecting: true, intersectionRatio: 0.74 }]);
        assert.equal(element.shouldStream(), false);
        report([{ isIntersecting: true, intersectionRatio: 0.75 }]);
        assert.equal(element.shouldStream(), true);
    } finally {
        Object.defineProperty(globalThis, 'IntersectionObserver', {
            configurable: true,
            value: Original,
        });
    }
});

test('hang-up remains available while microphone permission is pending', async () => {
    const element = card();
    element.setTalking(true);
    element.setTalkBusy(true);
    assert.equal(element.$('.talk').disabled, false);
    await element.toggleTalk();
    assert.equal(element.talking, false);
    assert.equal(element.media, 'video,audio');
    element.remove();
    assert.equal(element.connectionTimeout, 0);
});

test('state-specific audio follows its own speaker availability and talk lockout', () => {
    const element = card({
        stream: 'door',
        buttons: [
            {
                entity: 'light.porch',
                states: {
                    off: {
                        tap_action: {
                            perform_action: 'tts.speak',
                            target: { entity_id: 'tts.example' },
                            data: {
                                media_player_entity_id: 'media_player.other',
                                message: 'Please wait',
                            },
                        },
                    },
                },
            },
        ],
    });
    const button = element.$('[data-button-id]');
    assert.equal(button.disabled, true);
    element.hass = { ...hass, states: { ...states, 'media_player.other': { state: 'idle' } } };
    assert.equal(button.disabled, false);
    assert.equal(element.buttons.leftButtons[0].states.off.tap_action.action, 'perform-action');
    assert.deepEqual(element.buttons.audioPlayers(), ['media_player.other']);
    element.setTalking(true);
    assert.equal(button.disabled, true);
});

test('invalid state presentation fails early and base hidden/disabled flags apply', () => {
    assert.throws(
        () =>
            normalizeConfig({
                stream: 'door',
                buttons: [{ states: { on: { disabled: 'false' } } }],
            }),
        /states.on.disabled/,
    );
    assert.throws(
        () =>
            normalizeConfig({ stream: 'door', buttons: [{ states: { on: { tap_action: [] } } }] }),
        /states.on.tap_action/,
    );
    const element = card({
        stream: 'door',
        buttons: [{ entity: 'light.porch', hidden: true, disabled: true }],
    });
    assert.equal(element.$('[data-button-id]').hidden, true);
    assert.equal(element.$('[data-button-id]').disabled, true);
});

test('retired controls cannot dispatch actions after configuration changes', () => {
    const element = card();
    const oldButton = element.$('[data-button-id]');
    let actions = 0;
    element.addEventListener('hass-action', () => actions++);
    element.setConfig({ ...config, buttons: [] });
    oldButton.click();
    assert.equal(actions, 0);
    assert.equal(element.buttons.elements.size, 0);
});

test('unrelated updates do not search the DOM', (t) => {
    const element = card();
    const query = t.mock.method(element.shadowRoot, 'querySelectorAll', () => {
        throw new Error('Unexpected DOM search');
    });
    element.hass = { ...hass, states: { ...states, 'sensor.other': { state: '1' } } };
    assert.equal(query.mock.callCount(), 0);
});

test('ICE waits for the remote description before applying candidates', async () => {
    const Original = globalThis.RTCPeerConnection;
    let finishDescription;
    const received = [];
    class Peer extends EventTarget {
        addTransceiver() {}
        createOffer() {
            return Promise.resolve({ sdp: 'offer' });
        }
        setLocalDescription() {
            return Promise.resolve();
        }
        setRemoteDescription() {
            return new Promise((resolve) => {
                finishDescription = resolve;
            });
        }
        addIceCandidate(candidate) {
            received.push(candidate.candidate);
            return Promise.resolve();
        }
        getSenders() {
            return [];
        }
        getReceivers() {
            return [];
        }
        close() {}
    }
    globalThis.RTCPeerConnection = Peer;
    try {
        const element = card();
        element.onmessage = {};
        element.onwebrtc();
        element.onmessage.webrtc({ type: 'webrtc/candidate', value: 'first' });
        element.onmessage.webrtc({ type: 'webrtc/answer', value: 'answer' });
        element.onmessage.webrtc({ type: 'webrtc/candidate', value: 'second' });
        assert.deepEqual(received, []);
        finishDescription();
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(received, ['first', 'second']);
        element.onmessage.webrtc({ type: 'webrtc/candidate', value: 'third' });
        assert.deepEqual(received, ['first', 'second', 'third']);
    } finally {
        globalThis.RTCPeerConnection = Original;
    }
});

test('signaling ignores a socket that is already closing', () => {
    const element = card();
    element.ws = {
        readyState: WebSocket.CLOSING,
        send() {
            throw new Error('Closed socket');
        },
        close() {},
    };
    assert.doesNotThrow(() => element.send({ type: 'webrtc/candidate', value: '' }));
});

test('blocked preference storage falls back without breaking configuration', (t) => {
    t.mock.method(localStorage, 'getItem', () => {
        throw new Error('Storage blocked');
    });
    t.mock.method(console, 'debug', () => {});
    const element = card();
    assert.equal(element.streamVariant, 'primary');
    assert.equal(element.pan.videoPanX, 50);
});

test('state dictionaries do not treat prototype names as overrides', () => {
    const element = card({ stream: 'door', buttons: [{ entity: 'sensor.mode' }] });
    element.hass = { ...hass, states: { 'sensor.mode': { state: 'constructor' } } };
    assert.deepEqual(
        element.buttons.stateConfigForButton(element.buttons.leftButtons[0], 'constructor'),
        {},
    );
});

test('connection timeout stops talk and releases tracks before retrying', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(console, 'warn', () => {});
    const element = card();
    let stopped = 0;
    element.setTalking(true);
    element.localMicrophoneTracks = [
        {
            stop() {
                stopped++;
            },
        },
    ];
    t.mock.timers.tick(30000);
    assert.equal(element.talking, false);
    assert.equal(stopped, 1);
    assert.equal(element.connectionTimeout, 0);
    assert.ok(element.reconnectTID);
    element.remove();
});

test('Talk starts while media_player.media_stop is still pending', () => {
    const element = card();
    element.stopAudioPlayers = () => new Promise(() => {});
    const generation = element.connectionGeneration;
    element.toggleTalk();
    assert.equal(element.talking, true);
    assert.ok(element.connectionGeneration > generation);
    assert.equal(element.media, 'video,audio,microphone');
});
