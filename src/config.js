import { TALK_BUTTON } from './defaults.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function normalizeConfig(value) {
    if (!isObject(value)) throw new Error('Card configuration must be an object.');
    const config = structuredClone(value);
    for (const key of [
        'stream',
        'url',
        'entity',
        'alternate_stream',
        'server',
        'primary_label',
        'alternate_label',
        'tts_entity',
    ]) {
        if (config[key] !== undefined && typeof config[key] !== 'string') {
            throw new Error(`${key} must be a string.`);
        }
        if (typeof config[key] === 'string') config[key] = config[key].trim();
    }
    if (!config.stream && !config.url && !config.entity) {
        throw new Error('Set a camera entity, go2rtc stream, or URL.');
    }
    if (config.entity && !/^camera\.[\w]+$/.test(config.entity)) {
        throw new Error('entity must be a camera entity.');
    }
    for (const key of ['mobile_pan', 'pan']) {
        if (config[key] !== undefined && typeof config[key] !== 'boolean')
            throw new Error(`${key} must be true or false.`);
    }
    if (config.talk !== undefined && typeof config.talk !== 'boolean' && !isObject(config.talk)) {
        throw new Error('talk must be true, false, or an object.');
    }
    if (isObject(config.talk)) {
        for (const [key, item] of Object.entries(config.talk)) {
            if (key === 'enabled' && typeof item !== 'boolean')
                throw new Error('talk.enabled must be true or false.');
            if (key in TALK_BUTTON && key !== 'enabled' && typeof item !== 'string')
                throw new Error(`talk.${key} must be a string.`);
        }
    }
    validatePlayer(config.player, 'player');
    if (config.buttons !== undefined && !Array.isArray(config.buttons))
        throw new Error('buttons must be a list.');
    config.buttons = (config.buttons ?? []).map((item, index) => {
        const button = typeof item === 'string' ? { entity: item } : item;
        const label = `buttons[${index}]`;
        if (!isObject(button)) throw new Error(`${label} must be an entity ID or an object.`);
        for (const key of ['entity', 'sound', 'tts', 'message', 'tts_entity']) {
            if (button[key] !== undefined && typeof button[key] !== 'string')
                throw new Error(`${label}.${key} must be a string.`);
        }
        if (button.position !== undefined && !['left', 'right'].includes(button.position))
            throw new Error(`${label}.position must be left or right.`);
        if (
            button.cooldown !== undefined &&
            (!Number.isFinite(button.cooldown) || button.cooldown < 0)
        )
            throw new Error(`${label}.cooldown must be a non-negative number.`);
        if (
            button.states !== undefined &&
            (!isObject(button.states) ||
                Object.values(button.states).some((state) => !isObject(state)))
        )
            throw new Error(`${label}.states must contain state objects.`);
        for (const [name, settings] of [
            [label, button],
            ...Object.entries(button.states ?? {}).map(([state, settings]) => [
                `${label}.states.${state}`,
                settings,
            ]),
        ]) {
            for (const key of ['disabled', 'hidden']) {
                if (settings[key] !== undefined && typeof settings[key] !== 'boolean')
                    throw new Error(`${name}.${key} must be true or false.`);
            }
            for (const key of [
                'title',
                'icon',
                'color',
                'background',
                'hover_background',
                'border',
                'success_status',
            ]) {
                if (settings[key] !== undefined && typeof settings[key] !== 'string')
                    throw new Error(`${name}.${key} must be a string.`);
            }
            if (settings.tap_action !== undefined && !isObject(settings.tap_action))
                throw new Error(`${name}.tap_action must be an object.`);
        }
        validatePlayer(button.player, `${label}.player`);
        return button;
    });
    config.mobile_pan = config.mobile_pan !== false && config.pan !== false;
    return config;
}

function validatePlayer(value, label) {
    if (value === undefined) return;
    if (
        !(Array.isArray(value) ? value : [value]).every(
            (item) => typeof item === 'string' && /^media_player\.[\w]+$/.test(item),
        )
    ) {
        throw new Error(`${label} must contain media_player entity IDs.`);
    }
}

export function connectionKey(config) {
    return JSON.stringify(
        ['stream', 'url', 'entity', 'alternate_stream', 'server'].map((key) => config?.[key] || ''),
    );
}

export function talkSettings(config) {
    return {
        ...TALK_BUTTON,
        ...(isObject(config.talk) ? config.talk : {}),
        ...(config.talk === false ? { enabled: false } : {}),
    };
}

export function getConfigForm() {
    return {
        schema: [
            { name: 'entity', selector: { entity: { domain: 'camera' } } },
            ...['stream', 'alternate_stream', 'primary_label', 'alternate_label', 'server'].map(
                (name) => ({ name, selector: { text: {} } }),
            ),
            { name: 'player', selector: { entity: { domain: 'media_player', multiple: true } } },
            { name: 'tts_entity', selector: { entity: { domain: 'tts' } } },
            { name: 'talk', selector: { boolean: {} } },
            { name: 'mobile_pan', selector: { boolean: {} } },
        ],
        computeLabel: ({ name }) =>
            ({
                stream: 'go2rtc stream',
                alternate_stream: 'Alternate stream',
                primary_label: 'Primary label',
                alternate_label: 'Alternate label',
                server: 'go2rtc server',
                player: 'Audio players',
                tts_entity: 'Text-to-speech provider',
                talk: 'Talk button',
                mobile_pan: 'Drag to pan on mobile',
            })[name],
        computeHelper: ({ name }) =>
            name === 'entity'
                ? 'Choose a camera entity, or leave this empty and enter a go2rtc stream below.'
                : name === 'talk'
                  ? 'Enabled by default. Configure action buttons and custom talk labels in YAML.'
                  : undefined,
        assertConfig: (config) => {
            if (isObject(config.talk) || typeof config.player === 'string') {
                throw new Error(
                    'Use YAML to preserve custom talk settings or a single-string player target.',
                );
            }
        },
    };
}
