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

export const SOUND_BASE_PATH = '/local/sounds/';

export const BUTTON_STYLE_PRESETS = {
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
