export const CAMERA_MEDIA = 'video,audio';
export const TALK_MEDIA = 'video,audio,microphone';
export const STREAM_MODE = 'webrtc';
export const CONNECTION_TIMEOUT_MS = 30000;
export const BUTTON_COOLDOWN_MS = 700;
export const STREAM_STORAGE_PREFIX = 'intercom-camera-card:stream:';
export const PAN_STORAGE_PREFIX = 'intercom-camera-card:pan:';
export const DEFAULT_PRIMARY_STREAM_LABEL = 'Main';
export const DEFAULT_ALTERNATE_STREAM_LABEL = 'Alt';
export const DEFAULT_TTS_ENTITY = 'tts.home_assistant_cloud';
export const UNAVAILABLE_ENTITY_STATES = new Set(['unavailable', 'unknown']);
export const DEFAULT_VIDEO_PAN_X = 50;

export const TALK_BUTTON = {
    enabled: true,
    title: 'Talk',
    active_title: 'Hang up',
    icon: 'mdi:microphone',
    active_icon: 'mdi:phone-hangup',
    color: '#fff',
    active_color: '#fff',
    busy_color: '#07111f',
    background: 'var(--success-color, #159447)',
    hover_background: 'var(--success-color, #18a95a)',
    active_background: 'var(--error-color, #db4437)',
    busy_background: 'var(--warning-color, #e6a23c)',
    starting_status: 'Connecting microphone',
    ending_status: 'Ending talk',
    active_status: 'Talking',
    requesting_status: 'Enabling microphone',
};

export const SOUND_BASE_PATH = '/local/sounds/';

export const BUTTON_STYLE_PRESETS = {
    alert: {
        color: '#fff',
        background: 'var(--error-color, #db4437)',
    },
    primary: {
        color: '#fff',
        background: 'var(--primary-color, #03a9f4)',
    },
    warning: {
        color: '#07111f',
        background: 'var(--warning-color, #e6a23c)',
    },
    light: {
        color: '#fff',
    },
    light_on: {
        color: '#07111f',
        background: 'var(--warning-color, #e6a23c)',
    },
    disabled: {
        color: 'var(--disabled-text-color, #888)',
    },
};
