export class VideoRTC extends HTMLElement {
    constructor() {
        super();
        this.wsState = WebSocket.CLOSED;
        this.pcState = WebSocket.CLOSED;
        this.ws = null;
        this.pc = null;
        this.CODECS = ['opus'];
        this.RECONNECT_TIMEOUT = 15000;
        this.visibilityCheck = true;
        this.pcConfig = {};
    }
    connectedCallback() {
        if (!this.video) this.oninit();
        this.onconnect();
    }
    onconnect() {
        this.ws = { close() {} };
        return true;
    }
    onopen() {
        this.onmessage = {};
        this.onwebrtc();
        return ['webrtc'];
    }
    onpcvideo(video) {
        this.video.srcObject = video.srcObject;
        this.pcState = WebSocket.OPEN;
    }
    play() {}
    send() {}
}
